"""
core/workers/face_swap_worker.py — สลับหน้าในวิดีโอด้วย inswapper (InsightFace) + GFPGAN

ถูกเรียกเป็น subprocess (รันใน venv ของ engine "face-swap-local"):
    python face_swap_worker.py <src> <dst.mp4> <models_dir> <face_image> <enhance:0|1> [start] [seg_dur]

pipeline: อ่านรูปหน้าต้นแบบ → สกัด embedding (ArcFace) หนึ่งครั้ง
    → ffmpeg ถอดเฟรม → SCRFD หาหน้าทุกเฟรม → inswapper สลับทีละหน้า
    → (ถ้าเปิด enhance) GFPGAN เก็บรายละเอียดหน้า → แปะกลับแบบขอบเนียน → ffmpeg เข้ารหัสกลับ
สื่อสารกลับทาง stdout:  PROG <done> <total>  และ  OUT <path> ตอนจบ
"""

import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

# ตำแหน่ง landmark มาตรฐาน ArcFace (บนภาพ 112×112) — ใช้จัดหน้าให้ตรงก่อนเข้าโมเดล
ARCFACE_DST = np.array(
    [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366],
     [41.5493, 92.3655], [70.7299, 92.2041]],
    np.float32,
)


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
    dur = float(info.get("format", {}).get("duration", 0) or 0)
    return int(st["width"]), int(st["height"]), fps, dur


class SCRFDDetector:
    """ตัวตรวจใบหน้า SCRFD — คืน rows[N,15]: x,y,w,h + landmark 5 คู่ + score"""

    SIZE = 640

    def __init__(self, path, thr=0.35):
        self.sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        self.inp = self.sess.get_inputs()[0].name
        self.thr = thr  # ต่ำลง = จับหน้าเอียง/หันข้างได้ทันขึ้น (แลกกับ false positive เล็กน้อย)

    def detect(self, img):
        h0, w0 = img.shape[:2]
        s = self.SIZE / max(h0, w0)
        nw, nh = max(1, round(w0 * s)), max(1, round(h0 * s))
        pad = np.zeros((self.SIZE, self.SIZE, 3), np.uint8)
        pad[:nh, :nw] = cv2.resize(img, (nw, nh))
        blob = cv2.dnn.blobFromImage(
            pad, 1 / 128.0, (self.SIZE, self.SIZE), (127.5, 127.5, 127.5), swapRB=True
        )
        outs = self.sess.run(None, {self.inp: blob})
        rows = []
        for i, stride in enumerate((8, 16, 32)):
            scores = outs[i].reshape(-1)
            bbox = outs[i + 3].reshape(-1, 4) * stride
            kps = outs[i + 6].reshape(-1, 10) * stride
            n = self.SIZE // stride
            gx, gy = np.meshgrid(np.arange(n), np.arange(n))
            centers = np.stack([gx, gy], -1).reshape(-1, 2).astype(np.float32) * stride
            centers = np.repeat(centers, 2, axis=0)
            for j in np.where(scores >= self.thr)[0]:
                cx, cy = centers[j]
                x1, y1 = cx - bbox[j, 0], cy - bbox[j, 1]
                x2, y2 = cx + bbox[j, 2], cy + bbox[j, 3]
                row = [x1, y1, x2 - x1, y2 - y1]
                for p in range(5):
                    row += [cx + kps[j, 2 * p], cy + kps[j, 2 * p + 1]]
                row.append(float(scores[j]))
                rows.append(row)
        if not rows:
            return None
        rows = np.array(rows, np.float32)
        rows[:, :14] /= s
        keep = cv2.dnn.NMSBoxes(rows[:, :4].tolist(), rows[:, 14].tolist(), self.thr, 0.4)
        keep = np.array(keep).reshape(-1)
        return rows[keep] if keep.size else None


def align(img, kps5, size):
    """จัดหน้าให้ตรงตาม template ArcFace ที่สเกลเป็น size×size — คืน (ภาพครอบ, เมทริกซ์)"""
    dst = ARCFACE_DST * (size / 112.0)
    M, _ = cv2.estimateAffinePartial2D(kps5.reshape(5, 2), dst, method=cv2.LMEDS)
    crop = cv2.warpAffine(img, M, (size, size), borderValue=0)
    return crop, M


def grab_frame(src, t):
    """ดึงเฟรมเดียว ณ เวลา t (วินาที) จากไฟล์ — ใช้หาหน้า 'คนเป้าหมาย' ที่ผู้ใช้ตีกรอบ"""
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", src, "-frames:v", "1",
         "-f", "image2pipe", "-pix_fmt", "bgr24", "-vcodec", "rawvideo", "-"],
        capture_output=True,
    )
    return out.stdout


def main():
    src, dst = sys.argv[1], sys.argv[2]
    models = Path(sys.argv[3])
    maps_path = sys.argv[4]  # ไฟล์ JSON: [{"source": path, "ref": {t,x,y,w,h}|null}]
    enhance = sys.argv[5] == "1" if len(sys.argv) > 5 else True
    start = float(sys.argv[6]) if len(sys.argv) > 6 else 0.0
    seg_dur = float(sys.argv[7]) if len(sys.argv) > 7 else 0.0

    swap_maps = json.loads(Path(maps_path).read_text(encoding="utf-8"))
    if not swap_maps:
        raise SystemExit("ไม่มีรูปหน้าต้นแบบ")

    detector = SCRFDDetector(models / "scrfd_10g_bnkps.onnx")
    arcface = ort.InferenceSession(str(models / "arcface_w600k_r50.onnx"), providers=["CPUExecutionProvider"])
    swapper = ort.InferenceSession(str(models / "inswapper_128.onnx"), providers=["CPUExecutionProvider"])
    gfpgan = None
    if enhance:
        gfpgan = ort.InferenceSession(str(models / "gfpgan_1.4.onnx"), providers=["CPUExecutionProvider"])

    arcface_name = arcface.get_inputs()[0].name

    def embed_face(img, kps5):
        """สกัด ArcFace embedding (normalize แล้ว) ของหน้าหนึ่งใบ — ใช้ทั้งจับคู่และทำ latent"""
        crop112, _ = align(img, kps5, 112)
        b = crop112[:, :, ::-1].astype(np.float32)
        b = ((b / 127.5) - 1.0).transpose(2, 0, 1)[None]
        e = arcface.run(None, {arcface_name: b})[0].reshape(-1)
        return e / (np.linalg.norm(e) + 1e-9)

    # emap ฝังอยู่ใน inswapper.onnx — ใช้แปลง embedding ArcFace เป็น latent ของ swapper
    import onnx
    from onnx import numpy_helper

    graph = onnx.load(str(models / "inswapper_128.onnx"), load_external_data=False).graph
    emap = next((numpy_helper.to_array(t) for t in graph.initializer if t.name == "emap"), None)
    if emap is None:
        emap = numpy_helper.to_array(graph.initializer[-1])
    assert emap.shape == (512, 512), f"emap ผิดรูป: {emap.shape}"

    def detect_robust(img):
        """ตรวจหน้า — ถ้ารูปครอปแน่นจนไม่เจอ เติมขอบแล้วลองใหม่"""
        f = detector.detect(img)
        if f is not None:
            return f
        ph, pw = img.shape[:2]
        py, px = ph // 2, pw // 2
        pad = cv2.copyMakeBorder(img, py, py, px, px, cv2.BORDER_CONSTANT, value=(127, 127, 127))
        f = detector.detect(pad)
        if f is not None:
            f[:, 0] -= px; f[:, 1] -= py
            f[:, 4:14:2] -= px; f[:, 5:14:2] -= py
        return f

    def make_latent(emb):
        lat = (emb.reshape(1, -1) @ emap)
        return (lat / np.linalg.norm(lat)).astype(np.float32)

    # ---- เตรียม latent ของแต่ละรูปต้นแบบ + embedding ของ 'คนเป้าหมาย' (ถ้าระบุ ref) ----
    W, H, fps, dur = probe(src)
    if seg_dur > 0:
        dur = min(seg_dur, max(0.0, dur - start))

    entries = []  # [{latent, target_emb|None}]
    for m in swap_maps:
        face_img = cv2.imdecode(np.fromfile(m["source"], np.uint8), cv2.IMREAD_COLOR)
        if face_img is None:
            raise SystemExit(f"อ่านรูปหน้าต้นแบบไม่ได้: {m['source']}")
        faces = detect_robust(face_img)
        if faces is None:
            raise SystemExit("ไม่พบใบหน้าในรูปต้นแบบ — ใช้รูปหน้าตรง เห็นหน้าชัดๆ")
        f = faces[np.argmax(faces[:, 2] * faces[:, 3])]  # หน้าใหญ่สุดในรูป
        latent = make_latent(embed_face(face_img, f[4:14]))

        target_emb = None
        ref = m.get("ref")
        if ref:  # ผู้ใช้ตีกรอบชี้คนบนจอ → หา embedding ของคนนั้นไว้จับคู่ต่อ
            buf = grab_frame(src, ref["t"])
            if len(buf) == W * H * 3:
                rframe = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
                rf = detect_robust(rframe)
                if rf is not None:
                    # เลือกหน้าที่ทับจุดกึ่งกลางกรอบมากสุด
                    kx, ky = (ref["x"] + ref["w"] / 2) * W, (ref["y"] + ref["h"] / 2) * H
                    best = min(rf, key=lambda r: (r[0] + r[2] / 2 - kx) ** 2 + (r[1] + r[3] / 2 - ky) ** 2)
                    target_emb = embed_face(rframe, best[4:14])
        entries.append({"latent": latent, "target": target_emb})

    has_targets = any(e["target"] is not None for e in entries)
    catch_all = next((e for e in entries if e["target"] is None), None)

    swap_in = {i.name: i for i in swapper.get_inputs()}
    tgt_name = "target" if "target" in swap_in else swapper.get_inputs()[0].name
    src_name = "source" if "source" in swap_in else swapper.get_inputs()[1].name

    total = int(dur * fps) or 1

    trim_in = (["-ss", f"{start:.3f}"] if start > 0 else [])
    trim_out = (["-t", f"{dur:.3f}"] if seg_dur > 0 else [])

    dec = subprocess.Popen(
        ["ffmpeg", "-v", "error", *trim_in, "-i", src, *trim_out,
         "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
        stdout=subprocess.PIPE,
    )
    enc = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y",
         "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", f"{fps:.4f}", "-i", "-",
         *trim_in, *trim_out, "-i", src,
         "-map", "0:v", "-map", "1:a:0?",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast",
         "-c:a", "copy", "-shortest", dst],
        stdin=subprocess.PIPE,
    )

    def swap_one(img, kps5, latent):
        """สลับหน้าหนึ่งใบในภาพเป็น latent ที่ให้มา (แก้ img ในที่)"""
        size = 512 if gfpgan is not None else 128
        crop, M = align(img, kps5, size)

        # inswapper ทำงานที่ 128 เสมอ
        crop128 = crop if size == 128 else cv2.resize(crop, (128, 128))
        blob = (crop128[:, :, ::-1].astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
        out = swapper.run(None, {tgt_name: blob, src_name: latent})[0][0]
        swapped = (out.transpose(1, 2, 0)[:, :, ::-1] * 255).clip(0, 255).astype(np.uint8)

        if gfpgan is not None:
            # เก็บรายละเอียดหน้าที่ 512 ด้วย GFPGAN (input/output ช่วง [-1,1] RGB)
            up = cv2.resize(swapped, (512, 512), interpolation=cv2.INTER_CUBIC)
            g = (up[:, :, ::-1].astype(np.float32) / 127.5 - 1.0).transpose(2, 0, 1)[None]
            g = gfpgan.run(None, {gfpgan.get_inputs()[0].name: g})[0][0]
            swapped = ((g.transpose(1, 2, 0)[:, :, ::-1] + 1) * 127.5).clip(0, 255).astype(np.uint8)
        elif size != 128:
            swapped = cv2.resize(swapped, (size, size), interpolation=cv2.INTER_CUBIC)

        # mask "วงรีรูปหน้า" (ไม่ใช่สี่เหลี่ยม) — กันกรอบดำ/ขอบกล่องโผล่ตอน warp
        mask = np.zeros((size, size), np.uint8)
        cv2.ellipse(mask, (size // 2, int(size * 0.52)),
                    (int(size * 0.40), int(size * 0.50)), 0, 0, 360, 255, -1)
        k = max(3, size // 12)
        mask = cv2.GaussianBlur(mask, (k * 2 + 1, k * 2 + 1), 0)
        mf = mask.astype(np.float32) / 255.0

        # color match: ปรับสีหน้าที่สลับให้เข้ากับหน้าเดิมในตำแหน่งนั้น (ลดรอยต่อ/รอยซ้อน)
        # ใช้ mean/std ต่อ channel ใน LAB เฉพาะบริเวณวงรีหน้า
        sel = mf > 0.3
        if sel.sum() > 50:
            sw_lab = cv2.cvtColor(swapped, cv2.COLOR_BGR2LAB).astype(np.float32)
            or_lab = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB).astype(np.float32)
            for c in range(3):
                sm, ss = sw_lab[:, :, c][sel].mean(), sw_lab[:, :, c][sel].std() + 1e-3
                om, os_ = or_lab[:, :, c][sel].mean(), or_lab[:, :, c][sel].std() + 1e-3
                sw_lab[:, :, c] = (sw_lab[:, :, c] - sm) * (os_ / ss) + om
            swapped = cv2.cvtColor(sw_lab.clip(0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)

        inv = cv2.invertAffineTransform(M)
        warp_face = cv2.warpAffine(swapped, inv, (W, H), borderValue=0)
        warp_mask = cv2.warpAffine(mf, inv, (W, H), borderValue=0)[:, :, None]
        np.copyto(img, (warp_face * warp_mask + img * (1 - warp_mask)).astype(np.uint8))

    frame_bytes = W * H * 3
    done = 0
    while True:
        buf = dec.stdout.read(frame_bytes)
        if len(buf) < frame_bytes:
            break
        img = np.frombuffer(buf, np.uint8).reshape(H, W, 3).copy()

        faces = detector.detect(img)
        if faces is not None:
            for f in faces:
                if not has_targets:
                    # โหมดเดี่ยว: สลับทุกหน้าด้วยหน้าเดียว (ตัวแรก)
                    swap_one(img, f[4:14], entries[0]["latent"])
                    continue
                # โหมดหลายคน: จับคู่หน้านี้กับ 'คนเป้าหมาย' ที่ผู้ใช้ชี้ไว้ ด้วย ArcFace
                emb = embed_face(img, f[4:14])
                best, bestsim = None, 0.0
                for e in entries:
                    if e["target"] is None:
                        continue
                    sim = float(np.dot(emb, e["target"]))
                    if sim > bestsim:
                        best, bestsim = e, sim
                if best is not None and bestsim >= 0.28:  # ตรงคนที่ชี้ไว้พอสมควร
                    swap_one(img, f[4:14], best["latent"])
                elif catch_all is not None:  # ไม่ตรงใคร → ใช้หน้า 'ทุกคน' ถ้ามี
                    swap_one(img, f[4:14], catch_all["latent"])

        enc.stdin.write(img.tobytes())
        done += 1
        if done % 5 == 0:
            print(f"PROG {done} {max(total, done)}", flush=True)

    dec.stdout.close()
    enc.stdin.close()
    enc.wait()
    print(f"PROG {done} {done}", flush=True)
    print(f"OUT {dst}", flush=True)


if __name__ == "__main__":
    main()
