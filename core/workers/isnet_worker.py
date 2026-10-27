"""
core/workers/isnet_worker.py — ตัดฉากหลังแบบ "อะไรก็ได้" (คน/สัตว์/สิ่งของ) ด้วย ISNet (DIS)

interface เดียวกับ rvm_worker: python isnet_worker.py <src> <dst.webm> <model.onnx> [start] [dur]
สื่อสารกลับทาง stdout:  PROG <done> <total>  และ  OUT <path> ตอนจบ

ต่างจาก RVM: ISNet ตัดทีละเฟรมไม่มี memory ข้ามเฟรม — เกลี่ย mask ข้ามเฟรม (EMA)
กันขอบสั่น/กระพริบ แลกกับขอบตามวัตถุที่ขยับเร็วช้าลงนิดหน่อย
"""

import json
import subprocess
import sys

import numpy as np
import onnxruntime as ort

SIZE = 1024  # ISNet รับ input 1024×1024


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


def main():
    src, dst, model_path = sys.argv[1], sys.argv[2], sys.argv[3]
    start = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
    seg_dur = float(sys.argv[5]) if len(sys.argv) > 5 else 0.0
    w0, h0, fps, duration = probe(src)
    if seg_dur > 0:
        duration = min(seg_dur, max(0.0, duration - start))

    # ทำงานที่ 720p สูงสุดเหมือน RVM — โมเดลเห็นแค่ 1024 อยู่แล้ว ภาพใหญ่กว่านี้ไม่ช่วย
    h = min(h0, 720)
    w = max(2, round(w0 * h / h0 / 2) * 2)
    total = int(duration * fps) or 1

    trim_in = (["-ss", f"{start:.3f}"] if start > 0 else [])
    trim_out = (["-t", f"{duration:.3f}"] if seg_dur > 0 else [])

    sess = ort.InferenceSession(
        model_path,
        providers=["DmlExecutionProvider", "CPUExecutionProvider"],
    )
    in_name = sess.get_inputs()[0].name

    def run_model(feed):
        # DirectML อาจไม่รองรับบาง ops — เฟรมแรกพังให้ตกมา CPU ถาวร
        nonlocal sess
        try:
            return sess.run(None, feed)[0]
        except Exception:
            sess = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
            return sess.run(None, feed)[0]

    dec = subprocess.Popen(
        ["ffmpeg", "-v", "error", *trim_in, "-i", src, *trim_out,
         "-vf", f"scale={w}:{h}",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE,
    )
    enc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y",
         "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{w}x{h}", "-r", f"{fps:.4f}", "-i", "-",
         *trim_in, *trim_out, "-i", src,
         "-map", "0:v", "-map", "1:a:0?",
         "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "2M",
         "-row-mt", "1", "-cpu-used", "5",
         "-c:a", "libopus", "-shortest", dst],
        stdin=subprocess.PIPE,
    )

    import cv2  # opencv อยู่ใน pip ของ engine นี้ (ใช้ resize เร็วกว่า numpy เอง)

    frame_bytes = w * h * 3
    done = 0
    prev_mask = None  # EMA กันขอบกระพริบข้ามเฟรม

    while True:
        buf = dec.stdout.read(frame_bytes)
        if len(buf) < frame_bytes:
            break
        img = np.frombuffer(buf, np.uint8).reshape(h, w, 3)

        small = cv2.resize(img, (SIZE, SIZE), interpolation=cv2.INTER_AREA)
        x = small.astype(np.float32) / 255.0
        x = (x - 0.5) / 1.0  # normalize ตามสูตร rembg สำหรับ isnet-general-use
        pred = run_model({in_name: x.transpose(2, 0, 1)[None]})[0, 0]  # [1024,1024]

        # min-max normalize เป็น 0..1 (output ของ ISNet ไม่ได้ scale ตายตัว)
        mn, mx = float(pred.min()), float(pred.max())
        mask = (pred - mn) / (mx - mn) if mx - mn > 1e-6 else pred * 0
        mask = cv2.resize(mask, (w, h), interpolation=cv2.INTER_LINEAR)

        if prev_mask is not None:
            mask = 0.65 * mask + 0.35 * prev_mask  # เกลี่ยกับเฟรมก่อน กันสั่น
        prev_mask = mask

        rgba = np.empty((h, w, 4), np.uint8)
        rgba[:, :, :3] = img
        rgba[:, :, 3] = np.clip(mask * 255, 0, 255).astype(np.uint8)
        enc.stdin.write(rgba.tobytes())
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
