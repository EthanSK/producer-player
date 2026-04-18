/**
 * Technical details for the ℹ info popovers on mastering panels.
 *
 * Each string is a terse, engineer-facing explanation of how the measurement
 * is computed, what data source it comes from, and any accuracy caveats.
 * Keep each to 3-5 sentences.
 */

export const TECH_INFO_INTEGRATED_LUFS =
  `Measured via FFmpeg ebur128 filter (EBU R128 / ITU-R BS.1770-4) — the gold-standard algorithm with K-frequency-weighting and gating. This is the authoritative value used for all platform normalization calculations. The "Current loudness" stat is a separate, approximate estimate derived from the offline full-file Web Audio decode — see its own info popover for details.`;

export const TECH_INFO_TRUE_PEAK =
  `True Peak is measured by FFmpeg ebur128 with peak=true, which applies 4x oversampling per ITU-R BS.1770 to detect inter-sample peaks. This is the authoritative dBTP value. The real-time peak shown in the Level Meter comes from Web Audio getTimeDomainData() at sample rate — no oversampling — so it may underread inter-sample peaks by up to ~0.5 dB.`;

export const TECH_INFO_LRA =
  `Loudness Range is computed by FFmpeg ebur128 per EBU R128 / EBU Tech 3342. It calculates the statistical spread of 3-second short-term loudness values, excluding the top 5% and bottom 10% to remove brief outliers. The result is a single LU value. This is the authoritative measurement — no Web Audio approximation is used.`;

export const TECH_INFO_SPECTRUM =
  `Real-time FFT via Web Audio AnalyserNode. The main analyser uses fftSize 4096 (2048 frequency bins), yielding ~10.8 Hz resolution at 44.1 kHz. Windowing is Blackman (the AnalyserNode default). Display is logarithmic frequency, linear dB. Band soloing uses BiquadFilterNodes in the Web Audio graph — the audio is filtered in real-time, not reconstructed from the FFT.`;

export const TECH_INFO_MID_SIDE_SPECTRUM =
  `Mid and Side are computed from the separate L/R AnalyserNode outputs (fftSize 2048). Each bin's dB value is converted to linear amplitude, then Mid = (L+R)/2, Side = (L-R)/2. Because the AnalyserNode only exposes magnitude (not complex phase), this is a magnitude-domain M/S split — phase-approximate. Fine for visual spectrum comparison; not suitable for precise M/S processing or reconstruction.`;

export const TECH_INFO_LEVEL_METER =
  `Average level is computed from Web Audio getTimeDomainData() (RMS of the time-domain buffer). Peak hold tracks the maximum absolute sample value over recent frames. No oversampling is applied — the meter reads sample-level peaks, not true peaks. For inter-sample-accurate peak reading, refer to the True Peak stat (FFmpeg-measured). The meter gradient maps roughly to dBFS: green < -12, yellow -12 to -3, red > -3.`;

export const TECH_INFO_CREST_FACTOR =
  `Crest Factor = Sample Peak dBFS minus RMS dBFS, computed from the full-file Web Audio decode (AudioContext.decodeAudioData). Both peak and RMS are measured from a mono downmix of all channels. This is an offline whole-file calculation — not a real-time reading. The real-time Crest Factor Graph uses the Web Audio AnalyserNode (rolling RMS and peak from time-domain data) for its animated display.`;

export const TECH_INFO_PLATFORM_NORMALIZATION =
  `This is a simulation, not the actual platform algorithm. Gain is calculated as: targetLufs - measuredIntegratedLufs (from FFmpeg). For "peak-limited-upward" platforms (Spotify, Apple Music), positive gain is capped so projected true peak stays below the platform's dBTP ceiling. For "down-only" platforms (YouTube, Tidal, Amazon), no boost is applied — only attenuation. The actual platform implementations may differ in edge cases (e.g., album normalization, codec-specific behavior).`;

export const TECH_INFO_LEVEL_MATCH =
  `Level Match gain = mix integrated LUFS - reference integrated LUFS. Both values come from the FFmpeg-measured (authoritative) integrated LUFS, not the Web Audio preview estimate. When Platform Normalization is ON, Level Match uses the residual delta between projected LUFS of both tracks (after applying platform normalization), so it only corrects the difference the platform doesn't already equalize. This handles down-only platforms and headroom-capped boosts correctly.`;

export const TECH_INFO_LOUDNESS_HISTORY =
  `The curve plots per-frame loudness from the full-file Web Audio decode. The track is divided into individual 250 ms frames; each frame's RMS amplitude is converted to dBFS and plotted directly (not a rolling window). This is an RMS-based approximation — not true LUFS (no K-weighting or gating). The dashed horizontal line is the FFmpeg authoritative integrated LUFS for reference. Use this graph for section-by-section comparison, not for final delivery numbers.`;

export const TECH_INFO_WAVEFORM =
  `Waveform peaks are extracted from the full-file Web Audio decode (AudioContext.decodeAudioData). The decoded mono buffer is divided into visual bins matching the display width, and the maximum absolute sample value in each bin becomes the bar height. Values are normalized to the [-1, 1] digital scale. This is a sample-level peak display — it does not show inter-sample peaks.`;

export const TECH_INFO_STEREO_CORRELATION =
  `Computed from the separate L/R AnalyserNode time-domain buffers (getTimeDomainData). The Pearson correlation coefficient is calculated per frame: sum(L*R) / sqrt(sum(L^2) * sum(R^2)). +1 = perfectly correlated (mono), 0 = uncorrelated, -1 = perfectly out of phase. The display is smoothed over time for readability. This is a real-time Web Audio measurement.`;

export const TECH_INFO_VECTORSCOPE =
  `Plots L/R time-domain samples from the separate channel AnalyserNodes onto a rotated coordinate system: vertical axis = Mid (L+R), horizontal axis = Side (L-R). Each frame draws new dots with alpha fade to create the trail. This is a standard Lissajous-style vectorscope. Resolution depends on the AnalyserNode fftSize (2048 samples per frame). Purely a real-time Web Audio visualization.`;

export const TECH_INFO_TONAL_BALANCE =
  `Energy distribution is computed from the full-file Web Audio decode (mono downmix). Three bands are separated using simple 1-pole IIR filters in the time domain: Low = low-pass at 250 Hz, Mid = band-pass 250-4000 Hz, High = high-pass at 4000 Hz. Each band's energy is the sum of squared filter-output samples, expressed as a percentage of total energy. When "EQ'd" mode is on, the displayed percentages reflect estimated energy shifts from the applied EQ curve.`;

export const TECH_INFO_K_METERING =
  `K-System values are derived from the FFmpeg volumedetect mean_volume (RMS in dBFS). K-14: value = meanVolumeDbfs + 14. K-20: value = meanVolumeDbfs + 20. A reading of 0 dB on the K-scale means your RMS level equals the calibrated reference (-14 dBFS for K-14, -20 dBFS for K-20). These are static whole-file values, not real-time.`;

export const TECH_INFO_QUICK_DIAGNOSTICS =
  `The Dynamic Range classification is based on the whole-file Crest Factor (peak dBFS - RMS dBFS from the Web Audio decode). High DR: > 10 dB. Medium DR: 6-10 dB. Low DR: < 6 dB. This is a simplified indicator — it does not account for perceptual weighting or gating. For a standards-based dynamic measure, see the Loudness Range (LRA) stat from FFmpeg.`;

export const TECH_INFO_MASTERING_CHECKLIST =
  `Loudness / Peaks / Dynamics / Spectrum / Housekeeping rules are evaluated against a mix of FFmpeg-measured (authoritative) values and the Web Audio full-file decode (renderer-side analysis). Key thresholds: LUFS pass -16..-8 (warn -20..-16 or -8..-7, fail outside), True Peak pass < -1 dBTP (warn -1..0, fail >= 0), Clipping pass 0 samples (warn 1-3, fail >= 4), DC Offset pass |mean| <= 0.001 (warn above). New v3.28 checks cover loudness range (LRA), short-term/momentary peaks, crest factor/PLR, inter-sample risk, over-limiting duration, bass/treble balance, leading/trailing silence, sample-rate conformance, noise floor, and truncated tail. All thresholds are industry conventions, not hard rules — passing everything means your master is technically clean for distribution.`;

export const TECH_INFO_CREST_FACTOR_HISTORY =
  `The animated graph plots real-time Crest Factor from the Web Audio AnalyserNode. Each frame: peak = max absolute value from getTimeDomainData(); RMS = root-mean-square of the same buffer. Crest Factor = 20*log10(peak/RMS). The graph retains the last ~30 seconds of readings. Color zones: green > 8 dB, yellow 6-8 dB, red < 6 dB. This is an approximate real-time estimate — the whole-file Crest Factor stat (from the full decode) is more accurate.`;

export const TECH_INFO_LOUDNESS_DISTRIBUTION =
  `Histogram bins are built from the full-file Web Audio decode frame loudness values (RMS per 250 ms frame, in dBFS). Each bin spans 1 dB. The yellow streaming-range band marks -16 to -6 LUFS — it shows where platform normalization targets fall, not a mastering recommendation. Note: the X-axis values are frame-level dBFS (no K-weighting), so they approximate but do not exactly equal LUFS.`;

export const TECH_INFO_SPECTROGRAM =
  `Scrolling heatmap rendered from the Web Audio AnalyserNode (fftSize 4096). Each column is one animation frame's frequency snapshot, painted as vertical pixel strips with color mapped to dB amplitude. Frequency axis is logarithmic (20 Hz - 20 kHz). Color scale: dark blue = quiet, green = moderate, yellow = loud, red = very loud. New columns are written at ~20 fps (50 ms throttle). This is a real-time visualization — it does not use the full-file analysis.`;

export const TECH_INFO_CURRENT_LOUDNESS =
  `Current loudness is estimated from the offline full-file Web Audio decode (AudioContext.decodeAudioData), not from FFmpeg or a live AnalyserNode. The track is divided into 250 ms frames (each frame's RMS converted to dBFS). At the current playback position, the prior ~3 seconds of frames are averaged (power-domain RMS). This is an RMS-based trailing window estimate — not true LUFS (no K-weighting or gating) — so it may differ from FFmpeg short-term loudness values.`;

export const TECH_INFO_SAMPLE_PEAK =
  `Sample Peak is the highest absolute sample value found by FFmpeg volumedetect (max_volume). It scans every digital sample in the file without oversampling. This will always be equal to or lower than True Peak, because it cannot detect peaks that form between samples during D/A reconstruction. For distribution compliance, True Peak (dBTP) is the relevant metric.`;

export const TECH_INFO_PEAK_SHORT_TERM =
  `Peak Short-Term is the maximum 3-second EBU R128 short-term loudness value across the entire file, extracted from FFmpeg ebur128 frame-by-frame output. FFmpeg outputs an "S:" value every 100 ms; the highest is reported here. This is a static whole-file measurement, not a real-time reading.`;

export const TECH_INFO_PEAK_MOMENTARY =
  `Peak Momentary is the maximum 400 ms EBU R128 momentary loudness value across the entire file, extracted from FFmpeg ebur128 frame-by-frame output. FFmpeg outputs an "M:" value every 100 ms; the highest is reported here. The shorter window catches brief transient bursts that the 3-second short-term window smooths over.`;

export const TECH_INFO_MEAN_VOLUME =
  `Mean Volume is the RMS (Root Mean Square) level of the entire file, measured by FFmpeg volumedetect and reported in dBFS. It squares every sample, averages, and takes the square root — a purely mathematical energy average with no perceptual weighting. Unlike LUFS, it does not apply K-frequency-weighting or gating.`;

export const TECH_INFO_CLIP_COUNT =
  `Clip Count is computed from the full-file Web Audio decode (AudioContext.decodeAudioData). Every sample whose absolute value >= 1.0 is counted as a clip. This checks the decoded PCM data — it does not account for clipping that may occur during lossy codec encoding/decoding. A non-zero count indicates digital hard-clipping is baked into the file.`;

export const TECH_INFO_DC_OFFSET =
  `DC Offset is the arithmetic mean of all sample values from the full-file Web Audio decode (mono downmix). A perfectly centered waveform has a mean of 0. The warning threshold is 0.001 (0.1%). DC offset wastes headroom and can cause clicks at edit boundaries. It is typically caused by faulty hardware or certain analog-modeled plugins.`;

export const TECH_INFO_MID_SIDE_MONITORING =
  `Mid/Side listening uses a Web Audio ScriptProcessorNode (bufferSize 4096, 2-in/2-out). Mid = (L + R) / 2 played to both channels. Side = (L - R) / 2 played to both channels. This is a real-time audio-domain split — not magnitude-approximate like the M/S Spectrum display. You are hearing the actual mono or difference signal.`;
