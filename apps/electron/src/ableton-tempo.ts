import { extname } from 'node:path';
import { gunzipSync } from 'node:zlib';

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

/**
 * Ableton Live sets are gzipped XML in normal `.als` files. The project tempo
 * lives in the global mixer `<Tempo>` parameter as a `<Manual Value="...">`.
 * Producer Player uses this as a cheap BPM fallback for Ethan's own bounces:
 * exported WAVs often carry no BPM/TBPM tag, but the linked Ableton project
 * already knows the intended tempo.
 */
export function extractAbletonTempoBpmFromProjectXml(xml: string): number | null {
  const tempoBlocks = xml.matchAll(/<Tempo\b[^>]*>[\s\S]*?<\/Tempo>/gi);

  for (const block of tempoBlocks) {
    const manualValueMatch = block[0].match(/<Manual\b[^>]*\bValue="([^"]+)"/i);
    if (!manualValueMatch) {
      continue;
    }

    const parsed = normalizeAbletonTempoBpm(Number(manualValueMatch[1]));
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

export function extractAbletonTempoBpmFromProjectBuffer(buffer: Buffer): number | null {
  const xmlBuffer =
    buffer.length >= 2 &&
    buffer[0] === GZIP_MAGIC_0 &&
    buffer[1] === GZIP_MAGIC_1
      ? gunzipSync(buffer)
      : buffer;

  return extractAbletonTempoBpmFromProjectXml(xmlBuffer.toString('utf8'));
}

export function isAbletonProjectPath(projectFilePath: string | null | undefined): boolean {
  if (typeof projectFilePath !== 'string' || projectFilePath.trim().length === 0) {
    return false;
  }

  return extname(projectFilePath.trim()).toLowerCase() === '.als';
}

function normalizeAbletonTempoBpm(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }

  const rounded = Math.round(value * 10) / 10;
  if (rounded < 20 || rounded > 400) {
    return null;
  }

  return rounded;
}
