#!/usr/bin/env python3
"""Compare an OS-level app-audio capture with the source file it should contain.

The comparison is intentionally time-based rather than checksum-based. Output
devices, sample-rate conversion, gain, and plug-ins may change sample values,
but a professional playback path must still move monotonically through the
source without repeats, stalls, jumps, or unexplained silence.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np


@dataclass(frozen=True)
class Thresholds:
    minimum_anchor_correlation: float = 0.36
    minimum_median_correlation: float = 0.52
    minimum_p10_correlation: float = 0.22
    maximum_p95_timing_residual_ms: float = 28.0
    maximum_step_error_ms: float = 45.0
    maximum_dropout_ms: float = 35.0


def decode_mono(path: Path, sample_rate: int, limit_seconds: float | None = None) -> np.ndarray:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required but was not found on PATH")

    command = [ffmpeg, "-v", "error", "-nostdin", "-i", str(path)]
    if limit_seconds is not None:
        command.extend(["-t", f"{limit_seconds:.6f}"])
    command.extend(
        ["-vn", "-ac", "1", "-ar", str(sample_rate), "-f", "f32le", "pipe:1"]
    )
    completed = subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    samples = np.frombuffer(completed.stdout, dtype="<f4").astype(np.float32, copy=True)
    if samples.size == 0:
        raise RuntimeError(f"ffmpeg decoded no audio from {path}")
    samples[~np.isfinite(samples)] = 0
    return samples


def rms(samples: np.ndarray) -> float:
    if samples.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(samples, dtype=np.float64))))


def normalized_windows(
    samples: np.ndarray,
    window_samples: int,
    step_samples: int,
) -> tuple[np.ndarray, np.ndarray]:
    if samples.size < window_samples:
        raise RuntimeError("Audio is shorter than the comparison window")
    windows = np.lib.stride_tricks.sliding_window_view(samples, window_samples)[::step_samples]
    windows = np.asarray(windows, dtype=np.float32)
    centered = windows - np.mean(windows, axis=1, keepdims=True)
    norms = np.linalg.norm(centered, axis=1)
    safe_norms = np.maximum(norms, 1e-9)
    return centered / safe_norms[:, None], norms


def percentile(values: np.ndarray, amount: float, default: float = 0.0) -> float:
    if values.size == 0:
        return default
    return float(np.percentile(values, amount))


def longest_true_run(mask: np.ndarray, block_seconds: float) -> float:
    longest = 0
    current = 0
    for value in mask.tolist():
        if value:
            current += 1
            longest = max(longest, current)
        else:
            current = 0
    return longest * block_seconds


def compare_arrays(
    source: np.ndarray,
    capture: np.ndarray,
    sample_rate: int,
    thresholds: Thresholds | None = None,
) -> dict[str, Any]:
    thresholds = thresholds or Thresholds()
    window_seconds = 0.18
    hop_seconds = 0.04
    candidate_step_seconds = 0.005
    local_radius_seconds = 0.40
    window_samples = max(64, round(window_seconds * sample_rate))
    hop_samples = max(1, round(hop_seconds * sample_rate))
    candidate_step_samples = max(1, round(candidate_step_seconds * sample_rate))
    local_radius_candidates = max(1, round(local_radius_seconds / candidate_step_seconds))

    # A first difference rejects DC/slow gain changes while retaining musical
    # timing and transient identity. This makes alignment resilient to EQ and
    # output-volume differences.
    source_feature = np.diff(source, prepend=source[0]).astype(np.float32)
    capture_feature = np.diff(capture, prepend=capture[0]).astype(np.float32)
    source_windows, source_norms = normalized_windows(
        source_feature, window_samples, candidate_step_samples
    )
    capture_windows, capture_norms = normalized_windows(capture_feature, window_samples, hop_samples)

    capture_frame_times = (
        np.arange(capture_windows.shape[0], dtype=np.float64) * hop_samples / sample_rate
    )
    source_candidate_times = (
        np.arange(source_windows.shape[0], dtype=np.float64)
        * candidate_step_samples
        / sample_rate
    )

    # Locate one high-confidence source/capture anchor globally. Unrelated audio
    # before the target track simply produces low correlations and is ignored.
    global_best_correlations = np.empty(capture_windows.shape[0], dtype=np.float32)
    global_best_indices = np.empty(capture_windows.shape[0], dtype=np.int32)
    for frame_index, capture_window in enumerate(capture_windows):
        correlations = source_windows @ capture_window
        best_index = int(np.argmax(correlations))
        global_best_indices[frame_index] = best_index
        global_best_correlations[frame_index] = correlations[best_index]

    energetic = capture_norms > max(float(np.median(capture_norms)) * 0.08, 1e-7)
    eligible_anchor_scores = np.where(energetic, global_best_correlations, -1.0)
    anchor_frame = int(np.argmax(eligible_anchor_scores))
    anchor_correlation = float(global_best_correlations[anchor_frame])
    anchor_source_time = float(source_candidate_times[global_best_indices[anchor_frame]])
    anchor_capture_time = float(capture_frame_times[anchor_frame])
    initial_intercept = anchor_source_time - anchor_capture_time

    def local_alignment(intercept: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        positions = np.full(capture_windows.shape[0], np.nan, dtype=np.float64)
        best_correlations = np.full(capture_windows.shape[0], -1.0, dtype=np.float32)
        expected_correlations = np.full(capture_windows.shape[0], -1.0, dtype=np.float32)
        for frame_index, capture_window in enumerate(capture_windows):
            expected_source_time = capture_frame_times[frame_index] + intercept
            expected_index = int(round(expected_source_time / candidate_step_seconds))
            if expected_index < 0 or expected_index >= source_windows.shape[0]:
                continue
            lower = max(0, expected_index - local_radius_candidates)
            upper = min(source_windows.shape[0], expected_index + local_radius_candidates + 1)
            correlations = source_windows[lower:upper] @ capture_window
            relative_best = int(np.argmax(correlations))
            best_index = lower + relative_best
            positions[frame_index] = source_candidate_times[best_index]
            best_correlations[frame_index] = correlations[relative_best]
            expected_correlations[frame_index] = float(source_windows[expected_index] @ capture_window)
        return positions, best_correlations, expected_correlations

    positions, best_correlations, expected_correlations = local_alignment(initial_intercept)
    high_confidence = (
        np.isfinite(positions)
        & energetic
        & (best_correlations >= thresholds.minimum_p10_correlation)
    )
    if np.any(high_confidence):
        intercept = float(np.median(positions[high_confidence] - capture_frame_times[high_confidence]))
        positions, best_correlations, expected_correlations = local_alignment(intercept)
    else:
        intercept = initial_intercept

    valid = (
        np.isfinite(positions)
        & energetic
        & (best_correlations >= thresholds.minimum_p10_correlation)
    )
    valid_indices = np.flatnonzero(valid)
    timing_residuals_ms = (
        positions[valid] - (capture_frame_times[valid] + intercept)
    ) * 1000.0

    consecutive_pairs: list[tuple[int, int]] = []
    for left, right in zip(valid_indices[:-1], valid_indices[1:]):
        if right == left + 1:
            consecutive_pairs.append((int(left), int(right)))
    if consecutive_pairs:
        advances = np.asarray(
            [positions[right] - positions[left] for left, right in consecutive_pairs],
            dtype=np.float64,
        )
        expected_advances = np.asarray(
            [capture_frame_times[right] - capture_frame_times[left] for left, right in consecutive_pairs],
            dtype=np.float64,
        )
        step_errors_ms = (advances - expected_advances) * 1000.0
    else:
        advances = np.asarray([], dtype=np.float64)
        expected_advances = np.asarray([], dtype=np.float64)
        step_errors_ms = np.asarray([], dtype=np.float64)

    backward_mask = advances < -0.010
    stall_mask = advances < expected_advances * 0.35
    forward_jump_mask = advances > expected_advances * 1.65

    # Independently look for output silence while the aligned source is active.
    block_seconds = 0.02
    block_samples = max(1, round(block_seconds * sample_rate))
    source_offset_samples = round(intercept * sample_rate)
    block_capture_rms: list[float] = []
    block_source_rms: list[float] = []
    block_times: list[float] = []
    for capture_start in range(0, capture.size - block_samples + 1, block_samples):
        source_start = capture_start + source_offset_samples
        if source_start < 0 or source_start + block_samples > source.size:
            continue
        capture_block = capture[capture_start : capture_start + block_samples]
        source_block = source[source_start : source_start + block_samples]
        block_capture_rms.append(rms(capture_block))
        block_source_rms.append(rms(source_block))
        block_times.append(capture_start / sample_rate)
    capture_rms_blocks = np.asarray(block_capture_rms, dtype=np.float64)
    source_rms_blocks = np.asarray(block_source_rms, dtype=np.float64)
    active_source = source_rms_blocks > max(rms(source) * 0.04, 1e-6)
    relative_gain_db = 20.0 * np.log10(
        np.maximum(capture_rms_blocks, 1e-9) / np.maximum(source_rms_blocks, 1e-9)
    )
    normal_gain_db = float(np.median(relative_gain_db[active_source])) if np.any(active_source) else 0.0
    dropout_mask = active_source & (relative_gain_db < normal_gain_db - 18.0)
    longest_dropout_ms = longest_true_run(dropout_mask, block_seconds) * 1000.0

    anomalies: list[dict[str, Any]] = []
    for pair_index, is_backward in enumerate(backward_mask.tolist()):
        if not is_backward:
            continue
        _, right = consecutive_pairs[pair_index]
        anomalies.append(
            {
                "kind": "backward-repeat",
                "captureTimeSeconds": round(float(capture_frame_times[right]), 4),
                "sourceTimeSeconds": round(float(positions[right]), 4),
                "stepErrorMs": round(float(step_errors_ms[pair_index]), 2),
            }
        )
    for pair_index, is_jump in enumerate(forward_jump_mask.tolist()):
        if not is_jump:
            continue
        _, right = consecutive_pairs[pair_index]
        anomalies.append(
            {
                "kind": "forward-skip",
                "captureTimeSeconds": round(float(capture_frame_times[right]), 4),
                "sourceTimeSeconds": round(float(positions[right]), 4),
                "stepErrorMs": round(float(step_errors_ms[pair_index]), 2),
            }
        )

    matched_best = best_correlations[valid]
    matched_expected = expected_correlations[valid]
    metrics = {
        "sampleRate": sample_rate,
        "sourceDurationSeconds": round(source.size / sample_rate, 4),
        "captureDurationSeconds": round(capture.size / sample_rate, 4),
        "anchorCorrelation": round(anchor_correlation, 5),
        "anchorCaptureTimeSeconds": round(anchor_capture_time, 4),
        "anchorSourceTimeSeconds": round(anchor_source_time, 4),
        "sourceMinusCaptureOffsetSeconds": round(intercept, 6),
        "matchedWindows": int(valid_indices.size),
        "totalWindows": int(capture_windows.shape[0]),
        "medianBestCorrelation": round(percentile(matched_best, 50), 5),
        "p10ExpectedCorrelation": round(percentile(matched_expected, 10), 5),
        "p95AbsoluteTimingResidualMs": round(
            percentile(np.abs(timing_residuals_ms), 95), 3
        ),
        "maximumAbsoluteStepErrorMs": round(
            float(np.max(np.abs(step_errors_ms))) if step_errors_ms.size else 0.0, 3
        ),
        "backwardRepeatCount": int(np.sum(backward_mask)),
        "stallCount": int(np.sum(stall_mask)),
        "forwardSkipCount": int(np.sum(forward_jump_mask)),
        "longestDropoutMs": round(longest_dropout_ms, 3),
        "medianOutputGainDb": round(normal_gain_db, 3),
    }

    reasons: list[str] = []
    if anchor_correlation < thresholds.minimum_anchor_correlation:
        reasons.append("the capture could not be confidently matched to the source")
    if valid_indices.size < 8:
        reasons.append("too few source-matched windows were available")
    if metrics["medianBestCorrelation"] < thresholds.minimum_median_correlation:
        reasons.append("median waveform correlation was too low")
    if metrics["p10ExpectedCorrelation"] < thresholds.minimum_p10_correlation:
        reasons.append("waveform continuity dropped below the allowed floor")
    if metrics["p95AbsoluteTimingResidualMs"] > thresholds.maximum_p95_timing_residual_ms:
        reasons.append("playback timing wandered away from the source clock")
    if metrics["maximumAbsoluteStepErrorMs"] > thresholds.maximum_step_error_ms:
        reasons.append("a discontinuous repeat/skip was detected")
    if metrics["backwardRepeatCount"] > 0:
        reasons.append("the output moved backward through the source")
    if metrics["longestDropoutMs"] > thresholds.maximum_dropout_ms:
        reasons.append("an unexplained output dropout was detected")

    return {
        "verdict": "PASS" if not reasons else "FAIL",
        "reasons": reasons,
        "metrics": metrics,
        "thresholds": {
            "minimumAnchorCorrelation": thresholds.minimum_anchor_correlation,
            "minimumMedianCorrelation": thresholds.minimum_median_correlation,
            "minimumP10Correlation": thresholds.minimum_p10_correlation,
            "maximumP95TimingResidualMs": thresholds.maximum_p95_timing_residual_ms,
            "maximumStepErrorMs": thresholds.maximum_step_error_ms,
            "maximumDropoutMs": thresholds.maximum_dropout_ms,
        },
        "anomalies": anomalies[:40],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Align an app-output capture to its source and fail on repeats, skips, or dropouts."
    )
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--capture", type=Path, required=True)
    parser.add_argument("--source-search-seconds", type=float, default=12.0)
    parser.add_argument("--sample-rate", type=int, default=2_000)
    parser.add_argument("--json-out", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.source.is_file():
        raise RuntimeError(f"Source file does not exist: {args.source}")
    if not args.capture.is_file():
        raise RuntimeError(f"Capture file does not exist: {args.capture}")
    if args.sample_rate < 1_000 or args.sample_rate > 48_000:
        raise RuntimeError("--sample-rate must be between 1000 and 48000")
    if args.source_search_seconds <= 0:
        raise RuntimeError("--source-search-seconds must be positive")

    source = decode_mono(args.source, args.sample_rate, args.source_search_seconds)
    capture = decode_mono(args.capture, args.sample_rate)
    report = compare_arrays(source, capture, args.sample_rate)
    report["source"] = str(args.source.resolve())
    report["capture"] = str(args.capture.resolve())

    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    metrics = report["metrics"]
    print(f"{report['verdict']}: app-output waveform integrity")
    print(
        "  alignment: "
        f"anchor r={metrics['anchorCorrelation']:.3f}, "
        f"median r={metrics['medianBestCorrelation']:.3f}, "
        f"p10 expected r={metrics['p10ExpectedCorrelation']:.3f}"
    )
    print(
        "  timing: "
        f"p95 residual={metrics['p95AbsoluteTimingResidualMs']:.1f} ms, "
        f"max step error={metrics['maximumAbsoluteStepErrorMs']:.1f} ms, "
        f"backward repeats={metrics['backwardRepeatCount']}, "
        f"forward skips={metrics['forwardSkipCount']}"
    )
    print(f"  longest unexplained dropout: {metrics['longestDropoutMs']:.1f} ms")
    for reason in report["reasons"]:
        print(f"  - {reason}")
    if args.json_out:
        print(args.json_out)
    return 0 if report["verdict"] == "PASS" else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as error:
        stderr = error.stderr.decode("utf-8", errors="replace") if error.stderr else str(error)
        print(f"error: ffmpeg failed: {stderr.strip()}", file=sys.stderr)
        raise SystemExit(1)
    except Exception as error:  # Keep CLI failures concise and automation-friendly.
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1)
