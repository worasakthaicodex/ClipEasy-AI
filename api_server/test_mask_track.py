"""Exercise mask tracking through an actual isolated HTTP server and job poll."""

import json
import socket
import subprocess
import sys
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from core import test_mask_fx


class MaskTrackHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        cls.base = f"http://127.0.0.1:{port}"
        cls.server = subprocess.Popen([sys.executable, "-m", "uvicorn", "api_server.main:app", "--host", "127.0.0.1", "--port", str(port)],
                                      cwd=str(Path(__file__).resolve().parents[1]), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if cls.server.poll() is not None:
                raise RuntimeError(cls.server.stderr.read().decode(errors="replace"))
            try:
                with urllib.request.urlopen(cls.base + "/health", timeout=1) as response:
                    if response.status == 200:
                        return
            except (urllib.error.URLError, TimeoutError):
                time.sleep(.1)
        cls.server.kill()
        cls.server.wait()
        raise RuntimeError("Test backend did not start")

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        try:
            cls.server.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            cls.server.kill()
            cls.server.communicate()

    def request(self, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.base + path, data=data, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.load(response)

    def test_endpoint_returns_track_job_and_rejects_invalid_polygon(self):
        fixture = test_mask_fx.MaskTrackingTests()
        fixture.setUp()
        try:
            with self.assertRaises(urllib.error.HTTPError) as failure:
                self.request("/video/mask-track", {"video_path": fixture.path, "points": []})
            self.assertEqual(failure.exception.code, 400)
            with self.assertRaises(urllib.error.HTTPError) as failure:
                self.request("/video/mask-track", {"video_path": fixture.path, "points": fixture.points,
                    "start": float("nan")})
            self.assertEqual(failure.exception.code, 400)
            job = self.request("/video/mask-track", {"video_path": fixture.path, "points": fixture.points,
                "reference_time": .6, "start": .2, "duration": .9})
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                state = self.request("/jobs/" + job["job_id"])
                if state["status"] != "working":
                    break
                time.sleep(.05)
            self.assertEqual(state["status"], "done", state)
            self.assertEqual(len(state["mask_track"]), 18)
            self.assertEqual(state["done"], state["total"])
            self.assertIn("lost_frames", state)
            self.assertEqual(state["mask_track"][0]["time"], .2)
            self.assertEqual(state["mask_track"][-1]["time"], 1.05)
        finally:
            fixture.tearDown()


if __name__ == "__main__":
    unittest.main()
