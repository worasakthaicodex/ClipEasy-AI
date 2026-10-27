"""
core/workers/track_worker.py — ตามวัตถุ (object tracking) แล้ววาดสัญลักษณ์ชี้เป้าวิ่งตาม

ถูกเรียกเป็น subprocess:
  python track_worker.py <src> <dst.mp4> <tracker:csrt|nano> <models_dir> <rect_json> <style> <color_hex> <start> <seg_dur>

rect_json = {"x","y","w","h"} สัดส่วน 0–1 ของเฟรม (กรอบเป้าที่ผู้ใช้ตีไว้ที่เฟรมแรกของช่วง)
style = circle | arrow | box   color_hex เช่น "#ffd60a"
สื่อสารกลับทาง stdout:  PROG <done> <total>  และ  OUT <path> ตอนจบ
pipeline: ffmpeg ถอดเฟรม → tracker.update ทีละเฟรม + วาด annotation → ffmpeg เข้ารหัส mp4 พร้อมเสียงเดิม
"""

import json
import math
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np


def probe(src):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,r_frame_rate:format=duration",
         "-of", "json", src],
        capture_output=True, text=True, check=True,
    )
    info = json.loads(out.stdout)
    st = info["streams"][0]
    num, den = st["r_frame_rate"].split("/")
    fps = float(num) / float(den or 1)
    duration = float(info.get("format", {}).get("duration", 0) or 0)
    return int(st["width"]), int(st["height"]), fps, duration


def make_tracker(kind: str, models_dir: Path):
    if kind == "vit":
        params = cv2.TrackerVit_Params()
        params.net = str(models_dir / "vittrack.onnx")
        return cv2.TrackerVit_create(params)
    if kind == "nano":
        params = cv2.TrackerNano_Params()
        params.backbone = str(models_dir / "nanotrack_backbone.onnx")
        params.neckhead = str(models_dir / "nanotrack_head.onnx")
        return cv2.TrackerNano_create(params)
    # CSRT อยู่ใน contrib — บางเวอร์ชันย้ายไปใต้ cv2.legacy
    try:
        return cv2.TrackerCSRT_create()
    except AttributeError:
        return cv2.legacy.TrackerCSRT_create()


def hex_to_bgr(hx: str):
    hx = hx.lstrip("#")
    if len(hx) != 6:
        return (10, 214, 255)  # เหลือง iOS เป็นค่าตั้งต้น
    r, g, b = int(hx[0:2], 16), int(hx[2:4], 16), int(hx[4:6], 16)
    return (b, g, r)


def draw_annotation(img, box, style, color, frame_i):
    """วาดสัญลักษณ์ชี้เป้าบนกรอบ (x,y,w,h เป็น px) — เส้น anti-alias ทั้งหมด"""
    x, y, w, h = [int(v) for v in box]
    cx = x + w // 2
    if style == "box":
        cv2.rectangle(img, (x, y), (x + w, y + h), color, 3, cv2.LINE_AA)
        # เขี้ยวมุมให้ดูเป็น HUD หน่อย
        L = max(8, min(w, h) // 5)
        for px, py, dx, dy in ((x, y, 1, 1), (x + w, y, -1, 1), (x, y + h, 1, -1), (x + w, y + h, -1, -1)):
            cv2.line(img, (px, py), (px + dx * L, py), color, 5, cv2.LINE_AA)
            cv2.line(img, (px, py), (px, py + dy * L), color, 5, cv2.LINE_AA)
    elif style == "circle":
        # วงรีใต้เท้าแบบ spotlight ในคลิปวิเคราะห์กีฬา
        axes = (max(10, int(w * 0.65)), max(6, int(w * 0.22)))
        cy = y + h
        cv2.ellipse(img, (cx, cy), axes, 0, 0, 360, color, 3, cv2.LINE_AA)
        cv2.ellipse(img, (cx, cy), (int(axes[0] * 0.75), int(axes[1] * 0.75)), 0, 0, 360, color, 1, cv2.LINE_AA)
    else:  # arrow — ลูกศรชี้ลงเหนือหัว เด้งขึ้นลงเบาๆ ให้สะดุดตา
        bob = int(6 * math.sin(frame_i / 5.0))
        tip = (cx, max(0, y - 8 + bob))
        s = max(12, w // 4)
        pts = np.array(
            [tip, (cx - s, tip[1] - s), (cx - s // 2, tip[1] - s), (cx - s // 2, tip[1] - 2 * s),
             (cx + s // 2, tip[1] - 2 * s), (cx + s // 2, tip[1] - s), (cx + s, tip[1] - s)],
            np.int32,
        )
        cv2.fillPoly(img, [pts], color, cv2.LINE_AA)
        cv2.polylines(img, [pts], True, (255, 255, 255), 1, cv2.LINE_AA)


def main():
    src, dst, kind = sys.argv[1], sys.argv[2], sys.argv[3]
    models_dir = Path(sys.argv[4])
    rect = json.loads(sys.argv[5])
    style = sys.argv[6] if len(sys.argv) > 6 else "box"
    color = hex_to_bgr(sys.argv[7] if len(sys.argv) > 7 else "#ffd60a")
    start = float(sys.argv[8]) if len(sys.argv) > 8 else 0.0
    seg_dur = float(sys.argv[9]) if len(sys.argv) > 9 else 0.0

    w, h, fps, duration = probe(src)
    if seg_dur > 0:
        duration = min(seg_dur, max(0.0, duration - start))
    total = int(duration * fps) or 1

    trim_in = (["-ss", f"{start:.3f}"] if start > 0 else [])
    trim_out = (["-t", f"{duration:.3f}"] if seg_dur > 0 else [])

    dec = subprocess.Popen(
        ["ffmpeg", "-v", "error", *trim_in, "-i", src, *trim_out,
         "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
        stdout=subprocess.PIPE,
    )
    enc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y",
         "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}", "-r", f"{fps:.4f}", "-i", "-",
         *trim_in, *trim_out, "-i", src,
         "-map", "0:v", "-map", "1:a:0?",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast",
         "-c:a", "aac", "-shortest", dst],
        stdin=subprocess.PIPE,
    )

    frame_bytes = w * h * 3
    tracker = None
    box = (rect["x"] * w, rect["y"] * h, max(4, rect["w"] * w), max(4, rect["h"] * h))
    smooth = list(box)  # ตำแหน่งที่เกลี่ยแล้ว — สัญลักษณ์วาดจากตัวนี้ ไม่ใช่ผลดิบของ tracker
    lost = False
    done = 0

    def smooth_box(new):
        """เกลี่ยผล tracker กันสัญลักษณ์สั่น: ขยับน้อยกว่า ~2px ไม่ขยับตาม (deadband)
        ขยับจริงค่อยไหลตามแบบ EMA — เร็วพอไล่ทันเป้า แต่ตัดอาการเต้นรายเฟรม"""
        for k in range(4):
            delta = new[k] - smooth[k]
            if abs(delta) < 2.0:
                continue
            smooth[k] += delta * 0.35
        return tuple(smooth)

    while True:
        buf = dec.stdout.read(frame_bytes)
        if len(buf) < frame_bytes:
            break
        img = np.frombuffer(buf, np.uint8).reshape(h, w, 3).copy()

        if tracker is None:
            tracker = make_tracker(kind, models_dir)
            tracker.init(img, tuple(int(v) for v in box))
        else:
            ok, newbox = tracker.update(img)
            # กรอบบวม/หดผิดธรรมชาติ (ใหญ่เกิน 90% ของเฟรม หรือเล็กกว่า 3px) = ถือว่าหลุดเป้า
            sane = ok and 3 <= newbox[2] <= w * 0.9 and 3 <= newbox[3] <= h * 0.9
            if sane:
                box, lost = smooth_box(newbox), False
            else:
                lost = True  # หลุดเป้าชั่วคราว — คงกรอบเดิมไว้แต่ไม่วาด

        if not lost:
            draw_annotation(img, box, style, color, done)

        enc.stdin.write(img.tobytes())
        done += 1
        if done % 10 == 0:
            print(f"PROG {done} {max(total, done)}", flush=True)

    dec.stdout.close()
    enc.stdin.close()
    enc.wait()
    print(f"PROG {done} {done}", flush=True)
    print(f"OUT {dst}", flush=True)


if __name__ == "__main__":
    main()
