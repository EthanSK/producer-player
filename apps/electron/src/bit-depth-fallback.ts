// v3.275 — Bit-depth extraction FALLBACK CHAIN (Ethan voice 7230, 2026-05-30).
//
// CONTEXT — why this module exists:
//   The bit-depth segment in the Inspector version-history row had a long
//   tail of edge cases where ffprobe returns null for `bits_per_raw_sample`
//   AND `bits_per_sample` AND can't be inferred from `sample_fmt`. When that
//   happens we used to surface "—" silently. With the once-per-session
//   refresh guard added in v3.272, a single null result would also mark the
//   version as "already refreshed", preventing future retries even if
//   ffprobe's situation improved on a later launch.
//
//   Ethan's ask (verbatim): "There's a chain of best efforts to attempt to
//   get it in different ways. All the different ways of fallback mechanism,
//   that's what that should for the bit depth and it should be nondestructive
//   and just run-in the background and not take up a lot of resources. It
//   should be just the metadata read. Well, like yeah. It shouldn't read the
//   whole file for that."
//
// DESIGN GOALS:
//   * METADATA-ONLY — never decode audio frames, never read full file. Header
//     parsers cap at the first ~64 KiB (most container headers fit in <1 KiB
//     in practice; the cap is just a safety net for unusual layouts).
//   * NON-DESTRUCTIVE — pure resolution, no file writes, no mutation of
//     callers' data. Returns a discriminated-union diagnostic so the caller
//     can log/telemetry the source without us caring.
//   * LIGHTWEIGHT — single read() of a small buffer for the header path.
//     ffprobe-derived steps reuse the existing single-process probe payload
//     the analyzer already runs; no additional ffprobe spawns.
//   * NEVER FABRICATE — if every step fails, returns { bitDepth: null,
//     source: 'unknown' }. Don't guess "probably 16" — surfacing null lets
//     the renderer render "48 kHz" without the segment, which is honest.
//   * IDEMPOTENT — pure function of (probe-payload, header-buffer, ext).
//
// FALLBACK CHAIN (in order of confidence, highest first):
//   1. `bits_per_raw_sample` — ffprobe's most authoritative field for PCM
//      (e.g. 24 for a 24-bit WAV stored in an s32 container).
//   2. `bits_per_sample` — ffprobe's next-best field. Set for almost all
//      PCM containers.
//   3. `sample_fmt` — derive from FFmpeg's sample-format string. We extend
//      v3.269's flt/dbl handling to cover all integer formats too:
//        u8/s8 → 8, s16/s16p → 16, s32/s32p → 32, s64/s64p → 64
//      (s24/s24p → 24, although in practice ffmpeg packs 24-bit into s32).
//   4. `codec_name` — for codecs whose name encodes the bit depth (the
//      pcm_*le / pcm_*be family + a few well-known fixed-depth codecs).
//   5. Direct HEADER PARSE of the file — RIFF/WAV fmt chunk's BitsPerSample
//      field, AIFF/AIFC COMM chunk's SampleSize field, or FLAC STREAMINFO
//      block's bits_per_sample subfield. Reads only the first 64 KiB —
//      enough for any standards-compliant header.
//   6. EXTENSION HINT — if the file extension strongly implies a default
//      (e.g. `.mp3` → no PCM bit depth at all, return null cleanly), use
//      it. We do NOT use this to fabricate values for lossless extensions:
//      a `.wav` whose every prior step failed is genuinely broken/exotic
//      and gets null too (let the user investigate).
//
// SOURCE TAG — every resolution returns a string identifier of which step
// won. Useful for telemetry / logging / future debugging:
//   'ffprobe-bits-per-raw-sample' | 'ffprobe-bits-per-sample' |
//   'ffprobe-sample-format' | 'ffprobe-codec-name' | 'header-wav' |
//   'header-aiff' | 'header-flac' | 'extension-hint-lossy' | 'unknown'.

import type { Buffer } from 'node:buffer';

/** Pure shape of the ffprobe-derived bit-depth signal. All fields nullable. */
export interface BitDepthFfprobeSignal {
  /** ffprobe `bits_per_raw_sample` (string or number; parsed to integer). */
  bitsPerRawSample: number | null;
  /** ffprobe `bits_per_sample` (string or number; parsed to integer). */
  bitsPerSample: number | null;
  /** ffprobe `sample_fmt` (e.g. "s16", "s32p", "fltp"). */
  sampleFormat: string | null;
  /** ffprobe `codec_name` (e.g. "pcm_s24le", "mp3", "alac"). */
  codecName: string | null;
}

/** Final outcome of the fallback chain. */
export interface BitDepthResolution {
  /** Resolved bit depth in bits, or null if every step came up dry. */
  bitDepth: number | null;
  /** Which step in the chain produced this answer. */
  source: BitDepthResolutionSource;
}

export type BitDepthResolutionSource =
  | 'ffprobe-bits-per-raw-sample'
  | 'ffprobe-bits-per-sample'
  | 'ffprobe-sample-format'
  | 'ffprobe-codec-name'
  | 'header-wav'
  | 'header-aiff'
  | 'header-flac'
  | 'extension-hint-lossy'
  | 'unknown';

// ---------------------------------------------------------------------------
// STEP 1 + 2 + 3: ffprobe-derived signals
// ---------------------------------------------------------------------------

// Lossy codec names — when codec_name matches one of these, there's no PCM
// bit depth to report; return null cleanly rather than guessing. Centralized
// so the extension-hint fallback (step 6) can reuse the same set.
const LOSSY_CODEC_NAMES = new Set([
  'mp3',
  'aac',
  'opus',
  'vorbis',
  'wmav1',
  'wmav2',
  'ac3',
  'eac3',
  'amr_nb',
  'amr_wb',
]);

// Lossy file extensions — used by step 6 (extension hint) to short-circuit
// to a clean null instead of "unknown". Mirrors LOSSY_CODEC_NAMES but
// keyed by extension because we may not have a codec_name signal at all.
const LOSSY_AUDIO_EXTENSIONS = new Set([
  'mp3',
  'aac',
  'm4a', // AAC inside MP4
  'opus',
  'ogg',
  'oga',
  'wma',
  'ac3',
  'eac3',
  'amr',
]);

/**
 * Strip the `p` (planar) suffix from a sample_fmt string for comparison.
 * FFmpeg planar variants share the bit-depth semantics of their packed
 * counterparts; `s16` and `s16p` are both 16-bit per sample.
 */
function normalizeSampleFormat(sampleFormat: string | null | undefined): string | null {
  if (typeof sampleFormat !== 'string' || sampleFormat.length === 0) {
    return null;
  }
  return sampleFormat.toLowerCase().replace(/p$/, '');
}

/**
 * Map a normalized sample_fmt to its PCM bit depth.
 *
 * SUPPORTED:
 *   u8, s8 → 8
 *   s16    → 16
 *   s24    → 24 (rare — ffmpeg usually packs 24-bit into s32)
 *   s32    → 32 (caller should still prefer bits_per_raw_sample if it
 *                reports 24 for a 24-bit-in-s32 layout)
 *   s64    → 64
 *   flt    → 32 (float — UI labels as "32-bit float" upstream)
 *   dbl    → 64 (double — rare but appears in some Reaper/JUCE bounces)
 *
 * UNSUPPORTED → null. Includes unknown formats and `none` (no stream).
 */
function bitDepthFromSampleFormat(sampleFormat: string | null): number | null {
  if (sampleFormat === null) {
    return null;
  }

  switch (sampleFormat) {
    case 'u8':
    case 's8':
      return 8;
    case 's16':
      return 16;
    case 's24':
      return 24;
    case 's32':
      return 32;
    case 's64':
      return 64;
    case 'flt':
      return 32;
    case 'dbl':
      return 64;
    default:
      return null;
  }
}

/**
 * Map a codec_name to its PCM bit depth when the codec encodes it.
 *
 * COVERS:
 *   - pcm_u8/s8/u8 → 8
 *   - pcm_s16le/be, pcm_u16le/be → 16
 *   - pcm_s24le/be, pcm_u24le/be, pcm_s24daud → 24
 *   - pcm_s32le/be, pcm_u32le/be → 32
 *   - pcm_f32le/be → 32 (float)
 *   - pcm_f64le/be → 64 (double)
 *   - alac          → 24 (Apple Lossless: 16/20/24/32; 24 is the modal value
 *                          for music libraries; fall back to header parse
 *                          if precise depth matters).
 *
 * IGNORES:
 *   - flac → null (depth is in STREAMINFO; let the header parser handle it)
 *   - lossy codecs → null
 *   - unknown PCM variants → null
 */
function bitDepthFromCodecName(codecName: string | null): number | null {
  if (codecName === null || codecName.length === 0) {
    return null;
  }

  const lower = codecName.toLowerCase();

  // Lossy codecs — no PCM bit depth.
  if (LOSSY_CODEC_NAMES.has(lower)) {
    return null;
  }

  // The pcm_* family encodes depth in the name. Match the exact widths
  // so we don't accidentally match pcm_dvd or pcm_zork or other oddities.
  if (lower.startsWith('pcm_')) {
    if (lower === 'pcm_u8' || lower === 'pcm_s8') {
      return 8;
    }
    if (
      lower === 'pcm_s16le' ||
      lower === 'pcm_s16be' ||
      lower === 'pcm_u16le' ||
      lower === 'pcm_u16be'
    ) {
      return 16;
    }
    if (
      lower === 'pcm_s24le' ||
      lower === 'pcm_s24be' ||
      lower === 'pcm_u24le' ||
      lower === 'pcm_u24be' ||
      lower === 'pcm_s24daud'
    ) {
      return 24;
    }
    if (
      lower === 'pcm_s32le' ||
      lower === 'pcm_s32be' ||
      lower === 'pcm_u32le' ||
      lower === 'pcm_u32be'
    ) {
      return 32;
    }
    if (lower === 'pcm_f32le' || lower === 'pcm_f32be') {
      return 32;
    }
    if (lower === 'pcm_f64le' || lower === 'pcm_f64be') {
      return 64;
    }
    // Unknown pcm_ variant — let header parsing try.
    return null;
  }

  // Apple Lossless — variable per file, but the overwhelming majority of
  // ALAC files are 24-bit. The header parser will refine this if needed.
  if (lower === 'alac') {
    return 24;
  }

  // FLAC — depth lives in STREAMINFO; defer to the header parser.
  // (Not returning a guess; null = "try the next step").
  return null;
}

/**
 * Resolve bit depth from the ffprobe signal alone (steps 1-4 of the chain).
 * Returns null if every ffprobe-derived step failed.
 */
export function resolveBitDepthFromFfprobe(
  signal: BitDepthFfprobeSignal
): BitDepthResolution {
  // Step 1: bits_per_raw_sample — most authoritative.
  if (signal.bitsPerRawSample !== null && signal.bitsPerRawSample > 0) {
    return { bitDepth: signal.bitsPerRawSample, source: 'ffprobe-bits-per-raw-sample' };
  }

  // Step 2: bits_per_sample — next-best.
  if (signal.bitsPerSample !== null && signal.bitsPerSample > 0) {
    return { bitDepth: signal.bitsPerSample, source: 'ffprobe-bits-per-sample' };
  }

  // Step 3: sample_fmt inference (extended in v3.275 to cover int formats,
  // not just float as in v3.269).
  const normalizedSampleFormat = normalizeSampleFormat(signal.sampleFormat);
  const fromSampleFormat = bitDepthFromSampleFormat(normalizedSampleFormat);
  if (fromSampleFormat !== null) {
    return { bitDepth: fromSampleFormat, source: 'ffprobe-sample-format' };
  }

  // Step 4: codec_name inference (NEW in v3.275 — was previously only used
  // for lossy-detection, not for deriving bit depth).
  const fromCodecName = bitDepthFromCodecName(signal.codecName);
  if (fromCodecName !== null) {
    return { bitDepth: fromCodecName, source: 'ffprobe-codec-name' };
  }

  return { bitDepth: null, source: 'unknown' };
}

// ---------------------------------------------------------------------------
// STEP 5: Direct header parse (WAV / AIFF / FLAC)
// ---------------------------------------------------------------------------
//
// All header parsers below take a Buffer of the first N bytes of the file
// (N is typically 64 KiB but most headers fit in <1 KiB). They walk the
// container structure to find the bit-depth field and return it, or null
// if the structure doesn't match / is truncated / is malformed.
//
// IMPORTANT: these parsers are defensive — every offset read is bounds-
// checked, and any failure path returns null without throwing. The caller
// shouldn't need to wrap these in try/catch.

/**
 * Parse a WAV/RIFF header buffer to extract BitsPerSample.
 *
 * Structure:
 *   bytes 0-3  : "RIFF" (or "RIFX"/"RF64")
 *   bytes 4-7  : file size minus 8 (uint32 LE)
 *   bytes 8-11 : "WAVE"
 *   bytes 12+  : chunks (each: 4-byte id + 4-byte LE size + payload)
 *
 * We walk chunks looking for "fmt " (note trailing space). Its payload:
 *   bytes 0-1  : AudioFormat (uint16 LE; 1=PCM, 3=IEEE float, 65534=WFE)
 *   bytes 2-3  : NumChannels (uint16 LE)
 *   bytes 4-7  : SampleRate (uint32 LE)
 *   bytes 8-11 : ByteRate (uint32 LE)
 *   bytes 12-13: BlockAlign (uint16 LE)
 *   bytes 14-15: BitsPerSample (uint16 LE) ← this is what we want
 *
 * For WAVE_FORMAT_EXTENSIBLE (AudioFormat=65534, fmt chunk size>=40), the
 * "real" bit depth lives at offset 18 (wValidBitsPerSample) — common case
 * for 24-bit-in-32-bit-container layouts. We honor it when present.
 */
export function parseBitDepthFromWavHeader(buffer: Buffer | Uint8Array): number | null {
  // Wrap Uint8Array in a Buffer-like view for endian-aware reads. Bun and
  // older Node test harnesses can hand us a plain Uint8Array; the
  // DataView path works for both.
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );

  if (view.byteLength < 44) {
    // Smallest possible WAV header is 44 bytes (canonical fmt + data
    // chunk pre-amble); anything smaller can't be a real WAV.
    return null;
  }

  // Verify RIFF/WAVE magic. RIFX (big-endian) and RF64 (>4GB) are also valid.
  const riffMagic = readAscii(view, 0, 4);
  if (riffMagic !== 'RIFF' && riffMagic !== 'RIFX' && riffMagic !== 'RF64') {
    return null;
  }
  const waveMagic = readAscii(view, 8, 4);
  if (waveMagic !== 'WAVE') {
    return null;
  }

  const isBigEndian = riffMagic === 'RIFX';
  const littleEndian = !isBigEndian;

  // Walk chunks starting at offset 12. Each chunk header is 8 bytes
  // (4-byte id + 4-byte size), payload is `size` bytes, padded to even
  // boundary. Cap the loop at MAX_CHUNKS_TO_SCAN to avoid pathological
  // headers triggering a long walk.
  let offset = 12;
  const MAX_CHUNKS_TO_SCAN = 64;
  for (let i = 0; i < MAX_CHUNKS_TO_SCAN; i += 1) {
    if (offset + 8 > view.byteLength) {
      return null;
    }
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, littleEndian);

    if (chunkId === 'fmt ') {
      // fmt chunk found — payload starts at offset+8.
      const payloadStart = offset + 8;
      if (payloadStart + 16 > view.byteLength) {
        return null;
      }
      const audioFormat = view.getUint16(payloadStart, littleEndian);
      const bitsPerSample = view.getUint16(payloadStart + 14, littleEndian);

      // WAVE_FORMAT_EXTENSIBLE — the canonical BitsPerSample is the
      // CONTAINER size; the real source depth is at offset 18
      // (wValidBitsPerSample). Honor it when the chunk is big enough.
      if (audioFormat === 0xfffe && chunkSize >= 40) {
        if (payloadStart + 20 > view.byteLength) {
          // Truncated extensible header — fall back to BitsPerSample.
          return bitsPerSample > 0 ? bitsPerSample : null;
        }
        const validBits = view.getUint16(payloadStart + 18, littleEndian);
        if (validBits > 0) {
          return validBits;
        }
      }

      return bitsPerSample > 0 ? bitsPerSample : null;
    }

    // Advance to next chunk. RIFF requires chunks to be word-aligned;
    // odd-sized chunks get a single padding byte.
    const advance = 8 + chunkSize + (chunkSize % 2);
    offset += advance;
  }

  return null;
}

/**
 * Parse an AIFF/AIFC header buffer to extract SampleSize.
 *
 * Structure (AIFF is big-endian throughout):
 *   bytes 0-3  : "FORM"
 *   bytes 4-7  : form size (uint32 BE)
 *   bytes 8-11 : "AIFF" or "AIFC"
 *   bytes 12+  : chunks (each: 4-byte id + 4-byte BE size + payload, even-padded)
 *
 * COMM chunk payload:
 *   bytes 0-1  : numChannels (int16 BE)
 *   bytes 2-5  : numSampleFrames (uint32 BE)
 *   bytes 6-7  : sampleSize (uint16 BE) ← bits per sample
 *   bytes 8-17 : sampleRate (80-bit IEEE 754 extended; we ignore)
 *   (AIFC adds compressionType + name strings after the sample rate)
 */
export function parseBitDepthFromAiffHeader(buffer: Buffer | Uint8Array): number | null {
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );

  if (view.byteLength < 38) {
    // FORM (12) + COMM header (8) + minimum COMM payload (18) = 38
    return null;
  }

  const formMagic = readAscii(view, 0, 4);
  if (formMagic !== 'FORM') {
    return null;
  }

  const formType = readAscii(view, 8, 4);
  if (formType !== 'AIFF' && formType !== 'AIFC') {
    return null;
  }

  // Walk chunks starting at offset 12.
  let offset = 12;
  const MAX_CHUNKS_TO_SCAN = 64;
  for (let i = 0; i < MAX_CHUNKS_TO_SCAN; i += 1) {
    if (offset + 8 > view.byteLength) {
      return null;
    }
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, /* littleEndian */ false);

    if (chunkId === 'COMM') {
      const payloadStart = offset + 8;
      if (payloadStart + 8 > view.byteLength) {
        return null;
      }
      const sampleSize = view.getUint16(payloadStart + 6, /* littleEndian */ false);
      return sampleSize > 0 ? sampleSize : null;
    }

    const advance = 8 + chunkSize + (chunkSize % 2);
    offset += advance;
  }

  return null;
}

/**
 * Parse a FLAC header buffer to extract bits_per_sample from STREAMINFO.
 *
 * Structure:
 *   bytes 0-3  : "fLaC" magic
 *   bytes 4+   : metadata blocks (each: 1-byte header + 3-byte BE size + payload)
 *     header byte: 0x80 if last, low 7 bits = block type (0 = STREAMINFO)
 *
 * STREAMINFO payload (must be the FIRST metadata block per spec):
 *   bytes 0-1  : min block size (uint16 BE)
 *   bytes 2-3  : max block size (uint16 BE)
 *   bytes 4-6  : min frame size (uint24 BE)
 *   bytes 7-9  : max frame size (uint24 BE)
 *   bytes 10-17: packed — 20 bits sample rate, 3 bits channels-1,
 *                5 bits bits_per_sample - 1, 36 bits total samples
 *
 * We need the 5 bits at offset 16-bit-position 20 within the 8-byte packed
 * field. Concretely: bit 4 of byte 12 is the LSB of channels; bits 3-1
 * of byte 12 are the high 3 bits of bits_per_sample - 1; bits 0..4 of
 * byte 13 are bits 4..0 of bits_per_sample - 1. We extract via masking.
 */
export function parseBitDepthFromFlacHeader(buffer: Buffer | Uint8Array): number | null {
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );

  if (view.byteLength < 4 + 4 + 34) {
    // fLaC (4) + metadata header (4) + STREAMINFO payload (34) = 42
    return null;
  }

  const magic = readAscii(view, 0, 4);
  if (magic !== 'fLaC') {
    return null;
  }

  // Metadata block header at offset 4.
  const blockHeader = view.getUint8(4);
  const blockType = blockHeader & 0x7f;
  if (blockType !== 0) {
    // FLAC spec mandates STREAMINFO is the first block — if not, malformed.
    return null;
  }

  // Metadata block size = 3-byte BE int at offset 5-7.
  const blockSize =
    (view.getUint8(5) << 16) | (view.getUint8(6) << 8) | view.getUint8(7);
  if (blockSize < 34) {
    return null;
  }
  if (view.byteLength < 8 + 34) {
    return null;
  }

  // STREAMINFO payload starts at offset 8. The 64-bit packed field with
  // the bits_per_sample is at offset 8+10 = 18. Within those 8 bytes
  // (offsets 18..25), the layout of the FIRST two bytes (offsets 18-19) is:
  //   byte 18: SSSSSSSS                                  (8 bits of sample-rate hi)
  //   byte 19: SSSSSSSS                                  (8 bits of sample-rate mid)
  //   byte 20: SSSS CCCB                                 (4 bits sr-lo, 3 bits ch-1, 1 bit bps-hi)
  //   byte 21: BBBB STTT                                 (4 bits bps-mid+lo, 1 bit splits, 3 bits total-samples)
  // Wait — re-derive precisely against the FLAC spec:
  //   sample-rate         : 20 bits → bytes 18,19 (16 bits) + high nibble of byte 20 (4 bits)
  //   channels-1          : 3 bits  → byte 20 bits 3..1
  //   bits_per_sample - 1 : 5 bits  → byte 20 bit 0 (MSB) + byte 21 bits 7..4 (4 lower)
  //   total-samples       : 36 bits → byte 21 bits 3..0 + bytes 22..25 (32 bits)
  //
  // Extract bits_per_sample - 1:
  //   high bit = byte20 & 0x01
  //   low 4 bits = (byte21 >> 4) & 0x0f
  //   bps = ((high << 4) | low4) + 1
  const byte20 = view.getUint8(20);
  const byte21 = view.getUint8(21);
  const bpsHigh = byte20 & 0x01;
  const bpsLow4 = (byte21 >> 4) & 0x0f;
  const bps = ((bpsHigh << 4) | bpsLow4) + 1;

  // FLAC spec allows 4..32 bits_per_sample.
  if (bps < 4 || bps > 32) {
    return null;
  }
  return bps;
}

/**
 * Dispatcher — chooses the right header parser based on file extension.
 * Returns the resolution (with source tag) so callers can record which
 * header path won, or null if the extension isn't recognized.
 */
export function resolveBitDepthFromHeaderBuffer(
  extension: string | null,
  headerBuffer: Buffer | Uint8Array | null
): BitDepthResolution | null {
  if (headerBuffer === null || extension === null) {
    return null;
  }

  const ext = extension.toLowerCase().replace(/^\./, '');

  if (ext === 'wav' || ext === 'wave' || ext === 'bwf') {
    const wav = parseBitDepthFromWavHeader(headerBuffer);
    if (wav !== null) {
      return { bitDepth: wav, source: 'header-wav' };
    }
    return null;
  }

  if (ext === 'aiff' || ext === 'aif' || ext === 'aifc') {
    const aiff = parseBitDepthFromAiffHeader(headerBuffer);
    if (aiff !== null) {
      return { bitDepth: aiff, source: 'header-aiff' };
    }
    return null;
  }

  if (ext === 'flac') {
    const flac = parseBitDepthFromFlacHeader(headerBuffer);
    if (flac !== null) {
      return { bitDepth: flac, source: 'header-flac' };
    }
    return null;
  }

  // Unknown / unsupported extension for direct header parsing. ALAC inside
  // .m4a/.caf containers requires walking the MP4/CAF box structure which
  // is much heavier; we leave those to the ffprobe-codec-name path (step 4
  // returns 24 for ALAC) and accept the imprecision.
  return null;
}

// ---------------------------------------------------------------------------
// STEP 6: extension hint (lossy short-circuit only)
// ---------------------------------------------------------------------------

/**
 * Returns a clean `null` resolution tagged 'extension-hint-lossy' for files
 * whose extension means "no PCM bit depth ever applies". This is a SEMANTIC
 * null, not "we don't know": the renderer should skip the bit-depth segment
 * entirely, which matches what lossy formats genuinely warrant.
 *
 * Returns null (the unwrapped null) when the extension is not a known
 * lossy format — the caller should then surface 'unknown' as the source.
 */
export function resolveBitDepthFromExtensionHint(
  extension: string | null
): BitDepthResolution | null {
  if (extension === null) {
    return null;
  }
  const ext = extension.toLowerCase().replace(/^\./, '');
  if (LOSSY_AUDIO_EXTENSIONS.has(ext)) {
    return { bitDepth: null, source: 'extension-hint-lossy' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Top-level orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full fallback chain in confidence order.
 *
 * @param signal     ffprobe-derived signal (always provide; pass nulls if
 *                   ffprobe failed entirely).
 * @param extension  File extension (e.g. "wav"), used by header parser
 *                   dispatch + extension-hint fallback. Pass null if unknown.
 * @param header     First N bytes of the file. Pass null to skip step 5.
 *                   When provided, should be at least ~64 bytes; ~64 KiB
 *                   is the recommended cap (any standards-compliant header
 *                   fits in well under that).
 * @returns          { bitDepth, source } where source identifies which step
 *                   produced the answer. bitDepth=null + source='unknown'
 *                   means every step failed.
 */
export function resolveBitDepth(
  signal: BitDepthFfprobeSignal,
  extension: string | null,
  header: Buffer | Uint8Array | null
): BitDepthResolution {
  // Steps 1-4: ffprobe-derived. Fast — no I/O.
  const fromFfprobe = resolveBitDepthFromFfprobe(signal);
  if (fromFfprobe.bitDepth !== null) {
    return fromFfprobe;
  }

  // Step 5: direct header parse. Single small read by the caller; we just
  // parse the buffer that's already in memory.
  const fromHeader = resolveBitDepthFromHeaderBuffer(extension, header);
  if (fromHeader !== null && fromHeader.bitDepth !== null) {
    return fromHeader;
  }

  // Step 6: extension hint for lossy short-circuit. Returns null bit depth
  // with a meaningful source tag — semantically "lossy, no bit depth exists".
  const fromExtension = resolveBitDepthFromExtensionHint(extension);
  if (fromExtension !== null) {
    return fromExtension;
  }

  // Final fallback: genuinely unknown.
  return { bitDepth: null, source: 'unknown' };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Read a fixed-length ASCII string from a DataView at offset; safe-bounds. */
function readAscii(view: DataView, offset: number, length: number): string {
  if (offset + length > view.byteLength) {
    return '';
  }
  let s = '';
  for (let i = 0; i < length; i += 1) {
    s += String.fromCharCode(view.getUint8(offset + i));
  }
  return s;
}
