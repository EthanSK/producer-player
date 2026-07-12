#!/usr/bin/env python3

import unittest

import numpy as np

from compare_capture import compare_arrays


class AudioOutputComparisonTests(unittest.TestCase):
    sample_rate = 2_000

    def make_source(self, seconds: float = 8.0) -> np.ndarray:
        rng = np.random.default_rng(42)
        t = np.arange(round(seconds * self.sample_rate), dtype=np.float64) / self.sample_rate
        chirp = np.sin(2 * np.pi * (73 * t + 19 * t * t))
        tones = 0.35 * np.sin(2 * np.pi * 181 * t) + 0.2 * np.sin(2 * np.pi * 337 * t)
        transients = np.zeros_like(t)
        for moment in np.arange(0.15, seconds, 0.37):
            index = round(moment * self.sample_rate)
            length = min(round(0.025 * self.sample_rate), transients.size - index)
            if length > 0:
                transients[index : index + length] += np.linspace(1, 0, length)
        noise = rng.normal(0, 0.015, size=t.size)
        return (0.35 * chirp + tones + 0.45 * transients + noise).astype(np.float32)

    def test_clean_capture_passes_with_unrelated_prefix_and_gain(self) -> None:
        source = self.make_source()
        prefix = np.random.default_rng(7).normal(0, 0.08, self.sample_rate // 2).astype(np.float32)
        capture = np.concatenate([prefix, source[: 5 * self.sample_rate] * 0.62])
        report = compare_arrays(source, capture, self.sample_rate)
        self.assertEqual(report["verdict"], "PASS", report)

    def test_repeated_audio_fails(self) -> None:
        source = self.make_source()
        clean = source[: 5 * self.sample_rate]
        repeat_start = round(1.2 * self.sample_rate)
        repeat_length = round(0.12 * self.sample_rate)
        capture = np.concatenate(
            [clean[:repeat_start], clean[repeat_start - repeat_length : repeat_start], clean[repeat_start:]]
        )
        report = compare_arrays(source, capture, self.sample_rate)
        self.assertEqual(report["verdict"], "FAIL", report)
        self.assertTrue(
            report["metrics"]["backwardRepeatCount"] > 0
            or report["metrics"]["maximumAbsoluteStepErrorMs"] > 45,
            report,
        )

    def test_output_dropout_fails(self) -> None:
        source = self.make_source()
        capture = source[: 5 * self.sample_rate].copy()
        start = round(2.0 * self.sample_rate)
        capture[start : start + round(0.1 * self.sample_rate)] = 0
        report = compare_arrays(source, capture, self.sample_rate)
        self.assertEqual(report["verdict"], "FAIL", report)
        self.assertGreater(report["metrics"]["longestDropoutMs"], 35)


if __name__ == "__main__":
    unittest.main()
