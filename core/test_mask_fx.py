"""Behavioral tests for Mask FX rendering and real optical-flow tracking."""

import math
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from core.mask_fx import effect_scale, matrix_at, normalized_points, render_mask_frame, track_mask
from core.video_utils import JobCancelled


class MaskRenderingTests(unittest.TestCase):
    def setUp(self):
        self.frame = np.full((100, 160, 3), (30, 20, 10), np.uint8)
        self.frame[40:60, 70:90] = (0, 0, 240)
        self.transform = {
            "fxMaskPath": [{"x": x / 160, "y": y / 100} for x, y in [(70, 40), (90, 40), (90, 60), (70, 60)]],
            "maskFx": {"enabled": True, "scale": 200, "start": .2, "enter": .4, "hold": .8, "exit": .4, "bounce": 0},
        }

    def test_envelope_has_enter_hold_exit_and_unaffected_surroundings(self):
        settings = self.transform["maskFx"]
        self.assertEqual(effect_scale(settings, .1), 1)
        self.assertAlmostEqual(effect_scale(settings, .4), 1.5)
        self.assertEqual(effect_scale(settings, .8), 2)
        self.assertAlmostEqual(effect_scale(settings, 1.6), 1.5)
        self.assertEqual(effect_scale(settings, 1.8), 1)
        output = render_mask_frame(self.frame, self.transform, .8, .8)
        self.assertGreater(int(output[50, 65, 2]), 200, "the person expands beyond the original mask")
        np.testing.assert_array_equal(output[0:20], self.frame[0:20])
        np.testing.assert_array_equal(render_mask_frame(self.frame, self.transform, 0, 0), self.frame)

    def test_tracked_mask_samples_current_frame_and_moves_pivot(self):
        shifted = np.full_like(self.frame, (30, 20, 10))
        shifted[40:60, 90:110] = (0, 0, 240)
        self.transform["fxMaskTrack"] = [{"time": .8, "matrix": [1, 0, 0, 1, 20 / 160, 0]}]
        output = render_mask_frame(shifted, self.transform, .8, .8)
        self.assertGreater(int(output[50, 85, 2]), 200)
        np.testing.assert_array_equal(output[50, 60], shifted[50, 60])

    def test_feather_has_soft_edge_without_dark_halo(self):
        image = np.full_like(self.frame, 190)
        self.transform["maskFx"]["feather"] = .025
        output = render_mask_frame(image, self.transform, .8, .8)
        self.assertLessEqual(int(np.abs(output.astype(int) - image).max()), 1)

    def test_matrix_interpolation_and_disable(self):
        transform = {"fxMaskTrack": [{"time": 1, "matrix": [1, 0, 0, 1, .1, 0]}, {"time": 3, "matrix": [2, 0, 0, 2, .3, 0]}]}
        np.testing.assert_allclose(matrix_at(transform, 2), [1.5, 0, 0, 1.5, .2, 0])
        transform["maskFx"] = {"trackingEnabled": False}
        self.assertEqual(matrix_at(transform, 2), [1, 0, 0, 1, 0, 0])

    def test_invalid_polygon_rejected(self):
        for points in ([], [{"x": 0, "y": 0}] * 3, [{"x": 0, "y": 0}, {"x": math.nan, "y": 1}, {"x": 1, "y": 1}]):
            with self.assertRaises(ValueError):
                normalized_points(points)

    @unittest.skipUnless(shutil.which("node"), "Node is required for preview/export parity checks")
    def test_export_math_matches_actual_frontend_module(self):
        script = """
            import { readFileSync } from 'node:fs';
            const moduleText = readFileSync(process.argv[1], 'utf8');
            const { maskStateAt } = await import('data:text/javascript;base64,' + Buffer.from(moduleText).toString('base64'));
            const cases = JSON.parse(readFileSync(0, 'utf8'));
            process.stdout.write(JSON.stringify(cases.map(c => maskStateAt(c.transform, c.time, c.time))));
        """
        path = Path(__file__).resolve().parents[1] / "frontend" / "src" / "components" / "maskFx.js"
        cases = []
        for settings in ({}, {"scale": 280, "start": .2, "enter": .6, "hold": .5, "exit": .7, "bounce": .6},
                         {"scale": 600, "enter": 0, "hold": .6, "exit": 0}, {"enabled": False}, {"trackingEnabled": False}):
            transform = {"fxMaskPath": self.transform["fxMaskPath"], "maskFx": settings,
                         "fxMaskTrack": [{"time": .2, "matrix": [1, 0, 0, 1, 0, 0]}, {"time": 1.8, "matrix": [1.3, .02, -.01, 1.2, .2, -.1]}]}
            for time in (0, .2, .3, .6, .9, 1.3, 1.6, 2, 2.5):
                cases.append({"transform": transform, "time": time})
        result = subprocess.run([shutil.which("node"), "--input-type=module", "-e", script, str(path)],
                                input=json.dumps(cases), capture_output=True, text=True, check=True)
        states = json.loads(result.stdout)
        for case, state in zip(cases, states):
            self.assertAlmostEqual(effect_scale(case["transform"]["maskFx"], case["time"]), state["scale"], places=12)
            np.testing.assert_allclose(matrix_at(case["transform"], case["time"]), state["matrix"], atol=1e-12)


class MaskTrackingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="clipeasy-mask-test-")
        self.path = str(Path(self.temp.name) / "moving.avi")
        rng = np.random.default_rng(7)
        base = np.full((180, 240, 3), 25, np.uint8)
        base[55:125, 65:125] = rng.integers(50, 245, (70, 60, 3), dtype=np.uint8)
        writer = cv2.VideoWriter(self.path, cv2.VideoWriter_fourcc(*"MJPG"), 20, (240, 180))
        self.assertTrue(writer.isOpened())
        self.matrices = []
        for index in range(30):
            matrix = cv2.getRotationMatrix2D((95, 90), index * .25, 1 + index * .003)
            matrix[:, 2] += [index * 1.2, index * .35]
            self.matrices.append(np.vstack([matrix, [0, 0, 1]]))
            writer.write(cv2.warpAffine(base, matrix, (240, 180), borderValue=(25, 25, 25)))
        writer.release()
        self.reference = 12
        corners = np.array([[66, 56, 1], [124, 56, 1], [124, 124, 1], [66, 124, 1]], dtype=float)
        moved = corners @ self.matrices[self.reference].T
        self.points = [{"x": float(x / 240), "y": float(y / 180)} for x, y, _ in moved]

    def tearDown(self):
        self.temp.cleanup()

    def test_tracks_forward_backward_trimmed_source_times(self):
        progress = []
        keyframes = track_mask(self.path, self.points, reference_time=.6, start=.2, duration=.9,
                              progress=lambda done, total: progress.append((done, total)))
        self.assertEqual(len(keyframes), 18)
        self.assertEqual(progress[-1], (18, 18))
        self.assertEqual(keyframes[0]["time"], .2)
        self.assertEqual(keyframes[-1]["time"], 1.05)
        center = self.matrices[self.reference] @ [95, 90, 1]
        errors = []
        for keyframe in keyframes:
            index = round(keyframe["time"] * 20)
            a, b, c, d, e, f = keyframe["matrix"]
            actual = np.array([(a * center[0] / 240 + c * center[1] / 180 + e) * 240,
                               (b * center[0] / 240 + d * center[1] / 180 + f) * 180])
            expected = (self.matrices[index] @ [95, 90, 1])[:2]
            errors.append(np.linalg.norm(actual - expected))
        self.assertLess(max(errors), 2.5, f"tracking errors: {errors}")
        self.assertLess(sum(bool(frame["lost"]) for frame in keyframes), 2)

    def test_cancel_stops_processing(self):
        with self.assertRaises(JobCancelled):
            track_mask(self.path, self.points, reference_time=.6, start=0, duration=1.4, cancelled=lambda: True)

    def test_cancel_during_buffered_backward_frames_and_final_progress(self):
        # The final source frame is the reference so every processed frame is
        # backward. Cancellation must be checked even after a chunk is decoded.
        for stop_at in (3, 30):
            with self.subTest(stop_at=stop_at):
                progress = []
                with self.assertRaises(JobCancelled):
                    track_mask(self.path, self.points, reference_time=1.45, start=0, duration=1.5,
                               progress=lambda done, total: progress.append(done),
                               cancelled=lambda: bool(progress and progress[-1] >= stop_at))
                self.assertEqual(progress[-1], stop_at)

    def test_trim_does_not_move_authored_source_anchor(self):
        center = self.matrices[self.reference] @ [95, 90, 1]
        for start, duration in ((.9, .4), (.1, .3)):
            with self.subTest(start=start):
                frames = track_mask(self.path, self.points, reference_time=.6, start=start, duration=duration)
                self.assertEqual(len(frames), round(duration * 20))
                self.assertAlmostEqual(frames[0]["time"], start)
                for frame in frames:
                    a, b, c, d, e, f = frame["matrix"]
                    actual = np.array([(a * center[0] / 240 + c * center[1] / 180 + e) * 240,
                                       (b * center[0] / 240 + d * center[1] / 180 + f) * 180])
                    expected = (self.matrices[round(frame["time"] * 20)] @ [95, 90, 1])[:2]
                    self.assertLess(np.linalg.norm(actual - expected), 2.5)

    def test_tracking_coordinates_survive_resolution_change(self):
        large_path = str(Path(self.temp.name) / "moving-large.avi")
        source = cv2.VideoCapture(self.path)
        writer = cv2.VideoWriter(large_path, cv2.VideoWriter_fourcc(*"MJPG"), 20, (1200, 900))
        self.assertTrue(writer.isOpened())
        try:
            while True:
                valid, frame = source.read()
                if not valid:
                    break
                writer.write(cv2.resize(frame, (1200, 900)))
        finally:
            source.release()
            writer.release()
        small = track_mask(self.path, self.points, reference_time=.6, start=.2, duration=.9)
        large = track_mask(large_path, self.points, reference_time=.6, start=.2, duration=.9)
        point = np.array([self.points[0]["x"], self.points[0]["y"], 1])
        for left, right in zip(small, large):
            def apply(matrix):
                a, b, c, d, e, f = matrix
                return np.array([[a, c, e], [b, d, f]]) @ point
            np.testing.assert_allclose(apply(left["matrix"]), apply(right["matrix"]), atol=.015)
        self.assertLess(sum(frame["lost"] for frame in large), 2)

    def test_blank_region_reports_lost_instead_of_false_confidence(self):
        points = [{"x": .01, "y": .01}, {"x": .06, "y": .01}, {"x": .06, "y": .06}, {"x": .01, "y": .06}]
        frames = track_mask(self.path, points, reference_time=.2, start=.1, duration=.2)
        self.assertTrue(any(frame["lost"] for frame in frames))


if __name__ == "__main__":
    unittest.main()
