"""
core/workers/face_censor_worker.py — ตรวจจับใบหน้าอัตโนมัติแล้วเบลอ/โมเสกตามทุกเฟรม
(รันใน venv ของ engine "face-censor" — ใช้ OpenCV YuNet ตรวจจับหน้า ไม่ต้องมี GPU)

ถูกเรียกเป็น subprocess:
    python face_censor_worker.py <src> <dst.mp4> <yunet.onnx> <style> <strength> [start] [dur] [keep_json] [sface.onnx]
style = blur | mosaic
keep_json = รายการหน้า "คนหลัก" ที่จะเก็บไว้ไม่เบลอ [{ "t": วินาทีในไฟล์, "x","y","w","h": สัดส่วน 0–1 }]
           (ถ้ามี → เบลอเฉพาะคนที่ "ไม่ใช่" คนหลัก ด้วยการจดจำใบหน้า SFace)
สื่อสารกลับทาง stdout:  PROG <done> <total>  และ  OUT <path> ตอนจบ

pipeline: ffmpeg ถอดเฟรม (bgr24) → YuNet หาใบหน้าแต่ละเฟรม → เบลอ/โมเสกกรอบหน้า → ffmpeg เข้ารหัสกลับ
ตามหน้าที่ขยับได้เอง เพราะตรวจจับใหม่ทุกเฟรม + จำกรอบล่าสุดไว้กันหลุด (carry-forward)
"""

import json
import subprocess
import sys

import cv2
import numpy as np

COSINE_SAME = 0.363  # เกณฑ์ cosine ของ SFace: มากกว่านี้ = คนเดียวกัน (ค่ามาตรฐาน OpenCV)


def grab_frame(src, t, W, H):
    """ดึงภาพเฟรมเดียวที่เวลา t (วินาที) ออกมาเป็น bgr array — ใช้หาหน้าคนหลักตอนตั้งต้น"""
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", src,
         "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
        capture_output=True,
    )
    if len(out.stdout) < W * H * 3:
        return None
    return np.frombuffer(out.stdout[: W * H * 3], np.uint8).reshape(H, W, 3).copy()


def probe(src):
    import json
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


def censor_region(img, x, y, w, h, style, strength):
    """เบลอ/โมเสกเฉพาะกรอบ (x,y,w,h) ในภาพ (แก้ในที่)"""
    H, W = img.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x1 - x0 < 2 or y1 - y0 < 2:
        return
    roi = img[y0:y1, x0:x1]
    if style == "mosaic":
        px = max(1, int(strength))
        dw = max(1, (x1 - x0) // px)
        dh = max(1, (y1 - y0) // px)
        small = cv2.resize(roi, (dw, dh), interpolation=cv2.INTER_LINEAR)
        img[y0:y1, x0:x1] = cv2.resize(small, (x1 - x0, y1 - y0), interpolation=cv2.INTER_NEAREST)
    else:
        k = max(1, int(strength) * 2 + 1)  # kernel เป็นเลขคี่
        img[y0:y1, x0:x1] = cv2.GaussianBlur(roi, (k, k), 0)


class SCRFDDetector:
    """ตัวตรวจใบหน้า SCRFD (InsightFace) — ทนหน้าเอียง/ยิ้ม/หน้าเล็กกว่า YuNet
    ให้ interface เดียวกับ cv2.FaceDetectorYN: detect(img) → (None, rows[N,15])
    row = x,y,w,h, จุด landmark 5 คู่, score (พิกัดภาพที่ส่งเข้า)"""

    SIZE = 640  # SCRFD รับ input จัตุรัสคงที่ (letterbox เอง)

    def __init__(self, path):
        import onnxruntime as ort

        self.sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        self.inp = self.sess.get_inputs()[0].name
        self.thr = 0.45

    def setInputSize(self, _sz):
        pass  # ขนาดคงที่ 640 — เข้ากับโค้ดเดิมที่เรียก setInputSize

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
            bbox = outs[i + 3].reshape(-1, 4) * stride  # ระยะ ซ้าย/บน/ขวา/ล่าง จากจุดกึ่งกลาง anchor
            kps = outs[i + 6].reshape(-1, 10) * stride
            n = self.SIZE // stride
            gx, gy = np.meshgrid(np.arange(n), np.arange(n))
            centers = np.stack([gx, gy], -1).reshape(-1, 2).astype(np.float32) * stride
            centers = np.repeat(centers, 2, axis=0)  # 2 anchors ต่อช่อง (เรียงติดกัน)
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
            return None, None
        rows = np.array(rows, np.float32)
        rows[:, :14] /= s  # กลับสู่พิกัดภาพจริง (ก่อน letterbox)
        keep = cv2.dnn.NMSBoxes(rows[:, :4].tolist(), rows[:, 14].tolist(), self.thr, 0.4)
        keep = np.array(keep).reshape(-1)
        if keep.size == 0:
            return None, None
        return None, rows[keep]


class YoloBoxDetector:
    """ตัวตรวจกรอบแบบ YOLO (คลาสเดียว เช่นป้ายทะเบียน) — output (1,5,N): cx,cy,w,h,conf"""

    SIZE = 640

    def __init__(self, path, thr=0.35):
        import onnxruntime as ort

        self.sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        self.inp = self.sess.get_inputs()[0].name
        self.thr = thr

    def setInputSize(self, _sz):
        pass

    def detect(self, img):
        h0, w0 = img.shape[:2]
        s = self.SIZE / max(h0, w0)
        nw, nh = max(1, round(w0 * s)), max(1, round(h0 * s))
        pad = np.zeros((self.SIZE, self.SIZE, 3), np.uint8)
        pad[:nh, :nw] = cv2.resize(img, (nw, nh))
        blob = cv2.dnn.blobFromImage(pad, 1 / 255.0, (self.SIZE, self.SIZE), swapRB=True)
        out = self.sess.run(None, {self.inp: blob})[0]
        out = out[0]
        if out.shape[0] < out.shape[1]:  # (5,N) → (N,5)
            out = out.T
        rows = []
        for cx, cy, w, h, conf in out:
            if conf < self.thr:
                continue
            rows.append([cx - w / 2, cy - h / 2, w, h, conf])
        if not rows:
            return None, None
        rows = np.array(rows, np.float32)
        rows[:, :4] /= s
        keep = cv2.dnn.NMSBoxes(rows[:, :4].tolist(), rows[:, 4].tolist(), self.thr, 0.4)
        keep = np.array(keep).reshape(-1)
        if keep.size == 0:
            return None, None
        return None, rows[keep]


class DBTextDetector:
    """ตัวตรวจข้อความ DBNet (PaddleOCR det) — คืนกรอบข้อความทุกจุดในภาพ"""

    LIMIT = 736  # ด้านยาวสุดตอนตรวจ (ต้องหาร 32 ลงตัว)

    def __init__(self, path, thr=0.3):
        import onnxruntime as ort

        self.sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        self.inp = self.sess.get_inputs()[0].name
        self.thr = thr

    def setInputSize(self, _sz):
        pass

    def detect(self, img):
        h0, w0 = img.shape[:2]
        s = min(1.0, self.LIMIT / max(h0, w0))
        nw = max(32, int(round(w0 * s / 32)) * 32)
        nh = max(32, int(round(h0 * s / 32)) * 32)
        rs = cv2.resize(img, (nw, nh)).astype(np.float32) / 255.0
        rs = (rs - (0.485, 0.456, 0.406)) / (0.229, 0.224, 0.225)  # normalize แบบ PaddleOCR
        blob = rs.transpose(2, 0, 1)[None].astype(np.float32)
        prob = self.sess.run(None, {self.inp: blob})[0][0, 0]  # (nh, nw)
        binm = (prob > self.thr).astype(np.uint8) * 255
        # ขยายก้อนขาวเล็กน้อยให้กรอบคลุมตัวอักษรเต็ม
        binm = cv2.dilate(binm, np.ones((3, 3), np.uint8), iterations=2)
        contours, _ = cv2.findContours(binm, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        rows = []
        sx, sy = w0 / nw, h0 / nh
        for c in contours:
            x, y, w, h = cv2.boundingRect(c)
            if w * h < 24:  # เศษเล็กเกิน ไม่ใช่ข้อความ
                continue
            rows.append([x * sx, y * sy, w * sx, h * sy, 1.0])
        if not rows:
            return None, None
        return None, np.array(rows, np.float32)


def make_detector(model_path, det_w, det_h):
    """เลือกตัวตรวจตามไฟล์โมเดล: scrfd → SCRFD / plate → YOLO / ppocr → DBNet / อื่นๆ → YuNet"""
    name = model_path.lower()
    if "scrfd" in name:
        return SCRFDDetector(model_path)
    if "plate" in name:
        return YoloBoxDetector(model_path)
    if "ppocr" in name or "det_infer" in name:
        return DBTextDetector(model_path)
    return cv2.FaceDetectorYN.create(
        model_path, "", (det_w, det_h), score_threshold=0.6, nms_threshold=0.3, top_k=500
    )


def main():
    src, dst, model_path = sys.argv[1], sys.argv[2], sys.argv[3]
    style = sys.argv[4] if len(sys.argv) > 4 else "blur"
    strength = int(sys.argv[5]) if len(sys.argv) > 5 else 12
    start = float(sys.argv[6]) if len(sys.argv) > 6 else 0.0
    seg_dur = float(sys.argv[7]) if len(sys.argv) > 7 else 0.0
    keep_json = sys.argv[8] if len(sys.argv) > 8 else ""
    sface_path = sys.argv[9] if len(sys.argv) > 9 else ""
    # keeps = หน้าคนหลักที่จะเก็บไว้ไม่เบลอ / invert=True → กลับกัน: เบลอเฉพาะคนที่เลือก
    keep_cfg = json.loads(keep_json) if keep_json and keep_json not in ("0", "") else {}
    keeps = keep_cfg.get("faces", []) if isinstance(keep_cfg, dict) else keep_cfg
    invert = bool(keep_cfg.get("invert")) if isinstance(keep_cfg, dict) else False

    W, H, fps, dur = probe(src)
    if seg_dur > 0:
        dur = min(seg_dur, max(0.0, dur - start))
    total = int(dur * fps) or 1

    # ตรวจจับที่ความกว้างสูงสุด 640 เพื่อความเร็ว แล้วสเกลกรอบกลับสู่ขนาดจริง
    det_w = min(W, 640)
    det_h = max(1, round(H * det_w / W))
    scale = W / det_w
    detector = make_detector(model_path, det_w, det_h)

    # ---- โหมดเลือกคน: จดจำใบหน้าที่เลือกไว้ ด้วย SFace ----
    recognizer = None
    sel_embs = []  # embedding ของหน้าที่ผู้ใช้เลือก (คนหลัก หรือคนที่จะเบลอ ถ้า invert)
    if keeps:
        if not sface_path:
            raise SystemExit("โหมดเลือกคนต้องใช้โมเดลจดจำใบหน้า (sface) — ถอนแล้วติดตั้ง engine ใหม่")
        recognizer = cv2.FaceRecognizerSF.create(sface_path, "")

        def embed_at(k):
            """หา embedding ของหน้าที่ทับกรอบ k (สัดส่วน 0–1) ณ เวลา k['t']"""
            frame = grab_frame(src, k["t"], W, H)
            if frame is None:
                return None
            sm = cv2.resize(frame, (det_w, det_h))
            detector.setInputSize((det_w, det_h))
            _, fs = detector.detect(sm)
            if fs is None:
                return None
            # จุดกึ่งกลางกรอบที่เลือก (พิกัด det) → เลือกหน้าที่กรอบครอบจุดนั้น/ใกล้สุด
            kx = (k["x"] + k["w"] / 2) * det_w
            ky = (k["y"] + k["h"] / 2) * det_h
            best, bestd = None, 1e9
            for f in fs:
                cx, cy = f[0] + f[2] / 2, f[1] + f[3] / 2
                d = (cx - kx) ** 2 + (cy - ky) ** 2
                if d < bestd:
                    best, bestd = f, d
            if best is None:
                return None
            aligned = recognizer.alignCrop(sm, best)
            return recognizer.feature(aligned).copy()

        for k in keeps:
            emb = embed_at(k)
            if emb is not None:
                sel_embs.append(emb)
        if not sel_embs:
            raise SystemExit("หาใบหน้าที่เลือกไม่เจอ — เลือกเฟรมที่เห็นหน้าคนหลักชัดๆ แล้วลองใหม่")

    def is_selected(face_row, small_img):
        """หน้านี้ตรงกับคนที่เลือกไว้ไหม (คนหลัก)"""
        if not recognizer or not sel_embs:
            return False
        try:
            aligned = recognizer.alignCrop(small_img, face_row)
            emb = recognizer.feature(aligned)
        except Exception:
            return False
        for se in sel_embs:
            if recognizer.match(emb, se, cv2.FaceRecognizerSF_FR_COSINE) > COSINE_SAME:
                return True
        return False

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

    frame_bytes = W * H * 3
    done = 0
    # จำกรอบหน้าล่าสุดไว้ไม่กี่เฟรม กันเฟรมที่ตรวจไม่เจอแล้วหน้าโผล่ (TTL = ครึ่งวินาที)
    ttl0 = max(3, int(fps * 0.5))
    recent = []  # [[x, y, w, h, ttl], ...]

    while True:
        buf = dec.stdout.read(frame_bytes)
        if len(buf) < frame_bytes:
            break
        img = np.frombuffer(buf, np.uint8).reshape(H, W, 3).copy()

        small = cv2.resize(img, (det_w, det_h))
        detector.setInputSize((det_w, det_h))
        _, faces = detector.detect(small)

        # ลด ttl ของกรอบเก่า
        for r in recent:
            r[4] -= 1
        recent = [r for r in recent if r[4] > 0]

        if faces is not None:
            for f in faces:
                # โหมดเลือกคน: เช็คว่าเป็นคนที่เลือกไหม แล้วตัดสินว่าจะเบลอหน้านี้หรือไม่
                if sel_embs:
                    matched = is_selected(f, small)
                    # ปกติ (keep): เบลอ "คนที่ไม่ตรง" / invert: เบลอ "คนที่ตรง" เท่านั้น
                    if matched != invert:
                        continue  # หน้านี้ไม่ต้องเบลอ
                x, y, w, h = (f[:4] * scale).astype(int)
                # ขยายกรอบ 25% ให้คลุมผม/คาง ไม่หลุดขอบหน้า
                mx, my = int(w * 0.25), int(h * 0.25)
                recent.append([x - mx, y - my, w + 2 * mx, h + 2 * my, ttl0])

        for x, y, w, h, _ in recent:
            censor_region(img, x, y, w, h, style, strength)

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
