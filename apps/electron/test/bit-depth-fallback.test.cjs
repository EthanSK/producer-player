// v3.275 — Tests for the bit-depth fallback chain
// (Ethan voice 7230, 2026-05-30). Pure-function tests, no Electron / no
// real ffprobe / no real file I/O. Header tests build synthetic WAV /
// AIFF / FLAC headers byte-by-byte so we cover every edge case the
// production parsers need to handle without dragging real .wav fixtures
// into the test fixtures dir.

const assert = require('node:assert/strict');
const test = require('node:test');
const { Buffer } = require('node:buffer');

const {
  resolveBitDepth,
  resolveBitDepthFromFfprobe,
  resolveBitDepthFromHeaderBuffer,
  resolveBitDepthFromExtensionHint,
  parseBitDepthFromWavHeader,
  parseBitDepthFromAiffHeader,
  parseBitDepthFromFlacHeader,
} = require('../dist/bit-depth-fallback.test.cjs');

// ---------------------------------------------------------------------------
// Step 1-4: ffprobe-derived signals
// ---------------------------------------------------------------------------

test('ffprobe step 1 — bits_per_raw_sample wins when present', () => {
  const result = resolveBitDepthFromFfprobe({
    bitsPerRawSample: 24,
    bitsPerSample: 32, // a 24-in-s32 WAV — must prefer raw_sample over the container
    sampleFormat: 's32',
    codecName: 'pcm_s24le',
  });
  assert.deepEqual(result, { bitDepth: 24, source: 'ffprobe-bits-per-raw-sample' });
});

test('ffprobe step 2 — bits_per_sample wins when bits_per_raw_sample is null', () => {
  const result = resolveBitDepthFromFfprobe({
    bitsPerRawSample: null,
    bitsPerSample: 16,
    sampleFormat: 's16',
    codecName: 'pcm_s16le',
  });
  assert.deepEqual(result, { bitDepth: 16, source: 'ffprobe-bits-per-sample' });
});

test('ffprobe step 3 — sample_fmt s16 inference fallback (the gap v3.275 fixes)', () => {
  const result = resolveBitDepthFromFfprobe({
    bitsPerRawSample: null,
    bitsPerSample: null,
    sampleFormat: 's16',
    codecName: null,
  });
  assert.deepEqual(result, { bitDepth: 16, source: 'ffprobe-sample-format' });
});

test('ffprobe step 3 — sample_fmt s32 inference', () => {
  const result = resolveBitDepthFromFfprobe({
    bitsPerRawSample: null,
    bitsPerSample: null,
    sampleFormat: 's32',
    codecName: null,
  });
  assert.deepEqual(result, { bitDepth: 32, source: 'ffprobe-sample-format' });
});

test('ffprobe step 3 — sample_fmt flt → 32 (float, preserved v3.269 behavior)', () => {
  const result = resolveBitDepthFromFfprobe({
    bitsPerRawSample: null,
    bitsPerSample: null,
    sampleFormat: 'flt',
    codecName: null,
  });
  assert.deepEqual(result, { bitDepth: 32, source: 'ffprobe-sample-format' });
});

test('ffprobe step 3 — sample_fmt dbl → 64', () => {
  const result = resolveBitDepthFromFfprobe({
    bitsPerRawSample: null,
    bitsPerSample: null,
    sampleFormat: 'dbl',
    codecName: null,
  });
  assert.deepEqual(result, { bitDepth: 64, source: 'ffprobe-sample-format' });
});

test('ffprobe step 3 — planar variant fltp normalizes to flt → 32', () => {
  const result = resolveBitDepthFromFfprobe({
    bitsPerRawSample: null,
    bitsPerSample: null,
    sampleFormat: 'fltp',
    codecName: null,
  });
  assert.deepEqual(result, { bitDepth: 32, source: 'ffprobe-sample-format' });
});

test('ffprobe step 3 — planar variant s16p normalizes to s16 → 16', () => {
  const result = resolveBitDepthFromFfprobe({
    bitsPerRawSample: null,
    bitsPerSample: null,
    sampleFormat: 's16p',
    codecName: null,
  });
  assert.deepEqual(result, { bitDepth: 16, source: 'ffprobe-sample-format' });
});

test('ffprobe step 3 — sample_fmt u8 → 8', () => {
  const result = resolveBitDepthFromFfprobe({
    bitsPerRawSample: null,
    bitsPerSample: null,
    sampleFormat: 'u8',
    codecName: null,
  });
  assert.deepEqual(result, { bitDepth: 8, source: 'ffprobe-sample-format' });
});

test('ffprobe step 4 — codec_name pcm_s24le inference', () => {
  const result = resolveBitDepthFromFfprobe({
    bitsPerRawSample: null,
    bitsPerSample: null,
    sampleFormat: null,
    codecName: 'pcm_s24le',
  });
  assert.deepEqual(result, { bitDepth: 24, source: 'ffprobe-codec-name' });
});

test('ffprobe step 4 — codec_name pcm_f32le inference', () => {
  const result = resolveBitDepthFromFfprobe({
    bitsPerRawSample: null,
    bitsPerSample: null,
    sampleFormat: null,
    codecName: 'pcm_f32le',
  });
  assert.deepEqual(result, { bitDepth: 32, source: 'ffprobe-codec-name' });
});

test('ffprobe step 4 — codec_name alac → 24 (modal value, header refines)', () => {
  const result = resolveBitDepthFromFfprobe({
    bitsPerRawSample: null,
    bitsPerSample: null,
    sampleFormat: null,
    codecName: 'alac',
  });
  assert.deepEqual(result, { bitDepth: 24, source: 'ffprobe-codec-name' });
});

test('ffprobe step 4 — codec_name mp3 → unknown (lossy, no PCM depth)', () => {
  const result = resolveBitDepthFromFfprobe({
    bitsPerRawSample: null,
    bitsPerSample: null,
    sampleFormat: null,
    codecName: 'mp3',
  });
  assert.deepEqual(result, { bitDepth: null, source: 'unknown' });
});

test('ffprobe step 4 — codec_name flac → unknown (defer to header parser)', () => {
  const result = resolveBitDepthFromFfprobe({
    bitsPerRawSample: null,
    bitsPerSample: null,
    sampleFormat: null,
    codecName: 'flac',
  });
  assert.deepEqual(result, { bitDepth: null, source: 'unknown' });
});

test('ffprobe all-nulls → unknown', () => {
  const result = resolveBitDepthFromFfprobe({
    bitsPerRawSample: null,
    bitsPerSample: null,
    sampleFormat: null,
    codecName: null,
  });
  assert.deepEqual(result, { bitDepth: null, source: 'unknown' });
});

test('ffprobe step 1 — zero bits_per_raw_sample treated as null (ffprobe sometimes returns 0)', () => {
  const result = resolveBitDepthFromFfprobe({
    bitsPerRawSample: 0,
    bitsPerSample: 16,
    sampleFormat: 's16',
    codecName: 'pcm_s16le',
  });
  // Should skip the zero and use bits_per_sample.
  assert.deepEqual(result, { bitDepth: 16, source: 'ffprobe-bits-per-sample' });
});

// ---------------------------------------------------------------------------
// Step 5: header parsers (WAV / AIFF / FLAC)
// ---------------------------------------------------------------------------

/** Build a minimal canonical 16-bit WAV header (PCM, 48 kHz, stereo). */
function buildWavHeader({
  audioFormat = 1, // 1 = PCM
  numChannels = 2,
  sampleRate = 48000,
  bitsPerSample = 16,
  withExtensible = false,
  validBitsPerSample = null,
} = {}) {
  const fmtChunkSize = withExtensible ? 40 : 16;
  const buffer = Buffer.alloc(12 + 8 + fmtChunkSize + 8); // RIFF + WAVE + fmt + data preamble

  // RIFF header
  buffer.write('RIFF', 0, 4, 'ascii');
  buffer.writeUInt32LE(36 + fmtChunkSize - 16, 4); // file size - 8 (not exact, fine for test)
  buffer.write('WAVE', 8, 4, 'ascii');

  // fmt chunk
  buffer.write('fmt ', 12, 4, 'ascii');
  buffer.writeUInt32LE(fmtChunkSize, 16);
  buffer.writeUInt16LE(audioFormat, 20); // AudioFormat
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE((sampleRate * numChannels * bitsPerSample) / 8, 28); // ByteRate
  buffer.writeUInt16LE((numChannels * bitsPerSample) / 8, 32); // BlockAlign
  buffer.writeUInt16LE(bitsPerSample, 34); // BitsPerSample

  if (withExtensible) {
    buffer.writeUInt16LE(22, 36); // cbSize
    buffer.writeUInt16LE(validBitsPerSample ?? bitsPerSample, 38); // wValidBitsPerSample
    buffer.writeUInt32LE(0x03, 40); // dwChannelMask (front L + R)
    // Remaining 16 bytes of SubFormat GUID — zero-filled for test.
  }

  // Data chunk preamble
  const dataOffset = 12 + 8 + fmtChunkSize;
  buffer.write('data', dataOffset, 4, 'ascii');
  buffer.writeUInt32LE(0, dataOffset + 4);

  return buffer;
}

test('WAV header — canonical 16-bit PCM extracts 16', () => {
  const buffer = buildWavHeader({ bitsPerSample: 16 });
  assert.equal(parseBitDepthFromWavHeader(buffer), 16);
});

test('WAV header — 24-bit PCM extracts 24', () => {
  const buffer = buildWavHeader({ bitsPerSample: 24 });
  assert.equal(parseBitDepthFromWavHeader(buffer), 24);
});

test('WAV header — 32-bit float PCM extracts 32', () => {
  const buffer = buildWavHeader({ audioFormat: 3, bitsPerSample: 32 });
  assert.equal(parseBitDepthFromWavHeader(buffer), 32);
});

test('WAV header — WAVE_FORMAT_EXTENSIBLE 24-in-32 honors wValidBitsPerSample=24', () => {
  const buffer = buildWavHeader({
    audioFormat: 0xfffe,
    withExtensible: true,
    bitsPerSample: 32,
    validBitsPerSample: 24,
  });
  assert.equal(parseBitDepthFromWavHeader(buffer), 24);
});

test('WAV header — missing RIFF magic returns null', () => {
  const buffer = buildWavHeader({ bitsPerSample: 16 });
  buffer.write('XXXX', 0, 4, 'ascii');
  assert.equal(parseBitDepthFromWavHeader(buffer), null);
});

test('WAV header — missing WAVE magic returns null', () => {
  const buffer = buildWavHeader({ bitsPerSample: 16 });
  buffer.write('XXXX', 8, 4, 'ascii');
  assert.equal(parseBitDepthFromWavHeader(buffer), null);
});

test('WAV header — too small returns null', () => {
  const buffer = Buffer.alloc(20);
  buffer.write('RIFF', 0, 4, 'ascii');
  buffer.write('WAVE', 8, 4, 'ascii');
  assert.equal(parseBitDepthFromWavHeader(buffer), null);
});

test('WAV header — fmt chunk after LIST chunk still found (Reaper/Pro Tools layout)', () => {
  // Build a header where LIST appears before fmt (common in Reaper bounces).
  const baseFmt = buildWavHeader({ bitsPerSample: 24 });
  const listChunkSize = 32;
  const total = 12 + 8 + listChunkSize + (baseFmt.length - 12);
  const buffer = Buffer.alloc(total);

  // RIFF + WAVE preamble
  buffer.write('RIFF', 0, 4, 'ascii');
  buffer.writeUInt32LE(total - 8, 4);
  buffer.write('WAVE', 8, 4, 'ascii');

  // LIST chunk (zero-filled payload)
  buffer.write('LIST', 12, 4, 'ascii');
  buffer.writeUInt32LE(listChunkSize, 16);
  // payload at 20..20+listChunkSize is zero

  // Copy the fmt chunk + data preamble from baseFmt (skipping its
  // RIFF/WAVE 12-byte preamble — we already wrote our own).
  baseFmt.copy(buffer, 12 + 8 + listChunkSize, 12);

  assert.equal(parseBitDepthFromWavHeader(buffer), 24);
});

/** Build a minimal AIFF FORM/COMM header. */
function buildAiffHeader({
  formType = 'AIFF',
  numChannels = 2,
  numSampleFrames = 0,
  sampleSize = 16,
} = {}) {
  const commPayloadSize = 18; // canonical COMM
  const buffer = Buffer.alloc(12 + 8 + commPayloadSize);

  buffer.write('FORM', 0, 4, 'ascii');
  buffer.writeUInt32BE(12 + 8 + commPayloadSize - 8, 4);
  buffer.write(formType, 8, 4, 'ascii');

  buffer.write('COMM', 12, 4, 'ascii');
  buffer.writeUInt32BE(commPayloadSize, 16);
  buffer.writeInt16BE(numChannels, 20);
  buffer.writeUInt32BE(numSampleFrames, 22);
  buffer.writeUInt16BE(sampleSize, 26);
  // sample-rate 80-bit IEEE 754 ext at 28..37 — leave zero for test

  return buffer;
}

test('AIFF header — 16-bit extracts 16', () => {
  const buffer = buildAiffHeader({ sampleSize: 16 });
  assert.equal(parseBitDepthFromAiffHeader(buffer), 16);
});

test('AIFF header — 24-bit extracts 24', () => {
  const buffer = buildAiffHeader({ sampleSize: 24 });
  assert.equal(parseBitDepthFromAiffHeader(buffer), 24);
});

test('AIFF header — AIFC variant extracts sample size', () => {
  const buffer = buildAiffHeader({ formType: 'AIFC', sampleSize: 24 });
  assert.equal(parseBitDepthFromAiffHeader(buffer), 24);
});

test('AIFF header — missing FORM magic returns null', () => {
  const buffer = buildAiffHeader({ sampleSize: 16 });
  buffer.write('XXXX', 0, 4, 'ascii');
  assert.equal(parseBitDepthFromAiffHeader(buffer), null);
});

test('AIFF header — non-AIFF/AIFC form type returns null', () => {
  const buffer = buildAiffHeader({ sampleSize: 16 });
  buffer.write('AVI ', 8, 4, 'ascii');
  assert.equal(parseBitDepthFromAiffHeader(buffer), null);
});

/** Build a minimal FLAC fLaC + STREAMINFO header. */
function buildFlacHeader({
  bitsPerSample = 16,
  sampleRate = 48000,
  channels = 2,
} = {}) {
  // fLaC (4) + metadata block header (4) + STREAMINFO payload (34) = 42
  const buffer = Buffer.alloc(42);
  buffer.write('fLaC', 0, 4, 'ascii');

  // Metadata block header: 0x80 (last) | 0x00 (block type STREAMINFO) = 0x80
  buffer.writeUInt8(0x80, 4);
  // Block size = 34 (3-byte BE)
  buffer.writeUInt8(0, 5);
  buffer.writeUInt8(0, 6);
  buffer.writeUInt8(34, 7);

  // STREAMINFO payload starts at offset 8.
  // Bytes 0-1: min block size (uint16 BE) — 4096 sensible
  buffer.writeUInt16BE(4096, 8);
  // Bytes 2-3: max block size (uint16 BE) — 4096
  buffer.writeUInt16BE(4096, 10);
  // Bytes 4-9: min/max frame size (uint24 BE x 2) — zero is fine for tests
  // (already zeroed by alloc)
  // Bytes 10-17: packed field — 20 bits sample-rate, 3 bits ch-1, 5 bits bps-1, 36 bits total samples
  //   We need to write into bytes 18..25 in the BUFFER (offset 8 + 10 = 18).
  //
  // Pack:
  //   sample-rate (20 bits) → bytes 18, 19, hi nibble of 20
  //   channels-1  (3 bits)  → byte 20 bits 3..1
  //   bps-1       (5 bits)  → byte 20 bit 0 (MSB) + byte 21 bits 7..4 (low 4 bits)
  //   total samp  (36 bits) → byte 21 bits 3..0 + bytes 22..25
  const sr = sampleRate & 0x000fffff;
  const ch = (channels - 1) & 0x07;
  const bps = (bitsPerSample - 1) & 0x1f;

  buffer.writeUInt8((sr >>> 12) & 0xff, 18);
  buffer.writeUInt8((sr >>> 4) & 0xff, 19);
  // byte 20: sr-lo-nibble (high nibble) + ch (bits 3..1) + bps-high (bit 0)
  const srLoNibble = (sr & 0x0f) << 4; // 4 high bits of byte 20
  const chBits = (ch & 0x07) << 1; // bits 3..1
  const bpsHighBit = (bps >>> 4) & 0x01; // bit 0
  buffer.writeUInt8(srLoNibble | chBits | bpsHighBit, 20);
  // byte 21: bps-low (bits 7..4) + total-samples high 4 bits (bits 3..0) — zeros
  const bpsLow4 = (bps & 0x0f) << 4;
  buffer.writeUInt8(bpsLow4, 21);
  // bytes 22..25: low 32 bits of total samples — zeros (already)

  return buffer;
}

test('FLAC header — 16-bit extracts 16', () => {
  const buffer = buildFlacHeader({ bitsPerSample: 16 });
  assert.equal(parseBitDepthFromFlacHeader(buffer), 16);
});

test('FLAC header — 24-bit extracts 24', () => {
  const buffer = buildFlacHeader({ bitsPerSample: 24 });
  assert.equal(parseBitDepthFromFlacHeader(buffer), 24);
});

test('FLAC header — 32-bit extracts 32 (top of spec range)', () => {
  const buffer = buildFlacHeader({ bitsPerSample: 32 });
  assert.equal(parseBitDepthFromFlacHeader(buffer), 32);
});

test('FLAC header — missing fLaC magic returns null', () => {
  const buffer = buildFlacHeader({ bitsPerSample: 16 });
  buffer.write('XXXX', 0, 4, 'ascii');
  assert.equal(parseBitDepthFromFlacHeader(buffer), null);
});

test('FLAC header — too small returns null', () => {
  const buffer = Buffer.alloc(20);
  buffer.write('fLaC', 0, 4, 'ascii');
  assert.equal(parseBitDepthFromFlacHeader(buffer), null);
});

// ---------------------------------------------------------------------------
// resolveBitDepthFromHeaderBuffer — dispatcher
// ---------------------------------------------------------------------------

test('header dispatcher — wav extension routes to WAV parser', () => {
  const buffer = buildWavHeader({ bitsPerSample: 24 });
  assert.deepEqual(resolveBitDepthFromHeaderBuffer('wav', buffer), {
    bitDepth: 24,
    source: 'header-wav',
  });
});

test('header dispatcher — leading dot in extension still routes correctly', () => {
  const buffer = buildWavHeader({ bitsPerSample: 24 });
  assert.deepEqual(resolveBitDepthFromHeaderBuffer('.wav', buffer), {
    bitDepth: 24,
    source: 'header-wav',
  });
});

test('header dispatcher — aiff extension routes to AIFF parser', () => {
  const buffer = buildAiffHeader({ sampleSize: 24 });
  assert.deepEqual(resolveBitDepthFromHeaderBuffer('aiff', buffer), {
    bitDepth: 24,
    source: 'header-aiff',
  });
});

test('header dispatcher — flac extension routes to FLAC parser', () => {
  const buffer = buildFlacHeader({ bitsPerSample: 24 });
  assert.deepEqual(resolveBitDepthFromHeaderBuffer('flac', buffer), {
    bitDepth: 24,
    source: 'header-flac',
  });
});

test('header dispatcher — unknown extension returns null (lets next step run)', () => {
  const buffer = buildWavHeader({ bitsPerSample: 24 });
  assert.equal(resolveBitDepthFromHeaderBuffer('mp3', buffer), null);
});

test('header dispatcher — null header returns null (lets next step run)', () => {
  assert.equal(resolveBitDepthFromHeaderBuffer('wav', null), null);
});

test('header dispatcher — wrong-magic header returns null (parser-defensive)', () => {
  // FLAC parser fed a WAV header → returns null cleanly, no throw.
  const wavBuffer = buildWavHeader({ bitsPerSample: 24 });
  assert.equal(resolveBitDepthFromHeaderBuffer('flac', wavBuffer), null);
});

// ---------------------------------------------------------------------------
// Step 6: extension hint
// ---------------------------------------------------------------------------

test('extension hint — mp3 returns clean null with lossy source tag', () => {
  assert.deepEqual(resolveBitDepthFromExtensionHint('mp3'), {
    bitDepth: null,
    source: 'extension-hint-lossy',
  });
});

test('extension hint — m4a returns clean null with lossy source tag', () => {
  assert.deepEqual(resolveBitDepthFromExtensionHint('m4a'), {
    bitDepth: null,
    source: 'extension-hint-lossy',
  });
});

test('extension hint — wav does NOT short-circuit (let caller surface unknown)', () => {
  assert.equal(resolveBitDepthFromExtensionHint('wav'), null);
});

test('extension hint — unknown extension returns null (not a lossy hint)', () => {
  assert.equal(resolveBitDepthFromExtensionHint('xyz'), null);
});

// ---------------------------------------------------------------------------
// Top-level orchestrator
// ---------------------------------------------------------------------------

test('orchestrator — ffprobe wins when bits_per_raw_sample is set', () => {
  const result = resolveBitDepth(
    {
      bitsPerRawSample: 24,
      bitsPerSample: 24,
      sampleFormat: 's32',
      codecName: 'pcm_s24le',
    },
    'wav',
    buildWavHeader({ bitsPerSample: 16 }) // misleading on purpose
  );
  assert.deepEqual(result, { bitDepth: 24, source: 'ffprobe-bits-per-raw-sample' });
});

test('orchestrator — falls through ffprobe to header when probe is empty', () => {
  const result = resolveBitDepth(
    {
      bitsPerRawSample: null,
      bitsPerSample: null,
      sampleFormat: null,
      codecName: null,
    },
    'wav',
    buildWavHeader({ bitsPerSample: 24 })
  );
  assert.deepEqual(result, { bitDepth: 24, source: 'header-wav' });
});

test('orchestrator — Ethan thedrums case (16-bit WAV, ffprobe s16 + bps=16)', () => {
  // Mirrors the actual ffprobe output captured in the task brief for
  // thedrums v5.wav: bits_per_sample=16, sample_fmt=s16. Even when
  // bits_per_raw_sample is empty, we still get 16 via step 2.
  const result = resolveBitDepth(
    {
      bitsPerRawSample: null,
      bitsPerSample: 16,
      sampleFormat: 's16',
      codecName: 'pcm_s16le',
    },
    'wav',
    null // header buffer not strictly needed — step 2 already wins
  );
  assert.deepEqual(result, { bitDepth: 16, source: 'ffprobe-bits-per-sample' });
});

test('orchestrator — pure-codec_name path (no sample_fmt, no bps) still resolves', () => {
  // Simulates a hostile ffprobe that returns only codec_name. Pre-v3.275 this
  // would have returned null bit depth. With step 4 we now derive 16.
  const result = resolveBitDepth(
    {
      bitsPerRawSample: null,
      bitsPerSample: null,
      sampleFormat: null,
      codecName: 'pcm_s16le',
    },
    'wav',
    null
  );
  assert.deepEqual(result, { bitDepth: 16, source: 'ffprobe-codec-name' });
});

test('orchestrator — header-only resolution when ffprobe fails entirely', () => {
  // Simulates ffprobe spawn failure: probe returned null, so signal is all
  // nulls. Only the header buffer can save us. The chain MUST land on
  // header-wav with the right depth.
  const result = resolveBitDepth(
    {
      bitsPerRawSample: null,
      bitsPerSample: null,
      sampleFormat: null,
      codecName: null,
    },
    'wav',
    buildWavHeader({ bitsPerSample: 24 })
  );
  assert.deepEqual(result, { bitDepth: 24, source: 'header-wav' });
});

test('orchestrator — lossy short-circuit when nothing else fires (mp3 with empty signal)', () => {
  const result = resolveBitDepth(
    {
      bitsPerRawSample: null,
      bitsPerSample: null,
      sampleFormat: null,
      codecName: null,
    },
    'mp3',
    null
  );
  assert.deepEqual(result, { bitDepth: null, source: 'extension-hint-lossy' });
});

test('orchestrator — full failure returns unknown when no signal and no header', () => {
  const result = resolveBitDepth(
    {
      bitsPerRawSample: null,
      bitsPerSample: null,
      sampleFormat: null,
      codecName: null,
    },
    null,
    null
  );
  assert.deepEqual(result, { bitDepth: null, source: 'unknown' });
});

test('orchestrator — never throws on bad header buffer (graceful chain to next step)', () => {
  // Garbage header — first 4 bytes are NOT RIFF/FORM/fLaC. Parser
  // returns null silently. Without a follow-up source the result is
  // 'unknown' for .wav (which has no lossy short-circuit).
  const garbageHeader = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
  const result = resolveBitDepth(
    {
      bitsPerRawSample: null,
      bitsPerSample: null,
      sampleFormat: null,
      codecName: null,
    },
    'wav',
    garbageHeader
  );
  assert.deepEqual(result, { bitDepth: null, source: 'unknown' });
});

test('orchestrator — null sample_fmt + null codec_name + lossless ext + valid header → header wins', () => {
  // The exact "everything else failed" path: ffprobe gave us NOTHING but
  // the file is a real WAV on disk. Header parser must rescue.
  const result = resolveBitDepth(
    {
      bitsPerRawSample: null,
      bitsPerSample: null,
      sampleFormat: null,
      codecName: null,
    },
    'wav',
    buildWavHeader({ bitsPerSample: 32, audioFormat: 3 })
  );
  assert.deepEqual(result, { bitDepth: 32, source: 'header-wav' });
});
