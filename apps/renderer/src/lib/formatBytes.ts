/**
 * v3.204 — Human-readable file-size formatting for toasts and labels.
 *
 * Standard 1024-base (binary) units. Bytes are emitted with no decimal
 * (e.g. `42 B`, `999 B`); KB / MB / GB use exactly 1 decimal place
 * (e.g. `1.2 KB`, `14.7 MB`, `1.0 GB`). Negative inputs are clamped to
 * zero; non-finite or non-numeric inputs return `'0 B'` defensively so
 * a stray NaN can never produce a `NaN B` label.
 */
export function formatBytes(bytes: number): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) {
    return '0 B';
  }
  const safe = Math.max(0, bytes);

  const KB = 1024;
  const MB = 1024 * 1024;
  const GB = 1024 * 1024 * 1024;

  if (safe < KB) {
    return `${Math.trunc(safe)} B`;
  }
  if (safe < MB) {
    return `${(safe / KB).toFixed(1)} KB`;
  }
  if (safe < GB) {
    return `${(safe / MB).toFixed(1)} MB`;
  }
  return `${(safe / GB).toFixed(1)} GB`;
}
