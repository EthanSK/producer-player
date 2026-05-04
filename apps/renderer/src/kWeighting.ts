/**
 * ITU-R BS.1770 K-weighting curve.
 *
 * K-weighting is the per-frequency perceptual weight applied to an audio
 * signal before LUFS / EBU R128 loudness is integrated. It is a fixed
 * filter shape (not a per-track measurement) consisting of two cascaded
 * biquad stages defined in ITU-R BS.1770-4 Annex 1:
 *
 *   1. Stage 1 — "pre-filter": a high-shelving boost of roughly +4 dB
 *      at high frequencies, centred above ~1.5 kHz. Approximates the
 *      acoustic effect of the head on a free-field signal.
 *
 *   2. Stage 2 — "RLB" (Revised Low-frequency B-curve): a high-pass
 *      with -3 dB at ~38 Hz. Discounts the contribution of very low
 *      frequencies because the ear is far less sensitive to them.
 *
 * The reference coefficients are specified at 48 kHz sample rate. We
 * use those canonical coefficients to plot the curve magnitude-vs-frequency
 * — this is the standard way the K-weighting shape is displayed in
 * loudness-spec literature.
 *
 * Reference: ITU-R BS.1770-4 Annex 1 §1.1, Tables 1–2.
 */

export interface CurvePoint {
  freq: number;
  gainDb: number;
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a0: number;
  a1: number;
  a2: number;
}

/**
 * ITU-R BS.1770-4 K-weighting biquad coefficients at fs = 48 kHz.
 * These values are taken directly from the standard.
 */
export const K_WEIGHTING_REFERENCE_SAMPLE_RATE = 48000;

export const K_WEIGHTING_STAGE1_PREFILTER: Biquad = {
  b0: 1.53512485958697,
  b1: -2.69169618940638,
  b2: 1.19839281085285,
  a0: 1.0,
  a1: -1.69065929318241,
  a2: 0.73248077421585,
};

export const K_WEIGHTING_STAGE2_RLB: Biquad = {
  b0: 1.0,
  b1: -2.0,
  b2: 1.0,
  a0: 1.0,
  a1: -1.99004745483398,
  a2: 0.99007225036621,
};

/**
 * Magnitude (in dB) of a single biquad at frequency `freq`, sample rate `fs`.
 * Uses the standard digital-biquad transfer-function evaluation at z = e^{jw}.
 */
function biquadMagnitudeDb(filter: Biquad, freq: number, fs: number): number {
  const w = (2 * Math.PI * freq) / fs;
  const cosw = Math.cos(w);
  const cos2w = Math.cos(2 * w);
  const sinw = Math.sin(w);
  const sin2w = Math.sin(2 * w);

  // Numerator: b0 + b1*z^-1 + b2*z^-2 at z = e^{jw}
  const nReal = filter.b0 + filter.b1 * cosw + filter.b2 * cos2w;
  const nImag = -(filter.b1 * sinw + filter.b2 * sin2w);
  // Denominator: a0 + a1*z^-1 + a2*z^-2
  const dReal = filter.a0 + filter.a1 * cosw + filter.a2 * cos2w;
  const dImag = -(filter.a1 * sinw + filter.a2 * sin2w);

  const numMagSq = nReal * nReal + nImag * nImag;
  const denMagSq = dReal * dReal + dImag * dImag;
  if (denMagSq === 0 || numMagSq === 0) {
    return -200;
  }
  const magSq = numMagSq / denMagSq;
  return 10 * Math.log10(magSq);
}

/**
 * K-weighting magnitude in dB at a single frequency (Hz).
 *
 * Uses the canonical 48 kHz BS.1770-4 coefficients. The reference curve
 * is normalized so that the response at 1 kHz is exactly 0 dB, matching
 * how the curve is conventionally displayed.
 */
export function kWeightingDbAtFrequency(freq: number): number {
  const fs = K_WEIGHTING_REFERENCE_SAMPLE_RATE;
  if (freq <= 0) return -200;
  // Avoid numerical issues right at Nyquist.
  const fEff = Math.min(freq, fs / 2 - 1);
  const stage1 = biquadMagnitudeDb(K_WEIGHTING_STAGE1_PREFILTER, fEff, fs);
  const stage2 = biquadMagnitudeDb(K_WEIGHTING_STAGE2_RLB, fEff, fs);
  return stage1 + stage2 - K_WEIGHTING_NORMALIZATION_DB;
}

/**
 * Cached normalization offset so that K-weighting at 1 kHz reads as 0 dB.
 * This matches how K-weighting curves are conventionally drawn (the
 * 1 kHz reference point is the "0 dB" anchor).
 */
const K_WEIGHTING_NORMALIZATION_DB: number = (() => {
  const fs = K_WEIGHTING_REFERENCE_SAMPLE_RATE;
  const stage1 = biquadMagnitudeDb(K_WEIGHTING_STAGE1_PREFILTER, 1000, fs);
  const stage2 = biquadMagnitudeDb(K_WEIGHTING_STAGE2_RLB, 1000, fs);
  return stage1 + stage2;
})();

/**
 * Sample the K-weighting curve at `numPoints` logarithmically-spaced
 * frequencies between `minFreq` and `maxFreq` (defaults: 20 Hz ↔ 20 kHz,
 * 256 points — plenty for a smooth on-screen render).
 */
export function buildKWeightingCurve(
  numPoints = 256,
  minFreq = 20,
  maxFreq = 20000
): CurvePoint[] {
  const points: CurvePoint[] = [];
  const logMin = Math.log10(minFreq);
  const logMax = Math.log10(maxFreq);
  for (let i = 0; i < numPoints; i++) {
    const t = numPoints === 1 ? 0 : i / (numPoints - 1);
    const freq = Math.pow(10, logMin + t * (logMax - logMin));
    points.push({ freq, gainDb: kWeightingDbAtFrequency(freq) });
  }
  return points;
}
