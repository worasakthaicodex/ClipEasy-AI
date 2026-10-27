"""Encoded-output regression checks for timeline Mask FX and edited audio.

Run: venv/Scripts/python.exe -m unittest core.test_mask_export -v
"""
import json
import copy
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

from core.video_utils import FFMPEG, FFPROBE, merge_videos


class MaskExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        work = Path("_work").resolve()
        work.mkdir(exist_ok=True)
        cls.temp = tempfile.TemporaryDirectory(prefix="mask_export_test_", dir=work)
        cls.source = str(Path(cls.temp.name) / "moving_subject.mp4")
        # A moving white subject; source audio is silent until source time 1.5 s.
        args = [FFMPEG, "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "bgr24",
                "-s", "160x100", "-r", "20", "-i", "pipe:0", "-f", "lavfi", "-i",
                "aevalsrc=if(lt(t\\,1.5)\\,0\\,0.3*sin(2*PI*440*t)):s=48000:d=4",
                "-c:v", "libx264", "-crf", "0", "-pix_fmt", "yuv444p", "-c:a", "aac",
                "-t", "4", cls.source]
        frames = []
        for index in range(80):
            frame = np.zeros((100, 160, 3), np.uint8)
            x = 40 + int(index / 20 * 8)
            frame[35:55, x:x+20] = 240
            frames.append(frame.tobytes())
        subprocess.run(args, input=b"".join(frames), capture_output=True, check=True)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.outputs = []
        self.transform = {
            "fxMaskPath": [{"x": .25, "y": .35}, {"x": .375, "y": .35},
                           {"x": .375, "y": .55}, {"x": .25, "y": .55}],
            "fxMaskTime": 0,
            "fxMaskTrack": [{"time": 0, "matrix": [1, 0, 0, 1, 0, 0]},
                            {"time": 4, "matrix": [1, 0, 0, 1, .2, 0]}],
            "maskFx": {"enabled": True, "scale": 200, "start": .2, "enter": .2,
                       "hold": .2, "exit": .2, "bounce": 0, "feather": 0,
                       "trackingEnabled": True},
        }

    def tearDown(self):
        for output in self.outputs:
            Path(output).unlink(missing_ok=True)

    def export(self, segments, **settings):
        path = merge_videos(segments, settings={"fps": 20, "crf": 12, "encode_preset": "ultrafast", **settings})
        self.outputs.append(path)
        return path

    def frame(self, path, time):
        cap = cv2.VideoCapture(path)
        cap.set(cv2.CAP_PROP_POS_MSEC, time * 1000)
        ok, frame = cap.read()
        cap.release()
        self.assertTrue(ok)
        return frame

    def subject_bounds(self, frame):
        ys, xs = np.where(frame.mean(axis=2) > 180)
        self.assertGreater(len(xs), 0)
        return xs.min(), xs.max(), ys.min(), ys.max()

    def audio(self, path):
        result = subprocess.run([FFMPEG, "-v", "error", "-i", path, "-vn", "-f", "f32le",
                                 "-acodec", "pcm_f32le", "-ar", "48000", "-ac", "2", "pipe:1"],
                                capture_output=True, check=True)
        return np.frombuffer(result.stdout, np.float32).reshape(-1, 2)

    def rms(self, audio, start, end):
        sample = audio[int(start*48000):int(end*48000)]
        return np.sqrt(np.mean(sample**2, axis=0))

    def test_mask_export_matches_timing_tracking_trim_speed_gaps_and_attached_audio(self):
        path = self.export([{"path": self.source, "start": 1, "duration": 2, "speed": 2,
                             "offset": .4, "transform": self.transform}], timeline_duration=2)
        self.assertLess(self.frame(path, .2).max(), 10, "leading gap must remain black")
        self.assertLess(self.frame(path, 1.65).max(), 10, "trailing gap must remain black")
        before = self.subject_bounds(self.frame(path, .5))
        peak = self.subject_bounds(self.frame(path, .9))
        after = self.subject_bounds(self.frame(path, 1.3))
        self.assertLessEqual(before[1]-before[0], 21)
        self.assertGreaterEqual(peak[1]-peak[0], 38, "Mask must enlarge only during its envelope")
        self.assertLessEqual(after[1]-after[0], 21)
        # Source time is 2 s at output 0.9 s, so the tracked center is x=66.
        self.assertAlmostEqual((peak[0]+peak[1])/2, 66, delta=2)
        audio = self.audio(path)
        self.assertLess(float(self.rms(audio, .42, .55).max()), .015, "source trim/speed must keep initial silence")
        self.assertGreater(float(self.rms(audio, .9, 1.1).min()), .1, "baking must preserve original attached audio")
        self.assertLess(float(self.rms(audio, 1.7, 1.9).max()), .005, "audio must not leak beyond clip")
        metadata = json.loads(subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration",
                                              "-of", "json", path], capture_output=True, text=True, check=True).stdout)
        self.assertAlmostEqual(float(metadata["format"]["duration"]), 2, delta=.06)

    def test_detached_audio_edit_is_preserved_and_mask_on_overlay_exports(self):
        # Entire base is muted. Only an edited 0.4-second detached slice is audible.
        base = {"path": self.source, "start": 2, "duration": 2, "speed": 1, "offset": 0, "mute": True}
        overlay = {"path": self.source, "start": 1, "duration": 2, "speed": 2,
                   "offset": .4, "track": 3, "mute": True, "transform": self.transform}
        audio_clip = {"path": self.source, "start": 2, "duration": .8, "speed": 2,
                      "offset": .8, "volume": 40, "pan": -100, "fade_in": .05, "fade_out": .05}
        path = self.export([base], overlays=[overlay], detached_audio=[audio_clip])
        peak = self.subject_bounds(self.frame(path, .9))
        self.assertGreaterEqual(peak[1]-peak[0], 38)
        audio = self.audio(path)
        self.assertLess(float(self.rms(audio, .2, .6).max()), .005)
        sound = self.rms(audio, .9, 1.1)
        self.assertGreater(float(sound[0]), .03)
        self.assertLess(float(sound[0]), .12, "detached volume must affect actual encoded audio")
        self.assertLess(float(sound[1]), .005, "pan must affect actual encoded channels")
        self.assertLess(float(self.rms(audio, 1.4, 1.8).max()), .005)

    def test_unsupported_mask_effect_combination_fails_explicitly(self):
        self.transform["videoFx"] = "crt-screen"
        with self.assertRaisesRegex(ValueError, "Mask FX"):
            self.export([{"path": self.source, "start": 0, "duration": 1, "transform": self.transform}])

    def test_default_enabled_mask_and_explicit_disable_match_preview(self):
        transform = {"fxMaskPath": self.transform["fxMaskPath"],
                     "fxMaskTrack": self.transform["fxMaskTrack"]}
        clip = {"path": self.source, "start": 0, "duration": 1, "mute": True, "transform": transform}
        enabled = self.export([clip], audio=False)
        bounds = self.subject_bounds(self.frame(enabled, .5))
        self.assertGreaterEqual(bounds[1] - bounds[0], 29, "saved polygons use preview's enabled 160% defaults")
        transform["maskFx"] = {"enabled": False}
        disabled = self.export([clip], audio=False)
        bounds = self.subject_bounds(self.frame(disabled, .5))
        self.assertLessEqual(bounds[1] - bounds[0], 21)

    def test_v2_v3_stack_order_offsets_and_overlay_only_export(self):
        lower = {"path": self.source, "start": 0, "duration": 1.6, "track": 2,
                 "offset": .2, "mute": True, "transform": self.transform}
        upper_tf = copy.deepcopy(self.transform)
        upper_tf["x"] = 240  # 60 output pixels at 160px-wide export.
        upper = {"path": self.source, "start": 0, "duration": .6, "track": 3,
                 "offset": .6, "mute": True, "transform": upper_tf}
        # Reverse input order intentionally: V3 must still composite over V2.
        path = self.export([], overlays=[upper, lower], audio=False, timeline_duration=2)
        self.assertLess(self.frame(path, .1).max(), 10)
        lower_peak = self.subject_bounds(self.frame(path, .7))
        self.assertLess(lower_peak[0], 40, "V2 mask expands before V3's envelope")
        overlap = self.subject_bounds(self.frame(path, 1.1))
        self.assertGreater(overlap[1], 120, "V3 enlarged subject must appear in front at its shifted position")
        self.assertLess(self.frame(path, 1.9).max(), 10)

    def test_pivot_and_feather_survive_final_encoding_and_preset_resize(self):
        hard = copy.deepcopy(self.transform)
        hard["maskFx"].update({"start": 0, "enter": 0, "hold": 1, "exit": 0,
                               "center": {"x": .25, "y": .35}})
        clip = {"path": self.source, "start": 0, "duration": 1, "mute": True, "transform": hard}
        path = self.export([clip], audio=False, width=320, height=200)
        image = self.frame(path, .5)
        self.assertEqual(image.shape[:2], (200, 320))
        bounds = self.subject_bounds(image)
        # Pivot follows tracked top-left: source t=.5 -> x=44,y=35, now 2x output.
        self.assertAlmostEqual(bounds[0], 88, delta=3)
        self.assertAlmostEqual(bounds[2], 70, delta=3)
        self.assertAlmostEqual(bounds[1] - bounds[0] + 1, 80, delta=4)
        soft = copy.deepcopy(hard)
        soft["maskFx"]["feather"] = .04
        soft_path = self.export([{**clip, "transform": soft}], audio=False, width=320, height=200)
        feathered = self.frame(soft_path, .5)
        # A point outside the original subject but just inside its enlarged edge
        # must blend with the unmodified background instead of staying opaque.
        self.assertGreater(int(image[110, 158].mean()), 180)
        self.assertLess(int(feathered[110, 158].mean()), int(image[110, 158].mean()) - 25)
        self.assertGreater(int(feathered[110, 158].mean()), 20)
        self.assertLess(feathered[0:20].max(), 10, "background outside expanded region is unchanged")

    def test_rotation_then_flip_uses_same_transform_order_as_preview(self):
        tf = copy.deepcopy(self.transform)
        tf.update({"rotation": 90, "flipH": True})
        path = self.export([{"path": self.source, "start": 0, "duration": 1,
                             "transform": tf, "mute": True}], audio=False)
        bounds = self.subject_bounds(self.frame(path, .5))
        # Source center (54,45) relative to (80,50) is (-26,-5).
        # CSS scale(-1,1) rotate(90deg) maps it to (-5,-26).
        self.assertAlmostEqual((bounds[0] + bounds[1]) / 2, 75, delta=3)
        self.assertAlmostEqual((bounds[2] + bounds[3]) / 2, 24, delta=3)

    @unittest.skipUnless(shutil.which("node"), "Node is required to verify frontend export validation")
    def test_frontend_mask_export_rejects_visible_unexported_layers(self):
        # Execute the real exported validator, transpiling JSX without rendering
        # React or importing Monitor/browser modules into the Node test process.
        frontend = Path(__file__).resolve().parents[1] / "frontend"
        script = """
            const fs = require('node:fs'), vm = require('node:vm');
            const esbuild = require(process.argv[1] + '/node_modules/esbuild');
            function load(file, requireModule) {
              const code = esbuild.transformSync(fs.readFileSync(file, 'utf8'), {loader:'jsx',format:'cjs'}).code;
              const module = {exports:{}};
              vm.runInNewContext(code, {module,exports:module.exports,require:requireModule});
              return module.exports;
            }
            const mask = load(process.argv[1] + '/src/components/maskFx.js', () => ({}));
            const mod = load(process.argv[1] + '/src/components/ExportWorkspace.jsx', id => id === './maskFx' ? mask : {});
            const cases = JSON.parse(fs.readFileSync(0, 'utf8'));
            process.stdout.write(JSON.stringify(cases.map(mod.maskExportLayerError)));
        """
        masked = {"id": "masked", "type": "video", "track": 1, "transform": self.transform}
        cases = [[masked, {"type": kind, "name": "visible " + kind}] for kind in ("scene", "image", "text", "layout")]
        cases += [
            [masked, {"type": "audio"}],
            [masked, {"type": "text", "hidden": True}],
            [{**masked, "hidden": True}, {"type": "text"}],
            [{**masked, "transform": {**self.transform, "maskFx": {"enabled": False}}}, {"type": "text"}],
            [masked, {"type": "video", "track": 4}],
            [{"type": "scene", "children": [masked]}],
        ]
        result = subprocess.run([shutil.which("node"), "-e", script, str(frontend)],
                                input=json.dumps(cases), capture_output=True, text=True, check=True)
        messages = json.loads(result.stdout)
        for index, kind in enumerate(("scene", "image", "text", "layout")):
            self.assertIn("visible " + kind, messages[index])
            self.assertIn("Preview", messages[index])
        self.assertEqual(messages[4:8], [None] * 4)
        self.assertIn("V4", messages[8])
        self.assertIn("Scene", messages[9])


if __name__ == "__main__":
    unittest.main()
