import { describe, expect, it } from 'vitest';
import { formatBytes } from './formatBytes';

describe('formatBytes', () => {
  it('formats zero bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats sub-KB values as integer bytes', () => {
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(42)).toBe('42 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('switches to KB at 1024 with 1 decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats KB values with 1 decimal place', () => {
    // 1023456 / 1024 = 999.4687... -> '999.5 KB'
    expect(formatBytes(1023456)).toBe('999.5 KB');
  });

  it('formats MB values with 1 decimal place', () => {
    const MB = 1024 * 1024;
    expect(formatBytes(MB)).toBe('1.0 MB');
    // 14.7 MB target
    expect(formatBytes(Math.round(14.7 * MB))).toBe('14.7 MB');
  });

  it('formats GB values with 1 decimal place', () => {
    const GB = 1024 * 1024 * 1024;
    expect(formatBytes(GB)).toBe('1.0 GB');
    expect(formatBytes(GB * 2)).toBe('2.0 GB');
    expect(formatBytes(Math.round(GB * 3.4))).toBe('3.4 GB');
  });

  it('clamps negative values to 0 B', () => {
    expect(formatBytes(-100)).toBe('0 B');
    expect(formatBytes(-0.5)).toBe('0 B');
  });

  it('returns 0 B for non-finite / non-numeric inputs', () => {
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B');
    expect(formatBytes(Number.NEGATIVE_INFINITY)).toBe('0 B');
    // @ts-expect-error defensive: caller might pass non-number
    expect(formatBytes(undefined)).toBe('0 B');
    // @ts-expect-error defensive: caller might pass non-number
    expect(formatBytes('100')).toBe('0 B');
  });
});
