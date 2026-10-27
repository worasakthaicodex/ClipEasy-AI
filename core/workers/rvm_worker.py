"""
core/workers/rvm_worker.py — ตัดฉากหลังวิดีโอด้วย RVM (รันใน venv ของ Fast Engine)

ถูกเรียกเป็น subprocess: python rvm_worker.py <src> <dst.webm> <model.onnx>
สื่อสารกลับทาง stdout:  PROG <done> <total>  และ  OUT <path> ตอนจบ
pipeline: ffmpeg ถอดเฟรม → RVM (มี memory ข้ามเฟรม) → ffmpeg เข้ารหัส WebM แบบมี alpha
"""

import json
import subprocess
import sys

import numpy as np
import onnxruntime as ort


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
    # ช่วงที่ทำ (วินาที) — 0 = ทั้งไฟล์ ใช้ทำเฉพาะก้อนที่เลือกบน timeline
    start = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
    seg_dur = float(sys.argv[5]) if len(sys.argv) > 5 else 0.0
    w0, h0, fps, duration = probe(src)
    if seg_dur > 0:
        duration = min(seg_dur, max(0.0, duration - start))

    # ย่อให้สูงสุด 720p เพื่อความเร็ว (RVM ทำงานภายในที่ downsample อีกชั้นอยู่แล้ว)
    h = min(h0, 720)
    w = max(2, round(w0 * h / h0 / 2) * 2)
    total = int(duration * fps) or 1

    trim_in = (["-ss", f"{start:.3f}"] if start > 0 else [])
    trim_out = (["-t", f"{duration:.3f}"] if seg_dur > 0 else [])

    sess = ort.InferenceSession(
        model_path,
        providers=["DmlExecutionProvider", "CPUExecutionProvider"],  # มี DirectML ใช้การ์ดจอช่วย
    )

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

    # สถานะ recurrent ของ RVM — คือเหตุผลที่ขอบไม่กระพริบข้ามเฟรม
    rec = [np.zeros([1, 1, 1, 1], np.float32)] * 4
    ratio = np.array([0.25], np.float32)
    frame_bytes = w * h * 3
    done = 0

    while True:
        buf = dec.stdout.read(frame_bytes)
        if len(buf) < frame_bytes:
            break
        img = np.frombuffer(buf, np.uint8).reshape(h, w, 3)
        srcT = (img.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
        fgr, pha, *rec = sess.run(
            None,
            {"src": srcT, "r1i": rec[0], "r2i": rec[1], "r3i": rec[2], "r4i": rec[3],
             "downsample_ratio": ratio},
        )
        rgba = np.empty((h, w, 4), np.uint8)
        rgba[:, :, :3] = (fgr[0].transpose(1, 2, 0) * 255).astype(np.uint8)
        rgba[:, :, 3] = (pha[0, 0] * 255).astype(np.uint8)
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
