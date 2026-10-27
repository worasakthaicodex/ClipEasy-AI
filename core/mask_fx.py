"""Polygon Mask FX, shared source-time tracking and deterministic export rendering.

Coordinates and affine matrices are normalized to the original video frame, so
tracking remains valid when the preview or export resolution changes.
"""

from __future__ import annotations

import math
import subprocess
from bisect import bisect_right
from pathlib import Path

from core.video_utils import FFMPEG, JobCancelled


IDENTITY = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]


def _dependencies():
    try:
        import cv2
        import numpy as np
    except ImportError as exc:
        raise RuntimeError("Mask FX requires OpenCV and NumPy in the backend Python environment") from exc
    return cv2, np


def _number(value, default=0.0):
    try:
        result = float(value)
        return result if math.isfinite(result) else default
    except (TypeError, ValueError):
        return default


def normalized_points(points):
    """Validate a user-authored polygon without silently inventing a mask."""
    if not isinstance(points, list) or len(points) < 3:
        raise ValueError("Draw a mask with at least three points first")
    result = []
    for point in points:
        if not isinstance(point, dict):
            raise ValueError("Mask points must contain x and y coordinates")
        x, y = _number(point.get("x"), math.nan), _number(point.get("y"), math.nan)
        if not math.isfinite(x) or not math.isfinite(y) or not 0 <= x <= 1 or not 0 <= y <= 1:
            raise ValueError("Mask coordinates must be finite values between 0 and 1")
        result.append((x, y))
    area = abs(sum(result[i][0] * result[(i + 1) % len(result)][1]
                   - result[(i + 1) % len(result)][0] * result[i][1] for i in range(len(result)))) / 2
    if area < 1e-7:
        raise ValueError("Mask area is too small to track")
    return result


def _track_entries(transform):
    settings = transform.get("maskFx") or {}
    if settings.get("trackingEnabled", True) is False:
        return ([], [])
    entries = []
    for frame in transform.get("fxMaskTrack") or []:
        matrix = frame.get("matrix") if isinstance(frame, dict) else None
        if not isinstance(matrix, list) or len(matrix) != 6:
            continue
        if all(math.isfinite(_number(v, math.nan)) for v in matrix):
            entries.append((_number(frame.get("time")), [float(v) for v in matrix]))
    if not entries:
        return ([], [])
    entries.sort(key=lambda entry: entry[0])
    return ([entry[0] for entry in entries], [entry[1] for entry in entries])


def matrix_at(transform, source_time, _prepared=None):
    """Interpolate source-time tracking; hold the first/last known matrix."""
    times, matrices = _prepared if _prepared is not None else _track_entries(transform)
    if not times:
        return IDENTITY.copy()
    index = bisect_right(times, source_time)
    if index == 0:
        return matrices[0]
    if index >= len(times):
        return matrices[-1]
    amount = (source_time - times[index - 1]) / max(times[index] - times[index - 1], 1e-9)
    return [x + (y - x) * amount for x, y in zip(matrices[index - 1], matrices[index])]


def effect_scale(settings, local_time):
    """Use the same enter / hold / exit envelope as the preview renderer."""
    if settings.get("enabled", True) is False:
        return 1.0
    enter = max(0, _number(settings.get("enter"), .4))
    hold = max(0, _number(settings.get("hold"), .8))
    leave = max(0, _number(settings.get("exit"), .4))
    t = local_time - max(0, _number(settings.get("start")))
    if t < 0 or t >= enter + hold + leave:
        return 1.0
    bounce = min(1, max(0, _number(settings.get("bounce"), .2)))
    if enter > 0 and t < enter:
        p = t / enter
        envelope = p * p * (3 - 2 * p) + bounce * math.sin(math.pi * p)
    elif t < enter + hold:
        envelope = 1.0
    elif leave > 0:
        p = (t - enter - hold) / leave
        envelope = 1 - p * p * (3 - 2 * p)
    else:
        envelope = 0.0
    target = min(4.0, max(1.0, _number(settings.get("scale"), 160) / 100))
    return 1 + (target - 1) * envelope


def render_mask_frame(frame, transform, source_time, local_time, _prepared_track=None):
    """Composite the scaled polygon cutout over an unchanged BGR source frame."""
    settings = transform.get("maskFx") or {}
    scale = effect_scale(settings, local_time)
    if abs(scale - 1) < 1e-7 or not transform.get("fxMaskPath"):
        return frame
    cv2, np = _dependencies()
    points = np.array(normalized_points(transform["fxMaskPath"]), dtype=np.float32)
    a, b, c, d, e, f = matrix_at(transform, source_time, _prepared_track)
    matrix = np.array([[a, c], [b, d]], dtype=np.float32)
    tracked = points @ matrix.T + np.array([e, f], dtype=np.float32)
    height, width = frame.shape[:2]
    pixel_points = tracked * [width, height]
    mask = np.zeros((height, width), dtype=np.uint8)
    cv2.fillPoly(mask, [np.rint(pixel_points * 256).astype(np.int32)], 255, lineType=cv2.LINE_AA, shift=8)
    feather = min(.05, max(0, _number(settings.get("feather")))) * min(width, height)
    alpha = mask.astype(np.float32) / 255
    if feather > .01:
        alpha = cv2.GaussianBlur(alpha, (0, 0), feather, borderType=cv2.BORDER_CONSTANT)
    center = settings.get("center")
    if isinstance(center, dict):
        origin = np.array([_number(center.get("x"), .5), _number(center.get("y"), .5)], dtype=np.float32)
    else:
        origin = (points.min(axis=0) + points.max(axis=0)) / 2
    pivot = (origin @ matrix.T + [e, f]) * [width, height]
    resize = np.array([[scale, 0, pivot[0] * (1 - scale)], [0, scale, pivot[1] * (1 - scale)]], dtype=np.float32)
    expanded_alpha = cv2.warpAffine(alpha, resize, (width, height), flags=cv2.INTER_LINEAR)
    # Warp premultiplied colors so interpolation never creates a dark fringe.
    expanded_pixels = cv2.warpAffine(frame.astype(np.float32) * alpha[..., None], resize, (width, height), flags=cv2.INTER_LINEAR)
    result = expanded_pixels + frame.astype(np.float32) * (1 - expanded_alpha[..., None])
    return np.clip(np.rint(result), 0, 255).astype(np.uint8)


def track_mask(video_path, points, reference_time=0, start=0, duration=None, progress=None, cancelled=None):
    """Track polygon motion in both directions using robust optical flow.

    This tracks translation, rotation and uniform scale, not changing silhouette.
    Low-confidence frames hold the last transform and carry lost=True so the UI
    can request a correction instead of reporting a successful subject lock.
    """
    cv2, np = _dependencies()
    polygon = np.array(normalized_points(points), dtype=np.float32)
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise ValueError("Cannot open the video for mask tracking")
    try:
        if cancelled and cancelled():
            raise JobCancelled()
        fps = float(cap.get(cv2.CAP_PROP_FPS))
        count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if fps <= 0 or count <= 0:
            raise ValueError("The video has no readable frames or frame rate")
        start = max(0, _number(start))
        end_time = count / fps if duration is None else min(count / fps, start + max(0, _number(duration)))
        first = max(0, int(math.ceil(start * fps - 1e-7)))
        last = min(count - 1, int(math.ceil(end_time * fps - 1e-7)) - 1)
        if last < first:
            raise ValueError("The tracking range contains no video frames")
        # A trim can exclude the frame on which the polygon was authored. Keep
        # that source-frame anchor and traverse the intervening frames instead
        # of silently reinterpreting its coordinates at the new trim boundary.
        reference = min(count - 1, max(0, int(_number(reference_time, start) * fps + 1e-7)))
        track_first, track_last = min(first, reference), max(last, reference)
        cap.set(cv2.CAP_PROP_POS_FRAMES, reference)
        ok, original = cap.read()
        if not ok:
            raise ValueError("Cannot decode the mask reference frame")
        ratio = min(1, 960 / max(original.shape[:2]))
        size = (max(1, round(original.shape[1] * ratio)), max(1, round(original.shape[0] * ratio)))
        width, height = size

        def gray(image):
            image = cv2.resize(image, size, interpolation=cv2.INTER_AREA) if image.shape[1::-1] != size else image
            return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

        reference_gray = gray(original)
        base_points = polygon * [width, height]
        total = track_last - track_first + 1
        done = 1
        results = [{"time": reference / fps, "matrix": IDENTITY.copy(), "confidence": 1.0, "lost": False}]
        if progress:
            progress(done, total)

        def features(image, affine):
            region = np.zeros((height, width), dtype=np.uint8)
            current_poly = cv2.transform(base_points.astype(np.float32)[None, :, :], affine[:2].astype(np.float32))[0]
            cv2.fillPoly(region, [np.rint(current_poly).astype(np.int32)], 255)
            return cv2.goodFeaturesToTrack(image, 120, .01, 5, mask=region, blockSize=5)

        def frames(direction):
            # Backward chunks are decoded forward once, with bounded memory.
            if direction == 1:
                cap.set(cv2.CAP_PROP_POS_FRAMES, reference + 1)
                for index in range(reference + 1, track_last + 1):
                    if cancelled and cancelled():
                        raise JobCancelled()
                    valid, image = cap.read()
                    if not valid:
                        raise RuntimeError(f"Cannot decode video frame {index}")
                    yield index, gray(image)
            else:
                block_end = reference - 1
                while block_end >= track_first:
                    block_start = max(track_first, block_end - 23)
                    cap.set(cv2.CAP_PROP_POS_FRAMES, block_start)
                    block = []
                    for index in range(block_start, block_end + 1):
                        if cancelled and cancelled():
                            raise JobCancelled()
                        valid, image = cap.read()
                        if not valid:
                            raise RuntimeError(f"Cannot decode video frame {index}")
                        block.append((index, gray(image)))
                    yield from reversed(block)
                    block_end = block_start - 1

        for direction in (1, -1):
            previous = reference_gray
            cumulative = np.eye(3, dtype=np.float64)
            previous_features = features(previous, cumulative)
            for index, current in frames(direction):
                # Backward frames may already be decoded into a chunk. Check
                # here too so cancelling does not process the remaining chunk.
                if cancelled and cancelled():
                    raise JobCancelled()
                confidence = 0.0
                lost = True
                next_features = None
                if previous_features is not None and len(previous_features) >= 4:
                    moved, status, _ = cv2.calcOpticalFlowPyrLK(previous, current, previous_features, None,
                        winSize=(25, 25), maxLevel=3, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, .01))
                    if moved is not None:
                        returned, back_status, _ = cv2.calcOpticalFlowPyrLK(current, previous, moved, None,
                            winSize=(25, 25), maxLevel=3, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, .01))
                        if returned is not None:
                            valid = (status.ravel() == 1) & (back_status.ravel() == 1) & (np.linalg.norm(returned - previous_features, axis=2).ravel() < 1.5)
                            before, after = previous_features[valid], moved[valid]
                            if len(after) >= 4:
                                step, inliers = cv2.estimateAffinePartial2D(before, after, method=cv2.RANSAC,
                                    ransacReprojThreshold=2.5, maxIters=1500, confidence=.99)
                                if step is not None and inliers is not None:
                                    confidence = float(inliers.mean()) * min(1, len(after) / 12)
                                    factor = math.hypot(step[0, 0], step[1, 0])
                                    offset = math.hypot(step[0, 2], step[1, 2])
                                    if .7 <= factor <= 1.4 and offset < max(width, height) * .3 and confidence >= .25:
                                        cumulative = np.vstack([step, [0, 0, 1]]) @ cumulative
                                        next_features = after[inliers.ravel() == 1]
                                        lost = False
                # Refresh within the moved polygon while keeping robust existing tracks.
                if next_features is None or len(next_features) < 24:
                    next_features = features(current, cumulative)
                previous_features = next_features
                previous = current
                normalized = [float(cumulative[0, 0]), float(cumulative[1, 0] * width / height),
                              float(cumulative[0, 1] * height / width), float(cumulative[1, 1]),
                              float(cumulative[0, 2] / width), float(cumulative[1, 2] / height)]
                results.append({"time": index / fps, "matrix": normalized,
                                "confidence": round(confidence, 4), "lost": lost})
                done += 1
                if progress:
                    progress(done, total)
        if cancelled and cancelled():
            raise JobCancelled()
        return sorted((entry for entry in results if first <= round(entry["time"] * fps) <= last),
                      key=lambda entry: entry["time"])
    finally:
        cap.release()


def bake_mask_clip(video_path, out_path, transform, start=0, duration=None, speed=1,
                   fps=None, progress=None, cancelled=None):
    """Render a trimmed, speed-adjusted silent clip for the export compositor.

    start/duration are SOURCE seconds. The result begins at timeline local zero,
    and is already retimed by speed. Audio must stay on the original audio path.
    """
    cv2, _ = _dependencies()
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise ValueError("Cannot open video for Mask FX export")
    proc = None
    target = Path(out_path)
    try:
        source_fps = float(cap.get(cv2.CAP_PROP_FPS))
        source_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width, height = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if source_fps <= 0 or width <= 0 or height <= 0:
            raise ValueError("Invalid video stream for Mask FX export")
        speed = max(.01, _number(speed, 1))
        output_fps = max(1, _number(fps, source_fps))
        start = max(0, _number(start))
        available = max(0, source_count / source_fps - start)
        duration = available if duration is None else min(available, max(0, _number(duration)))
        count = int(math.ceil(duration / speed * output_fps - 1e-7))
        if count <= 0:
            raise ValueError("The mask export interval is empty")
        target.parent.mkdir(parents=True, exist_ok=True)
        proc = subprocess.Popen([FFMPEG, "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "bgr24",
            "-s", f"{width}x{height}", "-r", str(output_fps), "-i", "pipe:0", "-an",
            "-c:v", "libx264", "-crf", "12", "-preset", "fast", "-pix_fmt", "yuv444p", str(target)],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        last_index = -1
        frame = None
        prepared_track = _track_entries(transform)
        for index in range(count):
            if cancelled and cancelled():
                raise JobCancelled()
            local_time = index / output_fps
            source_time = start + local_time * speed
            frame_index = min(source_count - 1, int(source_time * source_fps + 1e-7))
            if frame_index != last_index:
                if last_index < 0 or frame_index < last_index or frame_index - last_index > 12:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
                    last_index = frame_index - 1
                while last_index < frame_index:
                    ok, frame = cap.read()
                    if not ok:
                        raise RuntimeError(f"Cannot decode source frame {frame_index} for Mask FX")
                    last_index += 1
            rendered = render_mask_frame(frame, transform, source_time, local_time, prepared_track)
            proc.stdin.write(rendered.tobytes())
            if progress:
                progress(index + 1, count)
        proc.stdin.close()
        proc.stdin = None
        _, error = proc.communicate()
        if proc.returncode:
            raise RuntimeError("Mask FX encoding failed: " + error.decode("utf-8", errors="replace")[-1200:])
        return str(target)
    except Exception:
        if proc and proc.poll() is None:
            proc.kill()
            proc.wait()
        if target.exists():
            target.unlink()
        raise
    finally:
        cap.release()
