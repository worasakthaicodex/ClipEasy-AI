"""
core/workers/lama_worker.py — ลบวัตถุ/เซ็นเซอร์ในกรอบที่เลือก ด้วย LaMa ONNX (รันใน venv ของ Object Remover Fast)

ถูกเรียกเป็น subprocess:
    python lama_worker.py <frames_dir> <out_dir> <model.onnx> <rect_json>
rect_json = {"x":0..1,"y":0..1,"w":0..1,"h":0..1} (สัดส่วนของเฟรม)
สื่อสารกลับทาง stdout:  PROG <done> <total>  และ  OUT <out_dir> ตอนจบ

pipeline ต่อเฟรม: ครอปสี่เหลี่ยมรอบกรอบ (เผื่อขอบให้โมเดลเห็นบริบท) → ย่อเป็น 512×512
→ LaMa inpaint → วางกลับตำแหน่งเดิม — เฟรมนอกกรอบไม่ถูกแตะเลย
"""

import json
import sys
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

SIZE = 512  # LaMa ONNX รับ input ตายตัว 512×512


def main():
    frames_dir, out_dir, model_path, rect_json = sys.argv[1:5]
    rect = json.loads(rect_json)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    frames = sorted(Path(frames_dir).glob("frame_*.png"))
    total = len(frames)
    if not total:
        raise SystemExit("ไม่พบเฟรมใน " + frames_dir)

    # ลอง DirectML ก่อน — แต่ LaMa มี ops แบบ Fourier ที่การ์ด/ไดรเวอร์บางตัวรันไม่ได้
    # ถ้าเฟรมแรกพังให้ตกลงมาใช้ CPU (ช้ากว่าแต่ได้ผลเสมอ)
    sess = ort.InferenceSession(
        model_path,
        providers=["DmlExecutionProvider", "CPUExecutionProvider"],
    )
    in_names = [i.name for i in sess.get_inputs()]

    def run_model(feeds):
        nonlocal sess
        try:
            return sess.run(None, feeds)[0][0]
        except Exception:
            sess = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
            return sess.run(None, feeds)[0][0]

    # อ่านเฟรมแรกเพื่อคำนวณพิกัดครั้งเดียว (ทุกเฟรมขนาดเท่ากัน)
    first = cv2.imread(str(frames[0]))
    H, W = first.shape[:2]
    rx = int(rect["x"] * W)
    ry = int(rect["y"] * H)
    rw = max(2, int(rect["w"] * W))
    rh = max(2, int(rect["h"] * H))

    # ---- แผนการครอป: กรอบใกล้จัตุรัส = กล่องเดียว / กรอบกว้างมาก (เช่นแถบซับ) = หั่นเป็นหลายช่อง ----
    # เหตุผล: กล่องจัตุรัสรอบแถบกว้างเกือบเต็มจอจะใหญ่ ~เท่าความสูงเฟรม พอบีบเหลือ 512
    # ความละเอียดหายครึ่ง ผลออกมาเป็นรอยเบลอละเลง — หั่นช่องเล็กให้แต่ละช่องใกล้ 512 จริงถึงจะคม
    def make_tiles():
        if rw <= rh * 1.6:  # กล่องใกล้จัตุรัส/แนวตั้ง — วิธีเดิมพอ
            side = max(64, min(int(max(rw, rh) * 1.8), min(W, H)))
            cx, cy = rx + rw // 2, ry + rh // 2
            return [(max(0, min(W - side, cx - side // 2)), max(0, min(H - side, cy - side // 2)), side)]
        # แถบกว้าง: ช่องจัตุรัสสูง ~2.2 เท่าของแถบ (มีบริบทบน-ล่าง) แต่ไม่เล็กกว่า 200px
        side = max(200, min(int(rh * 2.2), min(W, H)))
        cy = ry + rh // 2
        y0 = max(0, min(H - side, cy - side // 2))
        step = int(side * 0.8)  # ช่องซ้อนกัน 20% กันเห็นรอยต่อ
        xs, x = [], rx - int(rh * 0.3)  # เริ่มเผื่อซ้ายนิดหน่อย
        end = rx + rw + int(rh * 0.3)
        while x < end:
            xs.append(max(0, min(W - side, x)))
            x += step
        return [(x0, y0, side) for x0 in sorted(set(xs))]

    tiles = make_tiles()

    # mask ต่อช่อง (คำนวณครั้งเดียว): ขาว = ส่วนของกรอบผู้ใช้ที่ตกในช่องนี้
    # ขยายออก ~13px กันขอบวัตถุเหลือเป็นเงา (เทสแล้ว: mask คมทำให้สีซึมกลับ)
    tile_masks = []
    for (x0, y0, side) in tiles:
        sx = SIZE / side
        mask = np.zeros((SIZE, SIZE), np.float32)
        mx0 = int((rx - x0) * sx)
        my0 = int((ry - y0) * sx)
        mx1 = int((rx + rw - x0) * sx)
        my1 = int((ry + rh - y0) * sx)
        mask[max(0, my0):min(SIZE, my1), max(0, mx0):min(SIZE, mx1)] = 1.0
        mask = cv2.dilate(mask, np.ones((13, 13), np.float32))
        tile_masks.append(mask)

    for i, fp in enumerate(frames):
        img = cv2.imread(str(fp))
        for (x0, y0, side), mask in zip(tiles, tile_masks):
            if mask.max() == 0:
                continue  # ช่องนี้ไม่มีพื้นที่ต้องลบ
            crop = img[y0:y0 + side, x0:x0 + side]
            small = cv2.resize(crop, (SIZE, SIZE), interpolation=cv2.INTER_AREA)
            rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
            img_in = rgb.transpose(2, 0, 1)[None]  # [1,3,512,512]

            result = run_model({in_names[0]: img_in, in_names[1]: mask[None, None]})
            # บางเวอร์ชันของโมเดลคืน 0..1 บางเวอร์ชันคืน 0..255 — เช็คจากค่าจริง
            if result.max() <= 1.5:
                result = result * 255.0
            out_rgb = np.clip(result.transpose(1, 2, 0), 0, 255).astype(np.uint8)
            out_bgr = cv2.cvtColor(out_rgb, cv2.COLOR_RGB2BGR)

            # วางกลับตาม mask (feather ขอบให้กลืน) — ไม่ใช่ตามกรอบเป๊ะๆ
            restored = cv2.resize(out_bgr, (side, side), interpolation=cv2.INTER_CUBIC)
            m = cv2.resize(mask, (side, side), interpolation=cv2.INTER_LINEAR)
            m = cv2.GaussianBlur(m, (21, 21), 0)[..., None]
            blended = crop.astype(np.float32) * (1 - m) + restored.astype(np.float32) * m
            img[y0:y0 + side, x0:x0 + side] = np.clip(blended, 0, 255).astype(np.uint8)

        cv2.imwrite(str(out / fp.name), img)
        if (i + 1) % 5 == 0 or i + 1 == total:
            print(f"PROG {i + 1} {total}", flush=True)

    print(f"OUT {out_dir}", flush=True)


if __name__ == "__main__":
    main()
