"""
core/engines.py — ระบบจัดการ AI Engine แบบติดตั้งเพิ่มได้เอง

หลักการ: ตัวแอปไม่แบก dependency AI เลย แต่ละ engine ติดตั้งเป็น venv แยก
ใต้ %LOCALAPPDATA%/ClipEasyAI/engines/<id>/ (venv + โมเดล) ลบทั้งโฟลเดอร์ = ถอนสะอาด
ตอนใช้งานจริงค่อย spawn worker จาก venv ของ engine นั้นเป็น subprocess
"""

import ctypes
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

import threading
import time

from core.video_utils import JobCancelled


def _kill_tree(proc):
    """ฆ่า subprocess พร้อมลูกทั้งหมด — จำเป็นบน Windows เพราะ venv\\Scripts\\python.exe
    เป็นแค่ launcher stub ที่แตกลูกเป็น python จริงอีกตัว proc.kill() ฆ่าแค่ stub ตัวจริงรอด"""
    subprocess.run(
        ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
        capture_output=True,
    )


def _watch_cancel(proc, cancelled):
    """เฝ้างานเบื้องหลัง: เช็คทุก 0.3 วิ ถูกสั่งยกเลิกเมื่อไหร่ฆ่า subprocess ทันที
    (ไม่พึ่ง loop อ่าน stdout ซึ่งบล็อครอ progress บรรทัดถัดไป — เฟรมช้าๆ จะรอนานมาก)"""
    if not cancelled:
        return
    def watch():
        while proc.poll() is None:
            if cancelled():
                _kill_tree(proc)
                return
            time.sleep(0.3)
    threading.Thread(target=watch, daemon=True).start()

# ที่เก็บ engine ทั้งหมด (venv + โมเดล) — อยู่ใต้โปรเจกต์บนไดรฟ์ F ไม่กินพื้นที่ C:
# override ได้ด้วย env CLIPEASY_ENGINES_DIR ถ้าอยากย้ายไดรฟ์
ENGINES_DIR = Path(
    os.environ.get("CLIPEASY_ENGINES_DIR")
    or Path(__file__).resolve().parent.parent / "_engines"
)

# ทะเบียน engine ทั้งหมด — เพิ่มตัวใหม่ = เพิ่ม entry ตรงนี้
REGISTRY = [
  

    {
        "id": "fast",
        "name": "Fast Engine — RVM",
        "vendor": "RobustVideoMatting",
        "category": "ตัดฉากหลัง (Background Removal)",
        "desc": "ตัดฉากหลังบุคคล เน้นเบา รันได้ทุกเครื่อง (CPU / DirectML ดึงการ์ดจอช่วยถ้ามี)",
        "overview": (
            "ตัดฉากหลังออกจากวิดีโอที่มี 'คน' เป็นตัวหลัก ด้วยโมเดล Robust Video Matting "
            "(MobileNetV3) ที่มีหน่วยความจำข้ามเฟรม ทำให้ขอบไม่กระพริบเหมือนการตัดทีละภาพ\n\n"
            "• รันได้ทุกเครื่อง ไม่ต้องมีการ์ดจอแรง (ใช้ CPU หรือ DirectML)\n"
            "• เหมาะกับ vlog / คนพูดหน้ากล้อง / คลิปสัมภาษณ์\n"
            "• ความเร็วโดยประมาณ: 3–8 เฟรม/วินาที ที่ 720p บนเครื่องทั่วไป\n"
            "• จุดอ่อน: ตัดวัตถุ/สัตว์/สิ่งของไม่เก่ง — งานแบบนั้นให้ใช้ Quality Engine"
        ),
        "size_mb": 150,
        "requires_nvidia": False,
        "min_vram_mb": 0,
        "pip": ["onnxruntime-directml", "numpy"],
        "models": [
            {
                "url": "https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx",
                "file": "rvm_mobilenetv3_fp32.onnx",
            }
        ],
    },
    {
        "id": "quality",
        "name": "Quality Engine — BiRefNet",
        "vendor": "BiRefNet",
        "category": "ตัดฉากหลัง (Background Removal)",
        "desc": "คุณภาพสูงสุด ขอบเนียน ตัดได้ทั้งคน/วัตถุ — ต้องการการ์ด NVIDIA VRAM ≥ 6GB",
        "overview": (
            "ตัดฉากหลังคุณภาพสูงสุดด้วย BiRefNet โมเดลระดับ state-of-the-art "
            "ขอบเส้นผม/วัตถุโปร่งแสงเนียนกว่า Fast Engine อย่างเห็นได้ชัด\n\n"
            "• ตัดได้ทุกอย่าง: คน วัตถุ สัตว์ สินค้า\n"
            "• ต้องการการ์ดจอ NVIDIA VRAM อย่างน้อย 6GB (ใช้ CUDA)\n"
            "• ดาวน์โหลดใหญ่ (~3.6GB ส่วนใหญ่คือ PyTorch)\n"
            "• เครื่องสเปคไม่ถึงจะติดตั้งไม่ได้ — ใช้ Fast Engine แทน"
        ),
        "size_mb": 3600,
        "requires_nvidia": True,
        "min_vram_mb": 6144,
        "pip": [
            "torch",
            "torchvision",
            "--index-url",
            "https://download.pytorch.org/whl/cu121",
        ],
        "models": [
            {
                "url": "https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/BiRefNet-general-epoch_244.onnx",
                "file": "birefnet.onnx",
            }
        ],
    },
    {
        "id": "isnet",
        "name": "General Engine — ISNet (DIS)",
        "vendor": "xuebinqin / DIS",
        "category": "ตัดฉากหลัง (Background Removal)",
        "desc": "ตัดได้ทุกอย่าง คน/สัตว์/สิ่งของ — รันได้ทุกเครื่อง (โมเดลเดียวกับ rembg)",
        "overview": (
            "ตัดฉากหลังแบบ 'อะไรก็ได้' ด้วย ISNet จากงานวิจัย Dichotomous Image Segmentation "
            "(ตัวเดียวกับที่ rembg ใช้เป็นค่าเริ่มต้น)\n\n"
            "• ตัดได้ทั้งคน สัตว์ สินค้า วัตถุ — จุดที่ RVM ทำไม่ได้\n"
            "• รันได้ทุกเครื่อง (CPU / DirectML)\n"
            "• ตัดทีละเฟรม ไม่มีหน่วยความจำข้ามเฟรม — มีระบบเกลี่ย mask กันขอบสั่นให้แล้ว\n"
            "• งานคนพูดหน้ากล้องล้วนๆ Fast Engine (RVM) ยังนิ่งกว่า — ตัวนี้เด่นเรื่องความหลากหลาย"
        ),
        "size_mb": 180,
        "requires_nvidia": False,
        "min_vram_mb": 0,
        "pip": ["onnxruntime-directml", "numpy", "opencv-python-headless"],
        "models": [
            {
                "url": "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx",
                "file": "isnet-general-use.onnx",
            }
        ],
    },
    {
        "id": "sam2",
        "name": "SAM2 — Segment & Track",
        "vendor": "Meta AI",
        "category": "ตัดฉากหลัง (Background Removal)",
        "desc": "คลิกเลือกวัตถุแล้วตามตัดทั้งคลิป — ต้องการ NVIDIA VRAM ≥ 8GB (ตัวรันจะมาเวอร์ชันถัดไป)",
        "overview": (
            "Segment Anything 2 ของ Meta — จิ้มเลือกวัตถุหนึ่งครั้ง โมเดลจะตามตัดวัตถุนั้น "
            "ต่อเนื่องทั้งคลิปให้เอง แม่นยำระดับ state-of-the-art\n\n"
            "• เลือกเป้าหมายเองได้: คนคนเดียวในกลุ่ม / สัตว์ / วัตถุชิ้นเดียว\n"
            "• ต้องการการ์ดจอ NVIDIA VRAM อย่างน้อย 8GB (CUDA)\n"
            "• ดาวน์โหลดใหญ่ (~4GB ส่วนใหญ่คือ PyTorch)\n"
            "• หมายเหตุ: เวอร์ชันนี้ติดตั้งเตรียมไว้ก่อนได้ ตัวประมวลผลจะเปิดใช้ในรุ่นถัดไป"
        ),
        "size_mb": 4000,
        "requires_nvidia": True,
        "min_vram_mb": 8192,
        "pip": [
            "torch",
            "torchvision",
            "--index-url",
            "https://download.pytorch.org/whl/cu121",
        ],
        "models": [
            {
                "url": "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt",
                "file": "sam2.1_hiera_small.pt",
            }
        ],
    },
    {
        "id": "e2fgvi",
        "name": "Magic Remove Motion — E2FGVI-HQ",
        "vendor": "MCG-NKU / E2FGVI",
        "category": "ลบวัตถุออกจากวิดีโอ (Magic Remove)",
        "desc": "ลบเป้าที่เคลื่อนไหว เก็บฉากไว้ — ยืมฉากหลังจากเฟรมอื่นมาอุด ต้องการ NVIDIA ≥ 4GB",
        "overview": (
            "Video inpainting แบบ flow-based: ลบคน/วัตถุที่เคลื่อนที่ออกจากคลิป "
            "โดยยืมพิกเซลฉากหลังจริงจากเฟรมข้างเคียงมาอุด — เนียนกว่าการเดาทีละเฟรมแบบ LaMa มาก\n\n"
            "• จุดที่ต่างจาก Magic Remove Fast: เข้าใจการเคลื่อนไหวข้ามเฟรม เป้าเดินไปมาก็ลบได้\n"
            "• เหมาะกับการ์ด NVIDIA ระดับ GTX 1650 / RTX ทุกรุ่น (VRAM ≥ 4GB)\n"
            "• ดาวน์โหลด ~3.9GB (ส่วนใหญ่คือ PyTorch CUDA / ตัวโมเดลแค่ 165MB)\n"
            "• หมายเหตุ: เวอร์ชันนี้ติดตั้งเตรียมไว้ก่อนได้ ตัวประมวลผลจะเปิดใช้ในรุ่นถัดไป"
        ),
        "size_mb": 3900,
        "requires_nvidia": True,
        "min_vram_mb": 4096,
        "pip": [
            "torch",
            "torchvision",
            "--index-url",
            "https://download.pytorch.org/whl/cu121",
        ],
        "models": [
            {
                "url": "https://huggingface.co/ZhihaoLI/E2FGVI-HQ/resolve/main/E2FGVI-HQ-CVPR22.pth",
                "file": "e2fgvi_hq.pth",
            }
        ],
    },
    {
        "id": "diffueraser",
        "name": "Magic Remove Ultra — DiffuEraser",
        "vendor": "Alibaba (2025)",
        "category": "ลบวัตถุออกจากวิดีโอ (Magic Remove)",
        "desc": "ลบวัตถุด้วย diffusion — เนียนสุดแม้ฉากหลังไม่เคยโผล่เลย ต้องการ NVIDIA ≥ 12GB",
        "overview": (
            "ตัวท็อปของสายลบวัตถุ (2025): ใช้ diffusion 'วาดฉากหลังขึ้นใหม่' "
            "ได้เนียนแม้บริเวณที่ถูกเป้าบังตลอดทั้งคลิป — จุดที่ flow-based ทำไม่ได้\n\n"
            "• คุณภาพสูงสุดในหมวดนี้ เหมาะกับงานที่เป้าใหญ่/บังฉากนาน\n"
            "• ต้องการการ์ด NVIDIA VRAM อย่างน้อย 12GB (เช่น RTX 3060 12GB)\n"
            "• ดาวน์โหลดใหญ่มาก (~13GB: โมเดล 8.8GB + PyTorch CUDA)\n"
            "• หมายเหตุ: เวอร์ชันนี้ติดตั้งเตรียมไว้ก่อนได้ ตัวประมวลผลจะเปิดใช้ในรุ่นถัดไป"
        ),
        "size_mb": 13000,
        "requires_nvidia": True,
        "min_vram_mb": 12288,
        "pip": [
            "torch",
            "torchvision",
            "--index-url",
            "https://download.pytorch.org/whl/cu121",
        ],
        "models": [
            {
                "url": "https://huggingface.co/lixiaowen/diffuEraser/resolve/main/unet_main/diffusion_pytorch_model.safetensors",
                "file": "unet_main.safetensors",
            },
            {
                "url": "https://huggingface.co/lixiaowen/diffuEraser/resolve/main/unet_main/config.json",
                "file": "unet_main.config.json",
            },
            {
                "url": "https://huggingface.co/lixiaowen/diffuEraser/resolve/main/brushnet/diffusion_pytorch_model.safetensors",
                "file": "brushnet.safetensors",
            },
            {
                "url": "https://huggingface.co/lixiaowen/diffuEraser/resolve/main/brushnet/config.json",
                "file": "brushnet.config.json",
            },
        ],
    },
    {
        "id": "gyroflow",
        "name": "Stabilize Pro — Gyroflow",
        "vendor": "Gyroflow (open source)",
        "category": "ลดสั่น (Stabilize)",
        "desc": "ลดสั่นระดับเทพจากข้อมูล gyro ในไฟล์ (GoPro / DJI / Insta360 / โดรน) — รันได้ทุกเครื่อง",
        "overview": (
            "ลดสั่นด้วยข้อมูลเซ็นเซอร์ gyroscope ที่กล้องฝังไว้ในไฟล์ — รู้การสั่นจริง "
            "ไม่ต้องเดาจากภาพ ผลนิ่งระดับ gimbal\n\n"
            "• ใช้ได้กับไฟล์จากกล้องที่บันทึก gyro: GoPro, DJI, Insta360, Sony, กล้องโดรน\n"
            "• คลิปมือถือ/กล้องทั่วไปไม่มี gyro — ใช้ปุ่ม 'ลดสั่น (Stabilize)' ในตัวแอปแทน (ฟรี ไม่ต้องติดตั้ง)\n"
            "• เป็นโปรแกรม portable รันได้ทุกเครื่อง ไม่ต้องมีการ์ดจอแรง\n"
            "• หมายเหตุ: เวอร์ชันนี้ติดตั้งเตรียมไว้ก่อนได้ ตัวประมวลผลจะเปิดใช้ในรุ่นถัดไป"
        ),
        "size_mb": 150,
        "requires_nvidia": False,
        "min_vram_mb": 0,
        "pip": [],
        "archives": [
            {
                "url": "https://github.com/gyroflow/gyroflow/releases/download/v1.6.3/Gyroflow-windows64.zip",
                "file": "gyroflow.zip",
            }
        ],
        "models": [],
    },

   
    {
        "id": "whisper-small",
        "name": "ถอดเสียง/ซับ — Whisper Small",
        "vendor": "OpenAI / Systran (faster-whisper)",
        "category": "ถอดเสียงเป็นซับ (Speech-to-Text)",
        "desc": "ถอดเสียงพูดในคลิปเป็นซับไตเติลอัตโนมัติ (รวมไทย) พร้อม timestamp — เบา รันได้ทุกเครื่อง (CPU)",
        "overview": (
            "Whisper รุ่น Small (ผ่าน faster-whisper ที่เร็วกว่าต้นฉบับหลายเท่า) — ฟังเสียงพูด "
            "ในคลิปแล้วถอดเป็นข้อความพร้อมเวลาเริ่ม-จบแต่ละประโยค ทำซับไตเติลได้อัตโนมัติ\n\n"
            "• รองรับหลายภาษ รวมภาษาไทย และรู้จังหวะประโยคเอง (ได้ .srt พร้อมใช้)\n"
            "• รุ่น Small — เบา รันได้ทุกเครื่องด้วย CPU เร็วพอใช้งานจริง\n"
            "• ต่อกับ NLLB/M2M ในคลังเพื่อแปลซับเป็นภาษาอื่นได้\n"
            "• ดาวน์โหลด ~500MB\n"
            "• หมายเหตุ: ตัวเรียกใช้ในแอปจะเปิดในรุ่นถัดไป — ติดตั้งเตรียมไว้ได้"
        ),
        "size_mb": 500,
        "requires_nvidia": False,
        "min_vram_mb": 0,
        "pip": ["faster-whisper", "huggingface_hub[cli]"],
        "models": [],
        "hf_repos": [{"repo": "Systran/faster-whisper-small", "dir": "whisper-small"}],
    },
    {
        "id": "whisper-medium",
        "name": "ถอดเสียง/ซับ — Whisper Medium",
        "vendor": "OpenAI / Systran (faster-whisper)",
        "category": "ถอดเสียงเป็นซับ (Speech-to-Text)",
        "desc": "ถอดเสียงแม่นกว่ารุ่น Small ชัดเจน — รันได้ทุกเครื่อง (CPU ช้าหน่อย / GPU เร็ว)",
        "overview": (
            "Whisper รุ่น Medium — แม่นยำกว่า Small ชัดเจน โดยเฉพาะเสียงมีนอยซ์/สำเนียงหลากหลาย/"
            "ภาษาไทยยากๆ ยังรันบน CPU ได้ (ช้ากว่า) เร็วขึ้นมากถ้ามีการ์ดจอ\n\n"
            "• ความแม่นดีขึ้นชัดสำหรับงานจริงจัง\n"
            "• รันได้ทุกเครื่อง — CPU ช้าลง, NVIDIA เร็ว\n"
            "• ดาวน์โหลด ~1.5GB\n"
            "• หมายเหตุ: ตัวเรียกใช้ในแอปจะเปิดในรุ่นถัดไป — ติดตั้งเตรียมไว้ได้"
        ),
        "size_mb": 1500,
        "requires_nvidia": False,
        "min_vram_mb": 0,
        "pip": ["faster-whisper", "huggingface_hub[cli]"],
        "models": [],
        "hf_repos": [{"repo": "Systran/faster-whisper-medium", "dir": "whisper-medium"}],
    },
    {
        "id": "whisper-large",
        "name": "ถอดเสียง/ซับ — Whisper Large v3",
        "vendor": "OpenAI / Systran (faster-whisper)",
        "category": "ถอดเสียงเป็นซับ (Speech-to-Text)",
        "desc": "ถอดเสียงแม่นสุด รองรับทุกภาษาดีที่สุด — แนะนำ NVIDIA (CPU ได้แต่ช้ามาก)",
        "overview": (
            "Whisper Large v3 — รุ่นใหญ่สุด แม่นยำสูงสุด รองรับภาษาและสำเนียงได้ดีที่สุด "
            "เหมาะกับงานที่ต้องการซับคุณภาพระดับส่งงาน\n\n"
            "• ความแม่นสูงสุดในตระกูล Whisper\n"
            "• แนะนำเครื่องมีการ์ด NVIDIA (~5GB) — CPU รันได้แต่ช้ามาก\n"
            "• ดาวน์โหลด ~3GB\n"
            "• หมายเหตุ: ตัวเรียกใช้ในแอปจะเปิดในรุ่นถัดไป — ติดตั้งเตรียมไว้ได้"
        ),
        "size_mb": 3000,
        "requires_nvidia": False,
        "min_vram_mb": 0,
        "pip": ["faster-whisper", "huggingface_hub[cli]"],
        "models": [],
        "hf_repos": [{"repo": "Systran/faster-whisper-large-v3", "dir": "whisper-large-v3"}],
    },
    {
        "id": "rife",
        "name": "เพิ่มเฟรม/สโลว์โมชัน — RIFE",
        "vendor": "hzwer / Practical-RIFE",
        "category": "เพิ่มเฟรม / สโลว์โมชัน (Frame Interpolation)",
        "desc": "แทรกเฟรมกลางด้วย AI ทำสโลว์โมชันลื่น หรือเพิ่ม fps (30→60) — รันได้ทุกเครื่อง",
        "overview": (
            "RIFE — โมเดลแทรกเฟรมกลางระหว่างสองเฟรมจริง ด้วยการประเมิน optical flow "
            "ใช้ทำสโลว์โมชันเนียน (2×/4×) หรือเพิ่มเฟรมเรต 30→60fps ให้ภาพลื่น\n\n"
            "• เร็วและเบา — โมเดลเล็ก (~50MB) รันได้ทั้ง CPU และ NVIDIA\n"
            "• เหมาะกับสโลว์โมชันจากคลิปเฟรมเรตปกติ / ทำวิดีโอ 60fps\n"
            "• ตัวยอดนิยมที่สุดของสายนี้\n"
            "• หมายเหตุ: ตัวเรียกใช้ในแอปจะเปิดในรุ่นถัดไป — ติดตั้งเตรียมไว้ได้"
        ),
        "size_mb": 150,
        "requires_nvidia": False,
        "min_vram_mb": 0,
        "pip": ["torch", "torchvision", "--index-url", "https://download.pytorch.org/whl/cpu"],
        "models": [
            {
                "url": "https://huggingface.co/AlexWortega/RIFE/resolve/main/flownet.pkl",
                "file": "flownet.pkl",
            }
        ],
    },
    {
        "id": "ifrnet",
        "name": "เพิ่มเฟรม/สโลว์โมชัน — IFRNet",
        "vendor": "ltkong218 / IFRNet",
        "category": "เพิ่มเฟรม / สโลว์โมชัน (Frame Interpolation)",
        "desc": "แทรกเฟรมอีกแนวหนึ่ง เนียนกับการเคลื่อนไหวเร็ว — โมเดลเบา รันได้ทุกเครื่อง",
        "overview": (
            "IFRNet — โมเดลแทรกเฟรมที่ประมวลผล flow กับ refinement รวมในเครือข่ายเดียว "
            "ให้ผลเนียนกับฉากเคลื่อนไหวเร็ว เป็นทางเลือกคู่กับ RIFE\n\n"
            "• มีสองรุ่นน้ำหนัก: Vimeo90K (ทั่วไป) และ GoPro (ภาพเคลื่อนไหวแรงๆ)\n"
            "• โมเดลเบา รันได้ทั้ง CPU และ NVIDIA\n"
            "• เลือกใช้แทน RIFE เมื่อผลของ RIFE เกิด artifact ในบางฉาก\n"
            "• หมายเหตุ: ตัวเรียกใช้ในแอปจะเปิดในรุ่นถัดไป — ติดตั้งเตรียมไว้ได้"
        ),
        "size_mb": 120,
        "requires_nvidia": False,
        "min_vram_mb": 0,
        "pip": ["torch", "torchvision", "--index-url", "https://download.pytorch.org/whl/cpu"],
        "models": [
            {
                "url": "https://huggingface.co/pavlichenko/ifrnet_vimeo/resolve/main/IFRNet_Vimeo90K.pth",
                "file": "IFRNet_Vimeo90K.pth",
            }
        ],
    },
    {
        "id": "nllb",
        "name": "แปลภาษา — NLLB-200",
        "vendor": "Meta AI",
        "category": "แปลภาษา (Translation)",
        "desc": "แปลซับไตเติล 200 ภาษา (รวมไทย) — โมเดลกลาง รันได้ทุกเครื่อง (CPU/GPU)",
        "overview": (
            "NLLB-200 (No Language Left Behind) ของ Meta — แปลข้อความได้ 200 ภาษา "
            "รวมภาษาไทย ใช้แปลซับไตเติลที่ถอดจาก Whisper เป็นภาษาอื่นในตัวแอป\n\n"
            "• ครอบคลุมภาษามากที่สุด รวมภาษาที่โมเดลอื่นไม่รองรับ\n"
            "• รุ่น distilled 600M — รันได้ทุกเครื่อง (CPU ก็ไหว, GPU เร็วขึ้น)\n"
            "• ดาวน์โหลด ~2.5GB\n"
            "• หมายเหตุ: ตัวเรียกใช้ในแอปจะเปิดในรุ่นถัดไป — ติดตั้งเตรียมไว้ได้"
        ),
        "size_mb": 2500,
        "requires_nvidia": False,
        "min_vram_mb": 0,
        "pip": ["transformers", "sentencepiece", "huggingface_hub[cli]"],
        "models": [],
        "hf_repos": [{"repo": "facebook/nllb-200-distilled-600M", "dir": "nllb-600m"}],
    },
    {
        "id": "m2m100",
        "name": "แปลภาษา — M2M-100",
        "vendor": "Meta AI",
        "category": "แปลภาษา (Translation)",
        "desc": "แปลตรง 100 ภาษาโดยไม่ผ่านอังกฤษ — โมเดลเล็ก เบากว่า NLLB (CPU)",
        "overview": (
            "M2M-100 ของ Meta — แปลระหว่าง 100 ภาษาแบบตรงคู่ต่อคู่ (ไม่ต้องผ่านอังกฤษเป็นตัวกลาง) "
            "รุ่น 418M เบาและเร็ว เหมาะแปลซับปริมาณมาก\n\n"
            "• เบากว่า NLLB — รันเร็วบน CPU\n"
            "• คุณภาพดีกับคู่ภาษาหลัก\n"
            "• ดาวน์โหลด ~2GB\n"
            "• หมายเหตุ: ตัวเรียกใช้ในแอปจะเปิดในรุ่นถัดไป — ติดตั้งเตรียมไว้ได้"
        ),
        "size_mb": 2000,
        "requires_nvidia": False,
        "min_vram_mb": 0,
        "pip": ["transformers", "sentencepiece", "huggingface_hub[cli]"],
        "models": [],
        "hf_repos": [{"repo": "facebook/m2m100_418M", "dir": "m2m100-418m"}],
    },
    {
        "id": "seamless",
        "name": "แปลภาษา — SeamlessM4T v2",
        "vendor": "Meta AI",
        "category": "แปลภาษา (Translation)",
        "desc": "แปลได้ทั้งข้อความและเสียง (speech-to-text/translation) — ต้องการ NVIDIA ~8GB",
        "overview": (
            "SeamlessM4T v2 ของ Meta — โมเดลรวมที่แปลได้ทั้งข้อความและเสียงพูดข้ามภาษา "
            "(เช่น ฟังเสียงพูดภาษาหนึ่ง ออกมาเป็นข้อความอีกภาษา) ในตัวเดียว\n\n"
            "• ครบเครื่อง: text↔text, speech→text ข้ามภาษา\n"
            "• ต้องการ NVIDIA VRAM ~8GB (โมเดลใหญ่)\n"
            "• ดาวน์โหลดใหญ่ ~9GB\n"
            "• หมายเหตุ: ตัวเรียกใช้ในแอปจะเปิดในรุ่นถัดไป — ติดตั้งเตรียมไว้ได้"
        ),
        "size_mb": 9000,
        "requires_nvidia": True,
        "min_vram_mb": 8192,
        "pip": ["transformers", "sentencepiece", "huggingface_hub[cli]"],
        "models": [],
        "hf_repos": [{"repo": "facebook/seamless-m4t-v2-large", "dir": "seamless-m4t-v2"}],
    },
    {
        "id": "piper-tts",
        "name": "พากย์เสียง — Piper",
        "vendor": "rhasspy / Piper",
        "category": "พากย์เสียง (Text-to-Speech)",
        "desc": "แปลงข้อความเป็นเสียงพูด เบามาก รันบน CPU ทุกเครื่อง — เสียงพรีเซ็ต (ไม่โคลนเสียงใคร)",
        "overview": (
            "Piper — TTS แบบ neural ที่เบาและเร็วมาก ออกแบบมาให้รันบน CPU/อุปกรณ์เล็กได้ "
            "ใช้ทำเสียงบรรยาย/พากย์คลิปจากข้อความ ด้วยเสียงพรีเซ็ตสังเคราะห์\n\n"
            "• รันได้ทุกเครื่อง ไม่ต้องมีการ์ดจอ (CPU) เร็วกว่า real-time\n"
            "• ติดตั้งมาพร้อมเสียงอังกฤษ (en_US-lessac) — โหลดเสียงภาษาอื่นเพิ่มได้ภายหลัง\n"
            "• เสียงพรีเซ็ตคงที่ ไม่ใช่การโคลนเสียงบุคคล\n"
            "• หมายเหตุ: ตัวเรียกใช้ในแอปจะเปิดในรุ่นถัดไป — ติดตั้งเตรียมไว้ได้"
        ),
        "size_mb": 120,
        "requires_nvidia": False,
        "min_vram_mb": 0,
        "pip": ["piper-tts"],
        "models": [
            {
                "url": "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx",
                "file": "en_US-lessac-medium.onnx",
            },
            {
                "url": "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json",
                "file": "en_US-lessac-medium.onnx.json",
            },
        ],
    },
    {
        "id": "kokoro-tts",
        "name": "พากย์เสียง — Kokoro",
        "vendor": "hexgrad / Kokoro-82M",
        "category": "พากย์เสียง (Text-to-Speech)",
        "desc": "TTS คุณภาพสูงขนาดเล็ก (82M) เสียงธรรมชาติ หลายเสียงพรีเซ็ต — รันได้ทั้ง CPU/GPU",
        "overview": (
            "Kokoro-82M — TTS ที่ให้เสียงธรรมชาติระดับต้นๆ ของโมเดลเปิด ทั้งที่โมเดลเล็กมาก "
            "(82M พารามิเตอร์) มีเสียงพรีเซ็ตให้เลือกหลายเสียง\n\n"
            "• คุณภาพเสียงดีกว่า Piper เห็นได้ชัด โมเดลยังเล็กพอรันได้ทั่วไป\n"
            "• รันได้ทั้ง CPU (ช้าหน่อย) และ NVIDIA (เร็ว)\n"
            "• ดาวน์โหลด ~350MB\n"
            "• เสียงพรีเซ็ตสังเคราะห์ ไม่ใช่การโคลนเสียงบุคคล\n"
            "• หมายเหตุ: ตัวเรียกใช้ในแอปจะเปิดในรุ่นถัดไป — ติดตั้งเตรียมไว้ได้"
        ),
        "size_mb": 400,
        "requires_nvidia": False,
        "min_vram_mb": 0,
        "pip": ["huggingface_hub[cli]"],
        "models": [],
        "hf_repos": [{"repo": "hexgrad/Kokoro-82M", "dir": "kokoro-82m"}],
    },

{
    "id": "xtts-v2",
    "name": "พากย์เสียง — XTTS v2",
    "vendor": "Coqui",
    "category": "พากย์เสียง (Text-to-Speech)",
    "desc": "สร้างเสียงพูดหลายภาษา พร้อมรองรับการใช้ตัวอย่างเสียงอ้างอิงเพื่อสร้างเสียงในลักษณะเดียวกัน",
    "overview": (
        "XTTS v2 เป็นโมเดล Text-to-Speech แบบหลายภาษา "
        "รองรับการสร้างเสียงคุณภาพสูง และสามารถใช้ตัวอย่างเสียงสั้นเพื่อสร้างเสียงในลักษณะเดียวกัน\n\n"
        "• รองรับหลายภาษา\n"
        "• คุณภาพเสียงสูง\n"
        "• รองรับ CPU และ GPU (GPU เร็วกว่า)\n"
        "• ดาวน์โหลดโมเดลประมาณ 2GB\n"
        "• หมายเหตุ: ตัวเรียกใช้ในแอปจะเปิดในรุ่นถัดไป — ติดตั้งเตรียมไว้ได้"
    ),
    "size_mb": 2100,
    "requires_nvidia": False,
    "min_vram_mb": 0,
    "pip": ["coqui-tts"],
    "models": [],
    "hf_repos": [
        {
            "repo": "coqui/XTTS-v2",
            "dir": "xtts-v2"
        }
    ]
},

    {
        "id": "ace-step",
        "name": "สร้างเพลง — ACE-Step",
        "vendor": "ACE Studio / StepFun",
        "category": "สร้างเสียง/เพลงด้วย AI (Audio Generation)",
        "desc": "สร้างเพลงเต็มเพลงจากข้อความ (แนว/เนื้อร้อง) — NVIDIA ~8GB รันเร็ว",
        "overview": (
            "ACE-Step — โมเดลสร้างเพลงจากข้อความยุคใหม่ ใส่แนวเพลง/อารมณ์/เนื้อร้องแล้วได้ "
            "เพลงเต็มความยาวหลายนาที เร็วกว่าโมเดลเพลงรุ่นก่อนหลายเท่า\n\n"
            "• สร้างเพลงประกอบคลิป/แบ็กกราวด์มิวสิกจาก prompt ได้ในตัวแอป\n"
            "• ต้องการ NVIDIA VRAM ~8GB ขึ้นไป\n"
            "• ดาวน์โหลด ~7GB\n"
            "• หมายเหตุ: ติดตั้งเตรียมน้ำหนักโมเดลไว้ก่อนได้ ตัวรัน + PyTorch CUDA จะเปิดใช้รุ่นถัดไป"
        ),
        "size_mb": 7000,
        "requires_nvidia": True,
        "min_vram_mb": 8192,
        "pip": ["diffusers", "transformers", "accelerate", "huggingface_hub[cli]"],
        "models": [],
        "hf_repos": [{"repo": "ACE-Step/ACE-Step-v1-3.5B", "dir": "ace-step-3.5b"}],
    },
    {
        "id": "stable-audio",
        "name": "สร้างเสียง — Stable Audio Open",
        "vendor": "Stability AI",
        "category": "สร้างเสียง/เพลงด้วย AI (Audio Generation)",
        "desc": "สร้างเอฟเฟกต์เสียง/ลูปสั้นจากข้อความ (สูงสุด ~47 วิ) — NVIDIA ~8GB",
        "overview": (
            "Stable Audio Open ของ Stability AI — สร้างเสียงประกอบและลูปดนตรีสั้นจากข้อความ "
            "(เช่น 'ฝนตก', 'กลองลูปกีตาร์', 'เสียงเมือง') ยาวได้ถึง ~47 วินาที\n\n"
            "• เหมาะทำ sound effect / ambience / ลูปประกอบคลิป\n"
            "• ต้องการ NVIDIA VRAM ~8GB ขึ้นไป\n"
            "• ดาวน์โหลด ~5GB\n"
            "• หมายเหตุ: ติดตั้งเตรียมน้ำหนักโมเดลไว้ก่อนได้ ตัวรัน + PyTorch CUDA จะเปิดใช้รุ่นถัดไป"
        ),
        "size_mb": 5000,
        "requires_nvidia": True,
        "min_vram_mb": 8192,
        "pip": ["diffusers", "transformers", "accelerate", "huggingface_hub[cli]"],
        "models": [],
        # mirror ที่เปิดสาธารณะ — repo ทางการ (stabilityai) ต้องล็อกอิน HF
        "hf_repos": [{"repo": "audo/stable-audio-open-1.0", "dir": "stable-audio-open"}],
    },

    
    {
        "id": "sdxl",
        "name": "สร้างภาพ — SDXL",
        "vendor": "Stability AI",
        "category": "สร้างภาพด้วย AI (Image Generation)",
        "desc": "สร้างภาพนิ่งจากข้อความ ความละเอียด 1024² — มาตรฐานสายภาพ NVIDIA ≥ 8GB",
        "overview": (
            "Stable Diffusion XL — โมเดลสร้างภาพจากข้อความยอดนิยม ใช้ทำภาพประกอบ/พื้นหลัง/"
            "ปกคลิปได้ในตัวแอป\n\n"
            "• สร้างภาพ 1024×1024 จาก prompt\n"
            "• ต้องการ NVIDIA VRAM ~8GB ขึ้นไป\n"
            "• ดาวน์โหลด ~7GB\n"
            "• หมายเหตุ: ติดตั้งเตรียมน้ำหนักโมเดลไว้ก่อนได้ ตัวรัน + PyTorch CUDA จะเปิดใช้รุ่นถัดไป"
        ),
        "size_mb": 7000,
        "requires_nvidia": True,
        "min_vram_mb": 8192,
        "pip": ["diffusers", "transformers", "accelerate", "huggingface_hub[cli]"],
        "models": [],
        "hf_repos": [{"repo": "stabilityai/stable-diffusion-xl-base-1.0", "dir": "sdxl-base"}],
    },
    {
        "id": "flux-schnell",
        "name": "สร้างภาพ — FLUX.1 schnell",
        "vendor": "Black Forest Labs (Apache-2.0)",
        "category": "สร้างภาพด้วย AI (Image Generation)",
        "desc": "สร้างภาพคุณภาพสูงเพียงไม่กี่ step — เร็วและคมกว่า SDXL ต้องการ NVIDIA ≥ 12GB",
        "overview": (
            "FLUX.1 schnell ของ Black Forest Labs — โมเดลสร้างภาพรุ่นใหม่ที่ให้ภาพคุณภาพสูง "
            "ในไม่กี่ step (เร็วมาก) รายละเอียดและตัวหนังสือในภาพดีกว่า SDXL ชัดเจน\n\n"
            "• คุณภาพระดับแนวหน้าของโมเดลเปิด ไลเซนส์ Apache-2.0 ใช้เชิงพาณิชย์ได้\n"
            "• ต้องการ NVIDIA VRAM ~12GB ขึ้นไป (เวอร์ชัน fp8 ประหยัดกว่า)\n"
            "• ดาวน์โหลด ~17GB (มีไฟล์ fp8 ~12GB ให้เลือกด้วย)\n"
            "• หมายเหตุ: ติดตั้งเตรียมน้ำหนักโมเดลไว้ก่อนได้ ตัวรัน + PyTorch CUDA จะเปิดใช้รุ่นถัดไป"
        ),
        "size_mb": 17000,
        "requires_nvidia": True,
        "min_vram_mb": 12288,
        "pip": ["diffusers", "transformers", "accelerate", "huggingface_hub[cli]"],
        "models": [],
        # ใช้ mirror ของ Comfy-Org ที่เปิดสาธารณะ — repo ทางการ (black-forest-labs) ต้องล็อกอิน HF
        "hf_repos": [{"repo": "Comfy-Org/flux1-schnell", "dir": "flux1-schnell"}],
    },
    {
        "id": "cogvideox",
        "name": "สร้างวิดีโอ — CogVideoX-2B",
        "vendor": "Zhipu AI (zai-org)",
        "category": "สร้างวิดีโอด้วย AI (Video Generation)",
        "desc": "สร้างวิดีโอจากข้อความ — ตัวเบาสุดของสายนี้ NVIDIA ≥ 6GB ก็เริ่มได้",
        "overview": (
            "โมเดลสร้างวิดีโอจากข้อความ (text-to-video) ขนาด 2B พารามิเตอร์ — "
            "ตัวที่เข้าถึงง่ายที่สุดในกลุ่ม เพราะรันด้วย VRAM น้อยสุด\n\n"
            "• สร้างคลิปสั้น ~6 วินาที 720×480 จากคำบรรยาย\n"
            "• ต้องการ NVIDIA VRAM ~6GB ขึ้นไป (เปิด CPU offload ช่วยได้)\n"
            "• ดาวน์โหลด ~8GB\n"
            "• หมายเหตุ: ติดตั้งเตรียมน้ำหนักโมเดลไว้ก่อนได้ ตัวรัน + PyTorch CUDA จะเปิดใช้รุ่นถัดไป"
        ),
        "size_mb": 8000,
        "requires_nvidia": True,
        "min_vram_mb": 6144,
        "pip": ["diffusers", "transformers", "accelerate", "huggingface_hub[cli]"],
        "models": [],
        "hf_repos": [{"repo": "zai-org/CogVideoX-2b", "dir": "cogvideox-2b"}],
    },
    {
        "id": "animatediff",
        "name": "สร้างวิดีโอ — AnimateDiff",
        "vendor": "guoyww (AnimateDiff)",
        "category": "สร้างวิดีโอด้วย AI (Video Generation)",
        "desc": "เพิ่มการเคลื่อนไหวให้ Stable Diffusion — สร้างคลิปสั้นจากข้อความ NVIDIA ~8GB",
        "overview": (
            "AnimateDiff — โมดูล motion ที่ต่อกับ Stable Diffusion 1.5 ทำให้สร้าง 'วิดีโอสั้น' "
            "จากข้อความได้ (ไม่ใช่แค่ภาพนิ่ง) สไตล์ภาพหลากหลายตาม base model ที่ใช้\n\n"
            "• สร้างคลิปสั้น ~2-3 วินาทีจาก prompt สไตล์อาร์ต/อนิเมะ/ภาพวาดได้ดี\n"
            "• ต้องการ NVIDIA VRAM ~8GB (ต้องมี base model SD1.5 คู่กัน)\n"
            "• ดาวน์โหลด motion adapter ~1.7GB (base model โหลดแยกเพิ่ม)\n"
            "• หมายเหตุ: ติดตั้งเตรียม motion adapter ไว้ก่อนได้ ตัวรัน + PyTorch CUDA จะเปิดใช้รุ่นถัดไป"
        ),
        "size_mb": 2000,
        "requires_nvidia": True,
        "min_vram_mb": 8192,
        "pip": ["diffusers", "transformers", "accelerate", "huggingface_hub[cli]"],
        "models": [],
        "hf_repos": [{"repo": "guoyww/animatediff-motion-adapter-v1-5-3", "dir": "animatediff-adapter"}],
    },
{
    "id": "liveportrait",
    "name": "ภาพเคลื่อนไหว — LivePortrait",
    "vendor": "KwaiVGI",
    "category": "สร้างวิดีโอด้วย AI (Video Generation)",
    "desc": "ทำให้ภาพบุคคลเคลื่อนไหวตามวิดีโอหรือการแสดงออก",
    "overview": (
        "LivePortrait เป็นโมเดลสำหรับสร้างภาพเคลื่อนไหวจากภาพนิ่ง "
        "โดยถ่ายทอดการเคลื่อนไหวและการแสดงสีหน้าจากวิดีโออ้างอิง\n\n"
        "• Image Animation คุณภาพสูง\n"
        "• รองรับการถ่ายทอดสีหน้าและการเคลื่อนไหว\n"
        "• ใช้ GPU NVIDIA เพื่อประสิทธิภาพที่ดีที่สุด\n"
        "• ดาวน์โหลดโมเดลเพิ่มเติมหลังติดตั้ง\n"
        "• หมายเหตุ: ตัวเรียกใช้ในแอปจะเปิดในรุ่นถัดไป — ติดตั้งเตรียมไว้ได้"
    ),
    "size_mb": 2500,
    "requires_nvidia": True,
    "min_vram_mb": 6000,
    "pip": [],
    "git": "https://github.com/KwaiVGI/LivePortrait",
    "models": []
},
{
    "id": "magicanimate",
    "name": "ภาพเคลื่อนไหว — MagicAnimate",
    "vendor": "MagicAnimate Project",
    "category": "สร้างวิดีโอด้วย AI (Video Generation)",
    "desc": "สร้างภาพเคลื่อนไหวจากภาพนิ่งโดยอ้างอิงการเคลื่อนไหวของวิดีโอ",
    "overview": (
        "MagicAnimate เป็นโมเดล Image Animation ที่ใช้ภาพนิ่งและวิดีโออ้างอิง "
        "เพื่อสร้างวิดีโอที่มีการเคลื่อนไหวอย่างเป็นธรรมชาติ\n\n"
        "• ถ่ายทอดท่าทางและการเคลื่อนไหวจากวิดีโออ้างอิง\n"
        "• เหมาะสำหรับสร้าง Avatar และ Character Animation\n"
        "• ใช้ GPU NVIDIA เพื่อประสิทธิภาพที่ดีที่สุด\n"
        "• ดาวน์โหลดโมเดลเพิ่มเติมหลังติดตั้ง\n"
        "• หมายเหตุ: ตัวเรียกใช้ในแอปจะเปิดในรุ่นถัดไป — ติดตั้งเตรียมไว้ได้"
    ),
    "size_mb": 4200,
    "requires_nvidia": True,
    "min_vram_mb": 8000,
    "pip": [],
    "git": "https://github.com/magic-research/magic-animate",
    "models": []
}
,

    {
        "id": "wan-lite",
        "name": "สร้างวิดีโอ — Wan 2.1 (1.3B)",
        "vendor": "Alibaba / Wan-AI",
        "category": "สร้างวิดีโอด้วย AI (Video Generation)",
        "desc": "รุ่นเบาของ Wan สร้างวิดีโอจากข้อความ — NVIDIA ~8GB ก็ไหว เหมาะตลาดการ์ดกลาง",
        "overview": (
            "Wan 2.1 T2V-1.3B — รุ่นเล็กของตระกูล Wan ที่ออกแบบให้รันบนการ์ดจอผู้ใช้ทั่วไป "
            "สร้างวิดีโอจากข้อความที่ 480p ได้บน VRAM ราว 8GB\n\n"
            "• ตัวสร้างวิดีโอที่เข้าถึงง่ายสุดในคลัง — ตลาด GTX/RTX กลางเริ่มได้\n"
            "• ต้องการ NVIDIA VRAM ~8GB ขึ้นไป\n"
            "• ดาวน์โหลด ~8GB\n"
            "• หมายเหตุ: ติดตั้งเตรียมน้ำหนักโมเดลไว้ก่อนได้ ตัวรัน + PyTorch CUDA จะเปิดใช้รุ่นถัดไป"
        ),
        "size_mb": 8000,
        "requires_nvidia": True,
        "min_vram_mb": 8192,
        "pip": ["diffusers", "transformers", "accelerate", "huggingface_hub[cli]"],
        "models": [],
        "hf_repos": [{"repo": "Wan-AI/Wan2.1-T2V-1.3B-Diffusers", "dir": "wan2.1-t2v-1.3b"}],
    },
    {
        "id": "wan22",
        "name": "สร้างวิดีโอ — Wan 2.2 (5B)",
        "vendor": "Alibaba / Wan-AI",
        "category": "สร้างวิดีโอด้วย AI (Video Generation)",
        "desc": "text/image-to-video 720p คุณภาพสูง — ต้องการ NVIDIA ≥ 16GB",
        "overview": (
            "Wan 2.2 TI2V-5B ของ Alibaba — สร้างวิดีโอจากข้อความหรือจากภาพนิ่ง (ทำภาพให้ขยับ) "
            "ที่ 720p 24fps คุณภาพระดับแนวหน้าของโมเดลเปิด\n\n"
            "• รองรับทั้ง text-to-video และ image-to-video ในตัวเดียว\n"
            "• ต้องการ NVIDIA VRAM ~16GB ขึ้นไป (RTX 4080/4090 หรือ 4060 Ti 16GB แบบอดทน)\n"
            "• ดาวน์โหลดใหญ่ ~20GB\n"
            "• หมายเหตุ: ติดตั้งเตรียมน้ำหนักโมเดลไว้ก่อนได้ ตัวรัน + PyTorch CUDA จะเปิดใช้รุ่นถัดไป"
        ),
        "size_mb": 20000,
        "requires_nvidia": True,
        "min_vram_mb": 16384,
        "pip": ["diffusers", "transformers", "accelerate", "huggingface_hub[cli]"],
        "models": [],
        "hf_repos": [{"repo": "Wan-AI/Wan2.2-TI2V-5B", "dir": "wan2.2-ti2v-5b"}],
    },
    {
        "id": "hunyuanvideo",
        "name": "สร้างวิดีโอ — HunyuanVideo (13B)",
        "vendor": "Tencent",
        "category": "สร้างวิดีโอด้วย AI (Video Generation)",
        "desc": "ตัวท็อปโมเดลเปิดสายสร้างวิดีโอ 13B — ต้องการ NVIDIA ≥ 24GB",
        "overview": (
            "HunyuanVideo ของ Tencent — โมเดลสร้างวิดีโอเปิดที่ใหญ่และคุณภาพสูงที่สุดตัวหนึ่ง "
            "(13B พารามิเตอร์) การเคลื่อนไหวลื่นและตรง prompt กว่าโมเดลเล็ก\n\n"
            "• คุณภาพสูงสุดในหมวดนี้\n"
            "• ต้องการ NVIDIA VRAM อย่างน้อย 24GB (RTX 3090/4090 ขึ้นไป) — เกินตลาดหลักของแอป "
            "ลงทะเบียนไว้สำหรับเครื่อง workstation\n"
            "• ดาวน์โหลดใหญ่มาก ~30GB\n"
            "• หมายเหตุ: ติดตั้งเตรียมน้ำหนักโมเดลไว้ก่อนได้ ตัวรัน + PyTorch CUDA จะเปิดใช้รุ่นถัดไป"
        ),
        "size_mb": 30000,
        "requires_nvidia": True,
        "min_vram_mb": 24576,
        "pip": ["diffusers", "transformers", "accelerate", "huggingface_hub[cli]"],
        "models": [],
        "hf_repos": [{"repo": "tencent/HunyuanVideo", "dir": "hunyuanvideo"}],
    },
    {
        "id": "harmonizer",
        "name": "Blend Match — Harmonizer",
        "vendor": "ZHKKKe / Harmonizer",
        "category": "ปรับให้กลืน (Harmonization)",
        "desc": "ปรับแสง/สีของวิดีโอที่วางซ้อนให้เข้ากับฉากหลังอัตโนมัติ — รันได้ทุกเครื่อง",
        "overview": (
            "แก้อาการ 'วางซ้อนแล้วดูแปะ' — โมเดล Harmonizer วิเคราะห์แสงและโทนสีของ"
            "ฉากหลัง แล้วปรับชั้นที่ซ้อน (ความสว่าง/อุณหภูมิสี/คอนทราสต์) ให้กลืนเป็นภาพเดียวกัน\n\n"
            "• โมเดลเบามาก (19MB) รันได้ทุกเครื่องด้วย CPU\n"
            "• เหมาะกับงานตัดคน/วัตถุมาวางฉากใหม่ หลังใช้เครื่องมือลบพื้นหลัง\n"
            "• หมายเหตุ: เวอร์ชันนี้ติดตั้งเตรียมไว้ก่อนได้ ตัวประมวลผลจะเปิดใช้ในรุ่นถัดไป"
        ),
        "size_mb": 250,
        "requires_nvidia": False,
        "min_vram_mb": 0,
        "pip": [
            "torch",
            "torchvision",
            "--index-url",
            "https://download.pytorch.org/whl/cpu",
        ],
        "models": [
            {
                "url": "https://huggingface.co/vineetjain18/harmonizer/resolve/main/harmonizer.pth",
                "file": "harmonizer.pth",
            }
        ],
    },
    {
        "id": "pctnet",
        "name": "Blend Match Pro — PCT-Net",
        "vendor": "Rakuten Institute of Technology",
        "category": "ปรับให้กลืน (Harmonization)",
        "desc": "ปรับให้กลืนคุณภาพสูงกว่า — ต้องการ NVIDIA VRAM ≥ 4GB (GTX 1650 ขึ้นไป)",
        "overview": (
            "Harmonization รุ่นใหม่กว่า (2023) คุณภาพการกลืนแสง/สีเหนือกว่า Harmonizer "
            "โดยเฉพาะฉากแสงซับซ้อน ประมวลผลระดับพิกเซลด้วย ViT\n\n"
            "• เหมาะกับเครื่องมีการ์ด NVIDIA ระดับ GTX 1650 / RTX ทุกรุ่น (VRAM ≥ 4GB)\n"
            "• ดาวน์โหลดใหญ่ (~3.8GB ส่วนใหญ่คือ PyTorch CUDA)\n"
            "• หมายเหตุ: เวอร์ชันนี้ติดตั้งเตรียมไว้ก่อนได้ ตัวประมวลผลจะเปิดใช้ในรุ่นถัดไป"
        ),
        "size_mb": 3800,
        "requires_nvidia": True,
        "min_vram_mb": 4096,
        "pip": [
            "torch",
            "torchvision",
            "--index-url",
            "https://download.pytorch.org/whl/cu121",
        ],
        "models": [
            {
                "url": "https://raw.githubusercontent.com/rakutentech/PCT-Net-Image-Harmonization/main/pretrained_models/PCTNet_ViT.pth",
                "file": "pctnet_vit.pth",
            }
        ],
    },
    {
        "id": "esrgan",
        "name": "Upscale Fast — Real-ESRGAN",
        "vendor": "xinntao / Real-ESRGAN",
        "category": "ปรับภาพชัด (Enhance / Upscale)",
        "desc": "อัปสเกลเพิ่มรายละเอียดด้วย AI — ตัว portable ใช้ Vulkan รันได้กับการ์ดจอทุกยี่ห้อ",
        "overview": (
            "เพิ่มความละเอียดและรายละเอียดให้วิดีโอด้วย Real-ESRGAN (โมเดล animevideo v3 ×2 "
            "ที่ออกแบบมาเพื่อวิดีโอโดยเฉพาะ)\n\n"
            "• เป็นโปรแกรม portable (.exe) ใช้ Vulkan — รันได้กับการ์ดจอทุกยี่ห้อ ไม่ต้องมี CUDA\n"
            "• ติดตั้งเร็ว ไม่ต้องลง Python เพิ่ม\n"
            "• เหมาะกับคลิปความละเอียดต่ำ/ภาพนุ่ม ที่อยากได้รายละเอียดคืน\n"
            "• ช้า: ทำทีละเฟรม — แนะนำใช้กับก้อนสั้นๆ ที่เลือกไว้ ไม่ใช่ทั้งคลิปยาว\n"
            "• แค่อยากให้ 'คมขึ้นนิดเดียว' ใช้ slider Sharpen ใน Properties ฟรีและเร็วกว่า"
        ),
        "size_mb": 60,
        "requires_nvidia": False,
        "min_vram_mb": 0,
        "pip": [],  # ไม่ต้องมี venv — เป็น .exe portable
        "archives": [
            {
                "url": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip",
                "file": "realesrgan.zip",
            }
        ],
        "models": [],
    },
    {
        "id": "vsr-quality",
        "name": "Upscale Quality — RealBasicVSR",
        "vendor": "OpenMMLab",
        "category": "ปรับภาพชัด (Enhance / Upscale)",
        "desc": "Video Super-Resolution ตัวจริง อ่านหลายเฟรมพร้อมกัน ภาพนิ่งไม่วูบวาบ — ต้อง NVIDIA ≥ 6GB",
        "overview": (
            "อัปสเกลคุณภาพสูงสุดด้วย RealBasicVSR — โมเดล video super-resolution แท้ "
            "ที่ดูข้อมูลจากหลายเฟรมรอบๆ พร้อมกัน ผลลัพธ์เนียนต่อเนื่อง ไม่มีอาการวิบวับรายเฟรม\n\n"
            "• คุณภาพเหนือกว่า Real-ESRGAN ชัดเจนกับวิดีโอ\n"
            "• ต้องการการ์ด NVIDIA VRAM อย่างน้อย 6GB (CUDA)\n"
            "• ดาวน์โหลดใหญ่ (~3.7GB ส่วนใหญ่คือ PyTorch)"
        ),
        "size_mb": 3700,
        "requires_nvidia": True,
        "min_vram_mb": 6144,
        "pip": [
            "torch",
            "torchvision",
            "--index-url",
            "https://download.pytorch.org/whl/cu121",
        ],
        "models": [
            {
                "url": "https://download.openmmlab.com/mmediting/restorers/real_basicvsr/realbasicvsr_c64b20_1x30x8_lr5e-5_150k_reds_20211104-52f77c2c.pth",
                "file": "realbasicvsr.pth",
            }
        ],
    },
    {
        "id": "face-censor",
        "name": "เซ็นเซอร์ใบหน้าอัตโนมัติ — YuNet",
        "vendor": "OpenCV Zoo / YuNet",
        "category": "เซ็นเซอร์อัตโนมัติ (Auto Censor)",
        "desc": "ตรวจจับใบหน้าคนในคลิปแล้วเบลอ/โมเสกตามให้เองทุกเฟรม ไม่ต้องลากกล่อง — เบา รันทุกเครื่อง (CPU)",
        "overview": (
            "ตรวจจับใบหน้าทุกคนในเฟรมด้วย YuNet แล้วเบลอ/โมเสกตามตำแหน่งหน้าให้อัตโนมัติ "
            "ตามหน้าที่ขยับไปมาได้เอง เพราะตรวจจับใหม่ทุกเฟรม\n\n"
            "• ไม่ต้องจัดตำแหน่งเอง — กดปุ่มเดียวเบลอหน้าคนไม่เกี่ยวทั้งคลิป\n"
            "• รันได้ทุกเครื่อง ไม่ต้องมีการ์ดจอ (CPU)\n"
            "• โมเดลเล็กมาก (~350KB) ติดตั้งเร็ว\n"
            "• เหมาะกับงานข่าว/สัมภาษณ์ที่ต้องปิดหน้าคนผ่านกล้อง\n"
            "• จำกัด: จับเฉพาะ 'ใบหน้า' (ไม่ใช่ทั้งตัว) มุมก้ม/หันข้างมากๆ อาจหลุดบางเฟรม"
        ),
        "size_mb": 80,
        "requires_nvidia": False,
        "min_vram_mb": 0,
        "pip": ["opencv-python-headless", "numpy"],
        "models": [
            {
                "url": "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
                "file": "yunet.onnx",
            },
            {
                # จดจำใบหน้า — ใช้ตอนเลือก "เก็บคนหลักไว้ ไม่เบลอ" (เบลอเฉพาะคนอื่น)
                "url": "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
                "file": "sface.onnx",
            },
        ],
    },
    {
        "id": "face-censor-pro",
        "name": "เซ็นเซอร์ใบหน้า Pro — SCRFD",
        "vendor": "InsightFace / SCRFD",
        "category": "เซ็นเซอร์อัตโนมัติ (Auto Censor)",
        "desc": "ตรวจจับใบหน้าแม่นกว่า — หน้าเอียง ยิ้ม ก้ม/เงย หน้าเล็กไกลๆ ไม่ค่อยหลุด (CPU)",
        "overview": (
            "ตัวตรวจจับใบหน้ารุ่นแรงกว่า ใช้ SCRFD-10G จาก InsightFace "
            "ที่เทรนมาให้ทนมุมหน้าหลากหลายกว่า YuNet มาก\n\n"
            "• หน้าเอียง หันข้าง ยิ้มกว้าง ก้ม/เงย ตรวจเจอต่อเนื่องกว่า YuNet ชัดเจน\n"
            "• หน้าเล็กๆ ไกลๆ ในเฟรมก็จับได้ดีกว่า\n"
            "• รันได้ทุกเครื่อง (CPU) — ช้ากว่า YuNet ราว 2–3 เท่า แลกกับความแม่น\n"
            "• รองรับโหมดเลือกคนหลักไว้ไม่เบลอ เหมือนตัวเดิมทุกอย่าง\n"
            "• ติดตั้งแล้วสลับโมเดลได้ในตัวเลือกเซ็นเซอร์ (เฟือง ⚙ ข้างปุ่ม)"
        ),
        "size_mb": 130,
        "requires_nvidia": False,
        "min_vram_mb": 0,
        "pip": ["onnxruntime", "opencv-python-headless", "numpy"],
        "models": [
            {
                "url": "https://huggingface.co/DIAMONIK7777/antelopev2/resolve/main/scrfd_10g_bnkps.onnx",
                "file": "scrfd_10g_bnkps.onnx",
            },
            {
                # จดจำใบหน้า — โหมดเก็บคนหลักไว้ไม่เบลอ (ตัวเดียวกับ engine เดิม)
                "url": "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
                "file": "sface.onnx",
            },
        ],
    },
    {
        "id": "censor-plate",
        "name": "เบลอป้ายทะเบียนรถ — YOLO Plate",
        "vendor": "morsetechlab / YOLOv11-plate",
        "category": "เซ็นเซอร์อัตโนมัติ (Auto Censor)",
        "desc": "ตรวจจับป้ายทะเบียนรถทุกคันแล้วเบลอ/โมเสกตามให้เองทุกเฟรม (CPU)",
        "overview": (
            "ตรวจจับป้ายทะเบียนรถด้วยโมเดล YOLOv11 ที่ fine-tune มาเฉพาะป้ายทะเบียน "
            "แล้วเบลอ/โมเสกตามให้อัตโนมัติทุกเฟรม\n\n"
            "• เหมาะกับคลิปถ่ายริมถนน / รีวิวรถ / vlog ที่ติดทะเบียนคันอื่น\n"
            "• รันได้ทุกเครื่อง (CPU)\n"
            "• ใช้จากปุ่มเซ็นเซอร์เดิม — เปลี่ยน 'เป้าหมาย' ในตัวเลือก (เฟือง ⚙) เป็นป้ายทะเบียน"
        ),
        "size_mb": 130,
        "requires_nvidia": False,
        "min_vram_mb": 0,
        "pip": ["onnxruntime", "opencv-python-headless", "numpy"],
        "models": [
            {
                "url": "https://huggingface.co/morsetechlab/yolov11-license-plate-detection/resolve/main/license-plate-finetune-v1n.onnx",
                "file": "plate_yolo.onnx",
            }
        ],
    },
    {
        "id": "censor-text",
        "name": "ปิดข้อความในเอกสาร — DBNet",
        "vendor": "PaddleOCR / RapidOCR",
        "category": "เซ็นเซอร์อัตโนมัติ (Auto Censor)",
        "desc": "ตรวจจับ 'ข้อความทั้งหมด' ในภาพ (เอกสาร ป้าย หน้าจอ) แล้วเบลอปิดข้อมูลส่วนบุคคล (CPU)",
        "overview": (
            "ตรวจจับตำแหน่งข้อความทุกจุดในเฟรมด้วย DBNet (ตัวตรวจของ PaddleOCR) "
            "แล้วเบลอ/โมเสกทับ — ใช้ปิดข้อมูลส่วนบุคคลบนเอกสาร บัตร หน้าจอ ที่ติดกล้อง\n\n"
            "• เบลอ 'ข้อความทั้งหมด' ที่เจอ — เหมาะกับฉากที่เอกสารไม่ควรอ่านออกทั้งใบ\n"
            "• โมเดลเล็กมาก ติดตั้งเร็ว รันได้ทุกเครื่อง (CPU)\n"
            "• ใช้จากปุ่มเซ็นเซอร์เดิม — เปลี่ยน 'เป้าหมาย' ในตัวเลือก (เฟือง ⚙) เป็นข้อความ"
        ),
        "size_mb": 120,
        "requires_nvidia": False,
        "min_vram_mb": 0,
        "pip": ["onnxruntime", "opencv-python-headless", "numpy"],
        "models": [
            {
                "url": "https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv4/en_PP-OCRv3_det_infer.onnx",
                "file": "ppocr_det.onnx",
            }
        ],
    },
    {
    "id": "comfyui",
    "name": "ComfyUI",
    "vendor": "ComfyUI",
    "category": "Workflow",
    "type": "platform",
    "desc": "แพลตฟอร์มสร้าง Workflow AI แบบ Node รองรับโมเดลภาพและวิดีโอจำนวนมาก",
    "overview": (
        "ComfyUI เป็นแพลตฟอร์มแบบ Node-based สำหรับรันโมเดล AI "
        "รองรับ Stable Diffusion, FLUX, Wan, Hunyuan Video และโมเดลอื่นอีกจำนวนมาก\n\n"
        "• Workflow แบบลากต่อ Node\n"
        "• รองรับ Custom Nodes จำนวนมาก\n"
        "• เหมาะสำหรับงาน Image และ Video AI\n"
        "• รองรับ Windows และ Linux\n"
        "• หมายเหตุ: โมเดลต่าง ๆ ติดตั้งแยกภายหลัง"
    ),
    "size_mb": 200,
    "requires_nvidia": False,
    "min_vram_mb": 0,
    "pip": [],
    "git": "https://github.com/comfyanonymous/ComfyUI",
    "models": []
},
    {
        "id": "face-swap-local",
        "name": "สลับหน้า — InsightFace + GFPGAN",
        "vendor": "InsightFace / TencentARC",
        "category": "สลับหน้า (Face Swap)",
        "desc": "เอาหน้าจากรูปเดียวไปแปะในวิดีโอ (สายมีม) + ปรับหน้าคมด้วย GFPGAN — รันทุกเครื่อง (CPU)",
        "overview": (
            "Face swap ตัวเดียวกับที่แอปดังๆ ใช้หลังบ้าน: inswapper ของ InsightFace "
            "ใช้รูปหน้าต้นแบบแค่รูปเดียว แล้วสลับหน้าคนในวิดีโอให้ทุกเฟรม "
            "ปิดท้ายด้วย GFPGAN เก็บรายละเอียดผิว/ตา ให้หน้าที่สลับแล้วคมไม่เบลอ\n\n"
            "• เหมาะกับคลิปมีม / คลิปสั้นสายฮา — ใช้รูปหน้าตรงชัดๆ รูปเดียวพอ\n"
            "• รันได้ทุกเครื่อง ไม่ต้องมีการ์ดจอ (CPU) — คลิปมีม 10–20 วิ รอไม่กี่นาที\n"
            "• มีตัวตรวจหน้า (SCRFD) ในชุด เลือกได้ว่าจะสลับหน้าใครในคลิป\n"
            "• โมเดล inswapper เป็นไลเซนส์เพื่อการวิจัย/ใช้ส่วนตัว — ใช้กับงานของตัวเองเท่านั้น\n"
            "• หมายเหตุ: เวอร์ชันนี้ติดตั้งเตรียมไว้ก่อนได้ เมนูสลับหน้าจะเปิดใช้ในรุ่นถัดไป"
        ),
        "size_mb": 1100,
        "requires_nvidia": False,
        "min_vram_mb": 0,
        # onnx (ตัวไลบรารี) ใช้อ่านตาราง emap ที่ฝังใน inswapper.onnx
        "pip": ["onnxruntime", "onnx", "opencv-python-headless", "numpy"],
        "models": [
            {
                # ตัวสลับหน้าหลัก (ใช้ embedding หน้าต้นแบบจาก ArcFace ด้านล่าง)
                "url": "https://huggingface.co/ezioruan/inswapper_128.onnx/resolve/main/inswapper_128.onnx",
                "file": "inswapper_128.onnx",
            },
            {
                # สกัด embedding ใบหน้าต้นแบบ (w600k_r50 — คู่บัดดี้ของ inswapper)
                "url": "https://huggingface.co/facefusion/models-3.0.0/resolve/main/arcface_w600k_r50.onnx",
                "file": "arcface_w600k_r50.onnx",
            },
            {
                # ตรวจจับใบหน้า + landmark (ตัวเดียวกับ engine เซ็นเซอร์หน้า Pro)
                "url": "https://huggingface.co/DIAMONIK7777/antelopev2/resolve/main/scrfd_10g_bnkps.onnx",
                "file": "scrfd_10g_bnkps.onnx",
            },
            {
                # เก็บรายละเอียดหน้าหลังสลับ (face restoration)
                "url": "https://huggingface.co/facefusion/models-3.0.0/resolve/main/gfpgan_1.4.onnx",
                "file": "gfpgan_1.4.onnx",
            },
        ],
    },



    
    {
        "id": "face-swap-facefusion",
        "name": "สลับหน้า Pro — FaceFusion",
        "vendor": "FaceFusion",
        "category": "สลับหน้า (Face Swap)",
        "desc": "FaceFusion ตัวเต็ม — masking/occlusion เนียนกว่า ขอบไม่เห็นรอยซ้อน (CPU ได้ แต่ช้ากว่า)",
        "overview": (
            "ติดตั้ง FaceFusion (โปรแกรม open-source สลับหน้าตัวเต็ม) ไว้เป็นทางเลือกคุณภาพสูง\n\n"
            "• มี occlusion mask + face parser ในตัว → ขอบหน้าเนียน ไม่เห็นกรอบ/รอยซ้อนแบบตัว Fast\n"
            "• จัดการหน้าเอียง/มีมือบังหน้าได้ดีกว่า\n"
            "• รันได้ทุกเครื่อง (CPU) แต่ช้ากว่าตัว Fast พอควร — การ์ด NVIDIA จะเร็วขึ้นมาก\n"
            "• ดาวน์โหลด ~3GB (ซอร์ส + โมเดลโหลดอัตโนมัติครั้งแรกที่ใช้)\n"
            "• ไลเซนส์เพื่อการใช้ส่วนตัว/ถูกกฎหมายเท่านั้น — ห้ามใช้สร้างสื่อหลอกลวงหรือละเมิดผู้อื่น"
        ),
        "size_mb": 3000,
        "requires_nvidia": False,
        "min_vram_mb": 0,
        "pip": [],  # ติดตั้งผ่าน requirements.txt ของซอร์สหลังแตก zip
        "archives": [
            {
                "url": "https://github.com/facefusion/facefusion/archive/refs/tags/3.7.1.zip",
                "file": "facefusion.zip",
            }
        ],
        "requirements": "facefusion-3.7.1/requirements.txt",
        "models": [],  # FaceFusion โหลดโมเดลเองครั้งแรกที่รัน
    },


{
    "id": "reactor",
    "name": "Face Swap — ReActor",
    "vendor": "Gourieff",
    "category": "สลับหน้า (Face Swap)",
    "type": "plugin",
    "desc": "ปลั๊กอิน Face Swap สำหรับ ComfyUI และ Stable Diffusion WebUI",
    "overview": (
        "ReActor เป็นปลั๊กอิน Face Swap "
        "ที่ทำงานร่วมกับ ComfyUI หรือ Stable Diffusion WebUI\n\n"
        "• รองรับภาพและวิดีโอ\n"
        "• ต้องติดตั้งบนแพลตฟอร์มที่รองรับ\n"
        "• ใช้ InsightFace และโมเดลที่เกี่ยวข้อง\n"
        "• หมายเหตุ: ต้องติดตั้ง ComfyUI หรือ WebUI ก่อน"
    ),
    "size_mb": 80,
    "requires_nvidia": False,
    "min_vram_mb": 0,
    "pip": [],
    "git": "https://github.com/Gourieff/comfyui-reactor-node",
    "models": []
},
{
    "id": "roop",
    "name": "Face Swap — Roop",
    "vendor": "Roop",
    "category": "สลับหน้า (Face Swap)",
    "type": "application",
    "desc": "โปรแกรม Face Swap แบบโอเพนซอร์ส",
    "overview": (
        "Roop เป็นโปรแกรม Face Swap แบบโอเพนซอร์ส เเต่โครงการต้นฉบับยุติการพัฒนาแล้ว"
        "สามารถใช้งานกับรูปภาพและวิดีโอได้\n\n"
        "• รองรับการประมวลผลภาพและวิดีโอ\n"
        "• ใช้ InsightFace\n"
        "• ปัจจุบันมีหลาย Fork ที่ยังพัฒนาต่อ\n"
        "• หมายเหตุ: ควรเลือก Fork ที่ยังได้รับการดูแล"
    ),
    "size_mb": 0,
    "requires_nvidia": False,
    "min_vram_mb": 0,
    "pip": [],
    "git": "",
    "models": []
},



    {
        "id": "track-csrt",
        "name": "ชี้เป้า Fast — CSRT",
        "vendor": "OpenCV",
        "category": "ชี้เป้า / ตามวัตถุ (Object Tracking)",
        "desc": "ตีกรอบเป้าครั้งเดียว AI ตามให้ทั้งคลิป พร้อมวงกลม/ลูกศร/กรอบวิ่งตามเป้า — รันทุกเครื่อง (CPU)",
        "overview": (
            "Object tracking แบบคลาสสิกด้วย CSRT จาก OpenCV — ตีกรอบเป้าหมายหนึ่งครั้ง "
            "ระบบจะตามวัตถุนั้นทุกเฟรม แล้ววาดสัญลักษณ์ชี้เป้า (วงกลม/ลูกศร/กรอบ) วิ่งตามให้เอง\n\n"
            "• เหมาะกับคลิปวิเคราะห์กีฬา / ไฮไลต์บุคคล / ชี้จุดสนใจในคลิปสอน\n"
            "• รันได้ทุกเครื่อง ไม่ต้องมีการ์ดจอ (CPU) ติดตั้งเร็ว ไม่มีโมเดลต้องโหลด\n"
            "• แม่นพอสำหรับงานชี้เป้าทั่วไป เป้าชัด แสงคงที่\n"
            "• จุดอ่อน: เป้าโดนบังนานๆ หรือหมุนตัวเร็วๆ อาจหลุด — งานแบบนั้นใช้ตัว Pro"
        ),
        "size_mb": 90,
        "requires_nvidia": False,
        "min_vram_mb": 0,
        "pip": ["opencv-contrib-python-headless", "numpy"],
        "models": [],
    },
    {
        "id": "track-vit",
        "name": "ชี้เป้า Pro — ViTTrack",
        "vendor": "OpenCV Zoo / VitTrack (2023)",
        "category": "ชี้เป้า / ตามวัตถุ (Object Tracking)",
        "desc": "ตามเป้าด้วยโครงข่าย Vision Transformer เหนียวกว่าเวลาเป้าโดนบัง/หมุนตัว — โมเดลเล็กมาก รันทุกเครื่อง (CPU)",
        "overview": (
            "Object tracking ยุคใหม่ด้วย ViTTrack (Vision Transformer จาก OpenCV Zoo) "
            "ตีกรอบครั้งเดียวแล้วตามเป้าได้เหนียวกว่า CSRT ชัดเจน "
            "โดยเฉพาะเป้าที่โดนบังชั่วคราว หมุนตัว หรือเปลี่ยนขนาดเร็ว\n\n"
            "• โมเดลเล็กมาก (<1MB!) โหลดไว ประมวลผลเร็วกว่า CSRT ด้วยซ้ำ\n"
            "• รันได้ทุกเครื่อง ไม่ต้องมีการ์ดจอ (CPU)\n"
            "• ใช้จากปุ่มชี้เป้าเดียวกัน — เลือกโมเดลได้ตรงตัวเลือกก่อนกด\n"
            "• สัญลักษณ์ชี้เป้าแบบเดียวกัน: วงกลม / ลูกศร / กรอบ"
        ),
        "size_mb": 95,
        "requires_nvidia": False,
        "min_vram_mb": 0,
        "pip": ["opencv-contrib-python-headless", "numpy"],
        "models": [
            {
                "url": "https://github.com/opencv/opencv_zoo/raw/main/models/object_tracking_vittrack/object_tracking_vittrack_2023sep.onnx",
                "file": "vittrack.onnx",
            }
        ],
    },
    {
        "id": "track-nano",
        "name": "ชี้เป้า Lite — NanoTrack",
        "vendor": "HonglinChu / NanoTrack v2",
        "category": "ชี้เป้า / ตามวัตถุ (Object Tracking)",
        "desc": "ตามเป้าแบบเบาสุด เร็วสุด — โมเดลรวม <2MB เหมาะกับคลิปยาวๆ/เครื่องช้า (CPU)",
        "overview": (
            "Object tracking ตัวจิ๋วสายความเร็ว — NanoTrack v2 ออกแบบมาให้รันบนอุปกรณ์เบาๆ "
            "โดยเฉพาะ เร็วกว่า CSRT หลายเท่าโดยความแม่นใกล้เคียงกันในฉากทั่วไป\n\n"
            "• เร็วสุดในสามตัว — เหมาะกับคลิปยาวหรือเครื่องสเปคต่ำ\n"
            "• โมเดลรวมไม่ถึง 2MB ติดตั้งไว\n"
            "• รันได้ทุกเครื่อง ไม่ต้องมีการ์ดจอ (CPU)\n"
            "• เป้าโดนบังนาน/ฉากซับซ้อน ตัว Pro (ViTTrack) ยังเหนียวกว่า"
        ),
        "size_mb": 92,
        "requires_nvidia": False,
        "min_vram_mb": 0,
        "pip": ["opencv-contrib-python-headless", "numpy"],
        "models": [
            {
                "url": "https://raw.githubusercontent.com/HonglinChu/SiamTrackers/master/NanoTrack/models/nanotrackv2/nanotrack_backbone_sim.onnx",
                "file": "nanotrack_backbone.onnx",
            },
            {
                "url": "https://raw.githubusercontent.com/HonglinChu/SiamTrackers/master/NanoTrack/models/nanotrackv2/nanotrack_head_sim.onnx",
                "file": "nanotrack_head.onnx",
            },
        ],
    },
    {
        "id": "inpaint-fast",
        "name": "Magic Remove Fast — LaMa",
        "vendor": "SAIC-AI / LaMa",
        "category": "ลบวัตถุออกจากวิดีโอ (Magic Remove)",
        "desc": "ลบอะไรก็ได้ออกจากวิดีโอ — คน รถ เสาไฟ อาวุธ หนวด ฝ้า แล้ว AI เติมพื้นหลังแทน ไม่ให้โหว่ (CPU)",
        "overview": (
            "ลบสิ่งที่ไม่ต้องการออกจากภาพด้วย LaMa (Large Mask Inpainting) "
            "โดย AI จะวาดพื้นหลังอุดแทนที่พื้นที่ในกรอบที่เลือกไว้ ทำทีละเฟรม\n\n"
            "• รันได้ทุกเครื่อง ไม่ต้องมีการ์ดจอแรง (CPU หรือ DirectML)\n"
            "• เหมาะกับ: โลโก้/ลายน้ำตำแหน่งคงที่ วัตถุเล็กๆ บนพื้นหลังเรียบ\n"
            "• จุดอ่อน: ทำทีละเฟรมอิสระ — พื้นหลังซับซ้อนอาจมีอาการวิบวับเล็กน้อย "
            "งานแบบนั้นให้ใช้ Quality Engine ที่อ่านหลายเฟรมพร้อมกัน\n"
            "• ใช้กับงานของตัวเอง/งานที่ได้รับสิทธิ์เท่านั้น"
        ),
        "size_mb": 450,
        "requires_nvidia": False,
        "min_vram_mb": 0,
        "pip": ["onnxruntime-directml", "numpy", "opencv-python-headless"],
        "models": [
            {
                "url": "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx",
                "file": "lama_fp32.onnx",
            }
        ],
    },
    {
        "id": "inpaint-quality",
        "name": "Magic Remove Quality — ProPainter",
        "vendor": "S-Lab / ProPainter",
        "category": "ลบวัตถุออกจากวิดีโอ (Magic Remove)",
        "desc": "ลบวัตถุระดับวิดีโอแท้ ดึงภาพจริงจากเฟรมข้างเคียงมาอุดก่อนค่อยให้ AI วาด — ต้อง NVIDIA ≥ 8GB",
        "overview": (
            "ลบวัตถุคุณภาพสูงสุดด้วย ProPainter — video inpainting ตัวจริงที่ใช้ optical flow "
            "ตามรอยการเคลื่อนไหว แล้วดึง 'ภาพจริง' ของฉากหลังจากเฟรมอื่นมาอุดก่อน "
            "เหลือช่องว่างจริงๆ ค่อยให้ AI วาดเพิ่ม ผลลัพธ์เนียนต่อเนื่องไม่วิบวับ\n\n"
            "• เหมาะกับ: คนเดินผ่าน ไมค์บูม วัตถุเคลื่อนไหว บนฉากที่กล้องขยับ\n"
            "• ต้องการการ์ด NVIDIA VRAM อย่างน้อย 8GB (CUDA)\n"
            "• ดาวน์โหลดใหญ่ (~4GB ส่วนใหญ่คือ PyTorch)\n"
            "• ช้า: เป็นงาน render เบื้องหลัง — แนะนำใช้กับช่วงสั้นๆ ที่เลือกไว้\n"
            "• ใช้กับงานของตัวเอง/งานที่ได้รับสิทธิ์เท่านั้น"
        ),
        "size_mb": 4000,
        "requires_nvidia": True,
        "min_vram_mb": 8192,
        # ต้องพิน +cu121 เพราะใช้ --extra-index-url (deps ตัวอื่นมาจาก PyPI ปกติ)
        "pip": [
            "torch==2.3.1+cu121",
            "torchvision==0.18.1+cu121",
            "einops",
            "numpy",
            "opencv-python-headless",
            "scipy",
            "imageio-ffmpeg",
            "pyyaml",
            "av",
            "addict",
            "future",
            "--extra-index-url",
            "https://download.pytorch.org/whl/cu121",
        ],
        # ซอร์สโค้ด ProPainter ทั้ง repo — inference script + โครงข่ายอยู่ในนี้ (weights แยกโหลดด้านล่าง)
        "archives": [
            {
                "url": "https://github.com/sczhou/ProPainter/archive/refs/heads/main.zip",
                "file": "propainter_src.zip",
            }
        ],
        "models": [
            {
                "url": "https://github.com/sczhou/ProPainter/releases/download/v0.1.0/ProPainter.pth",
                "file": "propainter.pth",
            },
            {
                "url": "https://github.com/sczhou/ProPainter/releases/download/v0.1.0/recurrent_flow_completion.pth",
                "file": "recurrent_flow_completion.pth",
            },
            {
                "url": "https://github.com/sczhou/ProPainter/releases/download/v0.1.0/raft-things.pth",
                "file": "raft-things.pth",
            },
        ],
    },
{
    "id": "musetalk",
    "name": "Lip Sync — MuseTalk",
    "vendor": "Tencent ARC",
    "category": "Lip Sync ขยับปากตามเสียง",
    "desc": "สร้างวิดีโอขยับปากตามเสียง คุณภาพสูง",
    "overview": (
        "MuseTalk เป็นโมเดล Lip Sync แบบเรียลไทม์ "
        "สำหรับสร้างวิดีโอที่ขยับปากตรงกับเสียงพูด\n\n"
        "• รองรับรูปภาพและวิดีโอ\n"
        "• คุณภาพสูง\n"
        "• ใช้ GPU NVIDIA เพื่อประสิทธิภาพที่ดีที่สุด\n"
        "• ดาวน์โหลดโมเดลหลังติดตั้ง"
    ),
    "size_mb": 3500,
    "requires_nvidia": True,
    "min_vram_mb": 6000,
    "git": "https://github.com/TMElyralab/MuseTalk",
    "pip": [],
    "models": []
},
{
    "id": "hallo",
    "name": "Lip Sync — Hallo",
    "vendor": "Hallo Project",
    "category": "Lip Sync ขยับปากตามเสียง",
    "desc": "สร้างวิดีโอพูดจากรูปภาพและเสียง",
    "overview": (
        "Hallo เป็นโมเดลสร้างวิดีโอพูดจากภาพนิ่ง "
        "รองรับการเคลื่อนไหวใบหน้าและปากอย่างเป็นธรรมชาติ\n\n"
        "• Image to Talking Video\n"
        "• ใช้ GPU NVIDIA\n"
        "• ดาวน์โหลดโมเดลภายหลัง"
    ),
    "size_mb": 5000,
    "requires_nvidia": True,
    "min_vram_mb": 8000,
    "git": "https://github.com/fudan-generative-vision/hallo",
    "pip": [],
    "models": []
},
{
    "id": "wav2lip",
    "name": "Lip Sync — Wav2Lip",
    "vendor": "Wav2Lip",
    "category": "Lip Sync ขยับปากตามเสียง",
    "desc": "ซิงก์ริมฝีปากให้ตรงกับเสียงพูด",
    "overview": (
        "Wav2Lip เป็นโมเดลยอดนิยมสำหรับทำ Lip Sync "
        "รองรับทั้งรูปภาพและวิดีโอ\n\n"
        "• ใช้งานแพร่หลาย\n"
        "• รองรับ CPU และ GPU\n"
        "• ดาวน์โหลดโมเดลหลังติดตั้ง"
    ),
    "size_mb": 500,
    "requires_nvidia": False,
    "min_vram_mb": 0,
    "git": "https://github.com/Rudrabha/Wav2Lip",
    "pip": [],
    "models": []
},{
    "id": "rvc",
    "name": "แปลงเสียง — RVC",
    "vendor": "RVC Project",
    "category": "Voice Cloning แปลงเสียงพูดหรือโคลนเสียง",
    "desc": "แปลงเสียงพูดหรือร้องเป็นเสียงจากโมเดลที่เลือก",
    "overview": (
        "RVC (Retrieval-based Voice Conversion) ใช้แปลงเสียงต้นฉบับเป็นเสียงของโมเดล "
        "ที่ผู้ใช้เลือก เหมาะสำหรับงานพากย์และดัดแปลงเสียง\n\n"
        "• รองรับเสียงพูดและเสียงร้อง\n"
        "• ใช้ GPU จะเร็วกว่า CPU มาก\n"
        "• ต้องดาวน์โหลด Voice Model เพิ่ม\n"
        "• หมายเหตุ: ตัวเรียกใช้ในแอปจะเปิดในรุ่นถัดไป — ติดตั้งเตรียมไว้ได้"
    ),
    "size_mb": 1200,
    "requires_nvidia": True,
    "min_vram_mb": 4000,
    "pip": [],
    "git": "https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI",
    "models": []
},
{
    "id": "openvoice",
    "name": "โคลนเสียง — OpenVoice",
    "vendor": "MyShell",
    "category": "Voice Cloning แปลงเสียงพูดหรือโคลนเสียง",
    "desc": "โคลนเสียงพร้อมปรับสำเนียงและอารมณ์การพูด",
    "overview": (
        "OpenVoice เป็นโมเดลสำหรับโคลนเสียงและปรับลักษณะการพูด "
        "ใช้ตัวอย่างเสียงสั้นเพื่อสร้างเสียงใหม่\n\n"
        "• รองรับหลายภาษา\n"
        "• ปรับสไตล์และสำเนียงได้\n"
        "• ใช้ GPU เพื่อประสิทธิภาพที่ดีที่สุด\n"
        "• หมายเหตุ: ตัวเรียกใช้ในแอปจะเปิดในรุ่นถัดไป — ติดตั้งเตรียมไว้ได้"
    ),
    "size_mb": 1800,
    "requires_nvidia": True,
    "min_vram_mb": 6000,
    "pip": [],
    "git": "https://github.com/myshell-ai/OpenVoice",
    "models": []
},
{
    "id": "gpt-sovits",
    "name": "โคลนเสียง — GPT-SoVITS",
    "vendor": "GPT-SoVITS Project",
    "category": "Voice Cloning แปลงเสียงพูดหรือโคลนเสียง",
    "desc": "โคลนเสียงคุณภาพสูงจากตัวอย่างเสียงสั้น",
    "overview": (
        "GPT-SoVITS เป็นโมเดลโคลนเสียงคุณภาพสูง "
        "ใช้ตัวอย่างเสียงเพียงไม่กี่วินาทีในการสร้างเสียงใหม่\n\n"
        "• คุณภาพเสียงสูง\n"
        "• รองรับหลายภาษา\n"
        "• ใช้ GPU NVIDIA เพื่อประสิทธิภาพที่ดีที่สุด\n"
        "• ต้องดาวน์โหลดโมเดลเพิ่มเติมหลังติดตั้ง\n"
        "• หมายเหตุ: ตัวเรียกใช้ในแอปจะเปิดในรุ่นถัดไป — ติดตั้งเตรียมไว้ได้"
    ),
    "size_mb": 3500,
    "requires_nvidia": True,
    "min_vram_mb": 8000,
    "pip": [],
    "git": "https://github.com/RVC-Boss/GPT-SoVITS",
    "models": []
},

    
]


def _engine(engine_id: str) -> dict:
    for e in REGISTRY:
        if e["id"] == engine_id:
            return e
    raise ValueError(f"ไม่รู้จัก engine: {engine_id}")


def _engine_dir(engine_id: str) -> Path:
    return ENGINES_DIR / engine_id


def is_installed(engine_id: str) -> bool:
    return (_engine_dir(engine_id) / "installed.json").exists()


# ---------- ตรวจสเปคเครื่อง ----------

def detect_specs() -> dict:
    gpu, vram_mb = None, 0
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
        if out.returncode == 0 and out.stdout.strip():
            name, mem = out.stdout.strip().splitlines()[0].rsplit(",", 1)
            gpu, vram_mb = name.strip(), int(mem.strip())
    except Exception:
        pass  # ไม่มี nvidia-smi = ไม่มีการ์ด NVIDIA

    ram_mb = 0
    try:
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        m = MEMORYSTATUSEX()
        m.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
        ram_mb = m.ullTotalPhys // (1024 * 1024)
    except Exception:
        pass

    ENGINES_DIR.mkdir(parents=True, exist_ok=True)
    disk_free_mb = shutil.disk_usage(ENGINES_DIR).free // (1024 * 1024)
    return {"gpu": gpu, "vram_mb": vram_mb, "ram_mb": ram_mb, "disk_free_mb": disk_free_mb}


def overview() -> dict:
    """สเปคเครื่อง + รายการ engine พร้อมสถานะว่าลงได้/แนะนำ/ติดตั้งแล้ว"""
    specs = detect_specs()
    engines = []
    for e in REGISTRY:
        supported, reason = True, ""
        if e["requires_nvidia"] and not specs["gpu"]:
            supported, reason = False, "ต้องมีการ์ดจอ NVIDIA"
        elif specs["vram_mb"] < e["min_vram_mb"]:
            supported, reason = False, f"VRAM ไม่พอ (ต้องการ ≥ {e['min_vram_mb'] // 1024}GB)"
        elif specs["disk_free_mb"] < e["size_mb"] * 2:
            supported, reason = False, "พื้นที่ดิสก์ไม่พอ"
        engines.append(
            {
                "id": e["id"],
                "name": e["name"],
                "vendor": e.get("vendor", ""),
                "icon": e.get("icon"),  # ใส่เฉพาะ engine ที่มีโลโก้ทางการจริง (ไม่ใช้รูป avatar บุคคล)
                "category": e.get("category", "อื่นๆ"),
                "desc": e["desc"],
                "overview": e.get("overview", e["desc"]),
                "size_mb": e["size_mb"],
                "installed": is_installed(e["id"]),
                "supported": supported,
                "reason": reason,
            }
        )
    # แนะนำตัวที่ดีสุดที่เครื่องรับไหว (quality ก่อน ไม่ไหวค่อย fast)
    for e in reversed(engines):
        if e["supported"]:
            e["recommended"] = True
            break
    return {"specs": specs, "engines": engines, "install_dir": str(ENGINES_DIR)}


# ---------- ติดตั้ง / ถอน ----------

class InstallCancelled(Exception):
    """ผู้ใช้กดยกเลิกการติดตั้ง"""


def _download(url: str, dest: Path, progress, cancelled=lambda: False):
    """ดาวน์โหลดไฟล์พร้อมรายงาน progress เป็น MB (ผ่าน .part กันไฟล์ครึ่งๆ กลางๆ)"""
    tmp = dest.with_suffix(dest.suffix + ".part")

    def hook(blocks, block_size, total_size):
        if cancelled():
            raise InstallCancelled()
        done_mb = blocks * block_size / 1e6
        total_mb = max(total_size, 1) / 1e6
        progress(phase=f"ดาวน์โหลดโมเดล {dest.name}", done_mb=round(done_mb, 1), total_mb=round(total_mb, 1))

    try:
        urllib.request.urlretrieve(url, tmp, reporthook=hook)
    except InstallCancelled:
        tmp.unlink(missing_ok=True)
        raise
    tmp.replace(dest)


def install(engine_id: str, progress, cancelled=lambda: False):
    """ติดตั้ง engine: สร้าง venv → pip install → โหลดโมเดล → เขียน installed.json
    progress(**kwargs) ถูกเรียกเป็นระยะเพื่ออัปเดต job / cancelled() คืน True = ผู้ใช้กดยกเลิก"""
    e = _engine(engine_id)
    root = _engine_dir(engine_id)
    venv_dir = root / "venv"
    models_dir = root / "models"
    root.mkdir(parents=True, exist_ok=True)
    models_dir.mkdir(exist_ok=True)

    venv_py = venv_dir / "Scripts" / "python.exe"
    # engine แบบแอป (มี requirements ในซอร์ส) ก็ต้องสร้าง venv แม้ไม่มี pip list ตรงๆ
    if e["pip"] or e.get("requirements"):
        progress(phase="สร้าง Python environment…")
        subprocess.run([sys.executable, "-m", "venv", str(venv_dir)], check=True, capture_output=True)

    if e["pip"]:
        progress(phase="ติดตั้งแพ็กเกจ (ก้อนใหญ่อาจใช้เวลาหลายนาที)…")
        proc = subprocess.Popen(
            [str(venv_py), "-m", "pip", "install", "--no-input", *e["pip"]],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        for line in proc.stdout:
            if cancelled():
                proc.kill()
                raise InstallCancelled()
            line = line.strip()
            if line.startswith(("Collecting", "Downloading", "Installing")):
                progress(phase=line[:90])
        if proc.wait() != 0:
            raise RuntimeError("pip install ล้มเหลว — เช็คอินเทอร์เน็ตแล้วลองใหม่")

    # engine แบบโปรแกรม portable: โหลด zip แล้วแตกลง bin/
    for a in e.get("archives", []):
        import zipfile

        zip_path = root / a["file"]
        _download(a["url"], zip_path, progress, cancelled)
        progress(phase=f"แตกไฟล์ {a['file']}…")
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(root / "bin")
        zip_path.unlink(missing_ok=True)

    # engine แบบแอป: ติดตั้ง requirements.txt ที่อยู่ในซอร์สที่เพิ่งแตก (หลัง extract)
    req = e.get("requirements")
    if req:
        req_path = root / "bin" / req
        if not req_path.exists():
            raise RuntimeError(f"ไม่พบ requirements: {req_path}")
        progress(phase="ติดตั้งแพ็กเกจของแอป (หลายนาที)…")
        proc = subprocess.Popen(
            [str(venv_py), "-m", "pip", "install", "--no-input", "-r", str(req_path)],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        for line in proc.stdout:
            if cancelled():
                proc.kill()
                raise InstallCancelled()
            line = line.strip()
            if line.startswith(("Collecting", "Downloading", "Installing", "Building")):
                progress(phase=line[:90])
        if proc.wait() != 0:
            raise RuntimeError("ติดตั้ง requirements ล้มเหลว — เช็คอินเทอร์เน็ตแล้วลองใหม่")

    for m in e["models"]:
        _download(m["url"], models_dir / m["file"], progress, cancelled)

    # engine แบบ repo ทั้งก้อนจาก Hugging Face (โมเดลใหญ่หลายสิบไฟล์ เช่นตัวสร้างวิดีโอ)
    # ใช้ hf CLI ใน venv ของ engine — โหลดต่อจากที่ค้างได้เอง (resume) ถ้าเน็ตหลุด
    for hr in e.get("hf_repos", []):
        cli = venv_dir / "Scripts" / "hf.exe"
        if not cli.exists():
            cli = venv_dir / "Scripts" / "huggingface-cli.exe"  # ชื่อเก่าของ CLI เดียวกัน
        dest = models_dir / hr["dir"]
        progress(phase=f"ดาวน์โหลด {hr['repo']} (ก้อนใหญ่มาก อาจใช้เวลานานหลายสิบนาที)")
        proc = subprocess.Popen(
            [str(cli), "download", hr["repo"], "--local-dir", str(dest)],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        for line in proc.stdout:
            if cancelled():
                _kill_tree(proc)
                raise InstallCancelled()
            line = line.strip()
            if line and len(line) < 120:
                progress(phase=f"{hr['repo']}: {line[:90]}")
        if proc.wait() != 0:
            raise RuntimeError(f"ดาวน์โหลด {hr['repo']} ล้มเหลว — เช็คอินเทอร์เน็ตแล้วกดติดตั้งใหม่")

    (root / "installed.json").write_text(
        json.dumps({"id": engine_id, "pip": e["pip"]}, ensure_ascii=False), encoding="utf-8"
    )
    progress(phase="ติดตั้งเสร็จ", done_mb=0, total_mb=0)


def run_remove_bg(
    video_path: str, progress, engine_id: str = "fast",
    start: float = 0.0, duration: float | None = None,
    cancelled=None,
) -> str:
    """ตัดฉากหลังด้วย engine ที่เลือก — spawn worker ใน venv ของ engine นั้น
    progress(done, total) ถูกเรียกเป็นระยะ คืน path ไฟล์ WebM (มี alpha)"""
    # engine ที่มี worker แล้ว: ชื่อไฟล์ worker + ชื่อไฟล์โมเดล (ตัวอื่นในทะเบียนติดตั้งได้แต่ยังรันไม่ได้)
    BG_WORKERS = {
        "fast": ("rvm_worker.py", "rvm_mobilenetv3_fp32.onnx"),
        "isnet": ("isnet_worker.py", "isnet-general-use.onnx"),
    }
    if not is_installed(engine_id):
        raise RuntimeError(f"ยังไม่ได้ติดตั้ง engine '{engine_id}' (เปิดตั้งค่า ⚙ → AI Engines)")
    if engine_id not in BG_WORKERS:
        # worker ของ engine อื่นยังไม่ได้เขียน (quality/sam2 ต้องเทสบนเครื่องมี GPU แรง)
        raise RuntimeError(f"engine '{engine_id}' ยังไม่รองรับการลบพื้นหลังในเวอร์ชันนี้")
    worker_file, model_file = BG_WORKERS[engine_id]
    root = _engine_dir(engine_id)
    venv_py = root / "venv" / "Scripts" / "python.exe"
    model = root / "models" / model_file
    worker = Path(__file__).resolve().parent / "workers" / worker_file

    out_dir = Path("./_work").resolve()
    out_dir.mkdir(exist_ok=True)
    # ชื่อไฟล์ระบุช่วงเวลา — ก้อนคนละท่อนของไฟล์เดิมไม่ทับกัน
    suffix = f"_{int(start * 1000)}_{int((duration or 0) * 1000)}" if duration else ""
    dst = out_dir / f"{Path(video_path).stem}_nobg{suffix}.webm"

    proc = subprocess.Popen(
        [str(venv_py), str(worker), video_path, str(dst), str(model),
         f"{start:.3f}", f"{duration:.3f}" if duration else "0"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    _watch_cancel(proc, cancelled)  # ฆ่า worker ภายใน ~0.3 วิหลังสั่งยกเลิก
    out_path = None
    for line in proc.stdout:
        if cancelled and cancelled():
            break  # watcher ฆ่า proc ให้แล้ว — ออกจาก loop เลย
        parts = line.strip().split()
        if not parts:
            continue
        if parts[0] == "PROG" and len(parts) == 3:
            progress(int(parts[1]), int(parts[2]))
        elif parts[0] == "OUT":
            out_path = line.strip()[4:]
    proc.wait()
    if cancelled and cancelled():
        raise JobCancelled()
    if proc.returncode != 0 or not out_path:
        err = proc.stderr.read()[-800:] if proc.stderr else ""
        raise RuntimeError(f"ตัดฉากหลังไม่สำเร็จ: {err or 'worker ล้มเหลว'}")
    return out_path


def run_upscale(
    video_path: str, progress, engine_id: str = "esrgan",
    start: float = 0.0, duration: float | None = None,
    cancelled=None,
) -> str:
    """อัปสเกลวิดีโอด้วย Real-ESRGAN (.exe portable ใช้ Vulkan)
    ขั้นตอน: แตกเฟรม → อัปสเกลทีละเฟรม → ประกอบกลับพร้อมเสียงเดิม"""
    if not is_installed(engine_id):
        raise RuntimeError(f"ยังไม่ได้ติดตั้ง engine '{engine_id}' (เปิดตั้งค่า ⚙ → AI Engines)")
    if engine_id != "esrgan":
        raise RuntimeError(f"engine '{engine_id}' ยังไม่รองรับการอัปสเกลในเวอร์ชันนี้")

    from core import video_utils

    exe = next((_engine_dir("esrgan") / "bin").rglob("realesrgan-ncnn-vulkan.exe"), None)
    if not exe:
        raise RuntimeError("ไม่พบตัวโปรแกรมใน engine — ลองถอนแล้วติดตั้งใหม่")

    import time

    stem = Path(video_path).stem
    suffix = f"_{int(start * 1000)}_{int((duration or 0) * 1000)}" if duration else ""
    work = Path("./_work").resolve()
    work.mkdir(exist_ok=True)
    in_dir = work / f"{stem}_up_in{suffix}"
    out_frames = work / f"{stem}_up_out{suffix}"
    for d in (in_dir, out_frames):
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir()

    total = video_utils.extract_frames(
        video_path, str(in_dir), start=start, duration=duration, cancelled=cancelled
    )
    progress(0, total)

    # โมเดล animevideo v3 ×2 — ตัวที่ออกแบบมาเพื่อวิดีโอ เร็วสุดในตระกูล
    # stderr ต้องลงไฟล์ ห้ามใช้ PIPE — realesrgan พ่น progress ทุกเฟรม ถ้าไม่มีใครอ่าน buffer เต็มแล้วค้าง
    err_log = work / f"{stem}_up{suffix}.log"
    with open(err_log, "w", encoding="utf-8", errors="replace") as errf:
        proc = subprocess.Popen(
            [str(exe), "-i", str(in_dir), "-o", str(out_frames),
             "-n", "realesr-animevideov3", "-s", "2", "-f", "png"],
            stdout=subprocess.DEVNULL, stderr=errf,
        )
        while proc.poll() is None:
            if cancelled and cancelled():
                _kill_tree(proc)
                proc.wait()
                shutil.rmtree(in_dir, ignore_errors=True)
                shutil.rmtree(out_frames, ignore_errors=True)
                raise JobCancelled()
            time.sleep(0.7)
            progress(len(list(out_frames.glob("*.png"))), total)
    if proc.returncode != 0:
        tail = err_log.read_text(encoding="utf-8", errors="replace")[-500:]
        raise RuntimeError(f"อัปสเกลไม่สำเร็จ: {tail}")
    err_log.unlink(missing_ok=True)
    progress(total, total)

    # ประกอบกลับ + เสียงช่วงเดียวกันจากไฟล์เดิม
    fps = video_utils.get_video_fps(video_path)
    dst = work / f"{stem}_up{suffix}.mp4"
    trim = (["-ss", f"{start:.3f}"] if start > 0 else []) + (
        ["-t", f"{duration:.3f}"] if duration else []
    )
    subprocess.run(
        [video_utils.FFMPEG, "-y",
         "-framerate", f"{fps:.4f}", "-i", str(out_frames / "frame_%06d.png"),
         *trim, "-i", video_path,
         "-map", "0:v", "-map", "1:a:0?",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast",
         "-c:a", "aac", "-shortest", str(dst)],
        check=True, capture_output=True,
    )
    shutil.rmtree(in_dir, ignore_errors=True)
    shutil.rmtree(out_frames, ignore_errors=True)
    return str(dst)


def run_transcribe(
    video_path: str, progress, engine_id: str = "whisper-small",
    language: str = "auto", start: float = 0.0, duration: float | None = None,
    cancelled=None,
) -> list[dict]:
    """ถอดเสียงพูดในก้อนที่เลือกเป็นซับไตเติล — spawn worker ใน venv ของ engine whisper-*
    progress(done_ms, total_ms) ถูกเรียกเป็นระยะ (หน่วยมิลลิวินาที)
    คืน list ของ {"start","end","text"} — เวลานับจากต้นก้อน (0 = จุดเริ่มของก้อน)"""
    import json as _json

    if not is_installed(engine_id):
        raise RuntimeError(f"ยังไม่ได้ติดตั้ง engine '{engine_id}' (เปิดตั้งค่า ⚙ → AI Engines)")
    # โมเดลถูกโหลดลง models/<dir> ตอนติดตั้ง (dir ตรงกับ engine_id ในทะเบียน)
    model_dirs = {
        "whisper-small": "whisper-small",
        "whisper-medium": "whisper-medium",
        "whisper-large": "whisper-large-v3",
    }
    if engine_id not in model_dirs:
        raise RuntimeError(f"engine '{engine_id}' ยังไม่รองรับการถอดเสียงในเวอร์ชันนี้")
    root = _engine_dir(engine_id)
    venv_py = root / "venv" / "Scripts" / "python.exe"
    model_dir = root / "models" / model_dirs[engine_id]
    if not model_dir.exists():
        raise RuntimeError("ไม่พบไฟล์โมเดล — ลองถอนแล้วติดตั้ง engine ใหม่")
    worker = Path(__file__).resolve().parent / "workers" / "whisper_worker.py"

    from core import video_utils

    # ตัดเฉพาะช่วงของก้อน → WAV 16kHz mono (รูปแบบที่ Whisper ต้องการ)
    work = Path("./_work").resolve()
    work.mkdir(exist_ok=True)
    suffix = f"_{int(start * 1000)}_{int((duration or 0) * 1000)}"
    wav = work / f"{Path(video_path).stem}_stt{suffix}.wav"
    trim = (["-ss", f"{start:.3f}"] if start > 0 else []) + (
        ["-t", f"{duration:.3f}"] if duration else []
    )
    subprocess.run(
        [video_utils.FFMPEG, "-y", *trim, "-i", video_path,
         "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", str(wav)],
        check=True, capture_output=True,
    )

    # บังคับ UTF-8 ทั้งฝั่ง worker (env) และฝั่งอ่าน (encoding) — กันข้อความไทยเพี้ยนบน Windows
    stt_env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
    proc = subprocess.Popen(
        [str(venv_py), str(worker), str(wav), str(model_dir), language or "auto"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        encoding="utf-8", errors="replace", env=stt_env,
    )
    _watch_cancel(proc, cancelled)
    segments: list[dict] = []
    for line in proc.stdout:
        if cancelled and cancelled():
            break
        line = line.rstrip("\n")
        if line.startswith("PROG "):
            parts = line.split()
            if len(parts) == 3:
                progress(int(parts[1]), int(parts[2]))
        elif line.startswith("SEG "):
            try:
                segments.append(_json.loads(line[4:]))
            except Exception:
                pass
    proc.wait()
    wav.unlink(missing_ok=True)
    if cancelled and cancelled():
        raise JobCancelled()
    if proc.returncode != 0:
        err = proc.stderr.read()[-800:] if proc.stderr else ""
        raise RuntimeError(f"ถอดเสียงไม่สำเร็จ: {err or 'worker ล้มเหลว'}")
    return segments


def run_face_censor(
    video_path: str, progress, engine_id: str = "face-censor",
    style: str = "blur", strength: int = 12,
    start: float = 0.0, duration: float | None = None,
    keep: dict | None = None, cancelled=None,
) -> str:
    """ตรวจจับใบหน้าอัตโนมัติแล้วเบลอ/โมเสกตามทุกเฟรม — spawn worker ใน venv ของ engine
    keep = {"faces": [{t,x,y,w,h}], "invert": bool} เลือกคนหลักไว้ไม่เบลอ (หรือ invert = เบลอเฉพาะคนที่เลือก)
    progress(done, total) ถูกเรียกเป็นระยะ คืน path ไฟล์ mp4 ใหม่ใน _work/"""
    import json as _json

    if not is_installed(engine_id):
        raise RuntimeError(f"ยังไม่ได้ติดตั้ง engine '{engine_id}' (เปิดตั้งค่า ⚙ → AI Engines)")
    root = _engine_dir(engine_id)
    venv_py = root / "venv" / "Scripts" / "python.exe"
    # เลือกไฟล์โมเดลตาม engine (worker เลือกตัวตรวจตามชื่อไฟล์เอง)
    model_files = {
        "face-censor": "yunet.onnx",
        "face-censor-pro": "scrfd_10g_bnkps.onnx",
        "censor-plate": "plate_yolo.onnx",
        "censor-text": "ppocr_det.onnx",
    }
    model = root / "models" / model_files.get(engine_id, "yunet.onnx")
    sface = root / "models" / "sface.onnx"
    worker = Path(__file__).resolve().parent / "workers" / "face_censor_worker.py"

    keep_faces = (keep or {}).get("faces") if keep else None
    if keep_faces and not sface.exists():
        raise RuntimeError("โหมดเลือกคนต้องใช้โมเดลจดจำใบหน้า — ถอนแล้วติดตั้ง engine เซ็นเซอร์ใบหน้าใหม่")
    keep_arg = _json.dumps(keep) if keep_faces else "0"

    out_dir = Path("./_work").resolve()
    out_dir.mkdir(exist_ok=True)
    suffix = f"_{int(start * 1000)}_{int((duration or 0) * 1000)}" if duration else ""
    dst = out_dir / f"{Path(video_path).stem}_facecensor{suffix}.mp4"

    proc = subprocess.Popen(
        [str(venv_py), str(worker), video_path, str(dst), str(model),
         style, str(int(strength)),
         f"{start:.3f}", f"{duration:.3f}" if duration else "0",
         keep_arg, str(sface)],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    out_path = None
    for line in proc.stdout:
        if cancelled and cancelled():
            proc.kill()
            proc.wait()
            raise JobCancelled()
        parts = line.strip().split()
        if not parts:
            continue
        if parts[0] == "PROG" and len(parts) == 3:
            progress(int(parts[1]), int(parts[2]))
        elif parts[0] == "OUT":
            out_path = line.strip()[4:]
    if proc.wait() != 0 or not out_path:
        err = proc.stderr.read()[-800:] if proc.stderr else ""
        raise RuntimeError(f"เซ็นเซอร์ใบหน้าไม่สำเร็จ: {err or 'worker ล้มเหลว'}")
    return out_path


def run_face_swap(
    video_path: str, progress, face_image: str = None,
    engine_id: str = "face-swap-local", enhance: bool = True,
    start: float = 0.0, duration: float | None = None,
    maps: list | None = None, cancelled=None,
) -> str:
    """สลับหน้าคนในวิดีโอ (inswapper + GFPGAN) — คืน path mp4 ใหม่ใน _work/
    maps = [{"source": path, "ref": {t,x,y,w,h}|None}] รองรับหลายหน้า/หลายคน
    ref=None → หน้านั้นใช้กับ 'ทุกคนที่ไม่ตรงใครเลย' (catch-all); ระบุ ref → เจาะจงคนนั้น
    (ยังรับ face_image เดี่ยวได้ เพื่อความเข้ากันได้ย้อนหลัง)"""
    import json as _json
    import tempfile

    if not is_installed(engine_id):
        raise RuntimeError(f"ยังไม่ได้ติดตั้ง engine '{engine_id}' (เปิดตั้งค่า ⚙ → AI Engines)")
    root = _engine_dir(engine_id)
    venv_py = root / "venv" / "Scripts" / "python.exe"
    worker = Path(__file__).resolve().parent / "workers" / "face_swap_worker.py"

    if not maps:
        maps = [{"source": face_image, "ref": None}]

    out_dir = Path("./_work").resolve()
    out_dir.mkdir(exist_ok=True)
    suffix = f"_{int(start * 1000)}_{int((duration or 0) * 1000)}" if duration else ""
    dst = out_dir / f"{Path(video_path).stem}_swap{suffix}.mp4"

    # ---- FaceFusion: เรียกโปรแกรมตัวเต็มผ่าน CLI (masking เนียนกว่า worker เรา) ----
    if engine_id == "face-swap-facefusion":
        return _run_facefusion(
            root, video_path, str(dst), maps[0]["source"], enhance,
            start, duration, progress, cancelled,
        )
    # เขียน maps ลงไฟล์ชั่วคราว — เลี่ยงปัญหา path ภาษาไทย/ช่องว่างบน command line
    maps_json = out_dir / f"_swapmaps_{Path(video_path).stem}.json"
    maps_json.write_text(_json.dumps(maps, ensure_ascii=False), encoding="utf-8")

    proc = subprocess.Popen(
        [str(venv_py), str(worker), video_path, str(dst), str(root / "models"),
         str(maps_json), "1" if enhance else "0",
         f"{start:.3f}", f"{duration:.3f}" if duration else "0"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    _watch_cancel(proc, cancelled)
    out_path = None
    for line in proc.stdout:
        if cancelled and cancelled():
            break
        parts = line.strip().split()
        if not parts:
            continue
        if parts[0] == "PROG" and len(parts) == 3:
            progress(int(parts[1]), int(parts[2]))
        elif parts[0] == "OUT":
            out_path = line.strip()[4:]
    proc.wait()
    if cancelled and cancelled():
        raise JobCancelled()
    if proc.returncode != 0 or not out_path:
        err = proc.stderr.read()[-800:] if proc.stderr else ""
        raise RuntimeError(f"สลับหน้าไม่สำเร็จ: {err or 'worker ล้มเหลว'}")
    return out_path


def _run_facefusion(root, video_path, dst, source_img, enhance, start, duration, progress, cancelled):
    """สลับหน้าด้วย FaceFusion CLI — ตัดช่วงของก้อนออกมาก่อน แล้วรัน headless-run"""
    import re

    from core import video_utils

    app_dir = root / "bin" / "facefusion-3.7.1"
    venv_py = root / "venv" / "Scripts" / "python.exe"
    if not (app_dir / "facefusion.py").exists():
        raise RuntimeError("ไม่พบ FaceFusion — ถอนแล้วติดตั้งใหม่")

    work = Path("./_work").resolve()
    # ตัดเฉพาะช่วงของก้อน (FaceFusion ประมวลทั้งไฟล์) — คงเสียงไว้
    seg = work / f"_ff_seg_{Path(video_path).stem}.mp4"
    trim = (["-ss", f"{start:.3f}"] if start > 0 else []) + (
        ["-t", f"{duration:.3f}"] if duration else []
    )
    subprocess.run(
        [video_utils.FFMPEG, "-y", *trim, "-i", video_path,
         "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-c:a", "aac", str(seg)],
        check=True, capture_output=True,
    )
    try:
        fps = video_utils.get_video_fps(video_path)
        total = int((duration or video_utils.get_total_frames(video_path) / max(fps, 1)) * fps) or 1
    except Exception:
        total = 1

    processors = ["face_swapper"] + (["face_enhancer"] if enhance else [])
    cmd = [
        str(venv_py), "facefusion.py", "headless-run",
        "-s", source_img, "-t", str(seg), "-o", dst,
        "--processors", *processors,
        "--execution-providers", "cpu",
        "--face-selector-mode", "many",  # สลับทุกหน้าในเฟรม
    ]
    proc = subprocess.Popen(
        cmd, cwd=str(app_dir), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    _watch_cancel(proc, cancelled)
    for line in proc.stdout:
        if cancelled and cancelled():
            break
        # tqdm ของ FaceFusion พิมพ์ "..:  42%|..." — แปลงเป็น done/total
        m = re.search(r"(\d+)%\|", line)
        if m:
            progress(int(int(m.group(1)) / 100 * total), total)
        elif "download" in line.lower() or "Downloading" in line:
            progress(0, 0)  # โหลดโมเดลครั้งแรก
    proc.wait()
    seg.unlink(missing_ok=True)
    if cancelled and cancelled():
        raise JobCancelled()
    if proc.returncode != 0 or not Path(dst).exists():
        raise RuntimeError("FaceFusion สลับหน้าไม่สำเร็จ — เช็คว่ารูปหน้าชัดและมีอินเทอร์เน็ต (โหลดโมเดลครั้งแรก)")
    progress(total, total)
    return str(dst)


def run_track(
    video_path: str, progress, engine_id: str, rect: dict,
    style: str = "box", color: str = "#ffd60a",
    start: float = 0.0, duration: float | None = None,
    cancelled=None,
) -> str:
    """ตามวัตถุที่ตีกรอบไว้ แล้ววาดสัญลักษณ์ชี้เป้า (วงกลม/ลูกศร/กรอบ) วิ่งตามทุกเฟรม
    rect = {x,y,w,h} สัดส่วน 0–1 ของเฟรม ณ เฟรมแรกของช่วง — คืน path ไฟล์ mp4 ใหม่ใน _work/"""
    import json as _json

    TRACKERS = {"track-csrt": "csrt", "track-vit": "vit", "track-nano": "nano"}
    if not is_installed(engine_id):
        raise RuntimeError(f"ยังไม่ได้ติดตั้ง engine '{engine_id}' (เปิดตั้งค่า ⚙ → AI Engines)")
    if engine_id not in TRACKERS:
        raise RuntimeError(f"engine '{engine_id}' ไม่ใช่ engine ชี้เป้า")

    root = _engine_dir(engine_id)
    venv_py = root / "venv" / "Scripts" / "python.exe"
    worker = Path(__file__).resolve().parent / "workers" / "track_worker.py"

    out_dir = Path("./_work").resolve()
    out_dir.mkdir(exist_ok=True)
    suffix = f"_{int(start * 1000)}_{int((duration or 0) * 1000)}" if duration else ""
    dst = out_dir / f"{Path(video_path).stem}_track{suffix}.mp4"

    proc = subprocess.Popen(
        [str(venv_py), str(worker), video_path, str(dst), TRACKERS[engine_id],
         str(root / "models"), _json.dumps(rect), style, color,
         f"{start:.3f}", f"{duration:.3f}" if duration else "0"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    _watch_cancel(proc, cancelled)
    out_path = None
    for line in proc.stdout:
        if cancelled and cancelled():
            break
        parts = line.strip().split()
        if not parts:
            continue
        if parts[0] == "PROG" and len(parts) == 3:
            progress(int(parts[1]), int(parts[2]))
        elif parts[0] == "OUT":
            out_path = line.strip()[4:]
    proc.wait()
    if cancelled and cancelled():
        raise JobCancelled()
    if proc.returncode != 0 or not out_path:
        err = proc.stderr.read()[-800:] if proc.stderr else ""
        raise RuntimeError(f"ชี้เป้าไม่สำเร็จ: {err or 'worker ล้มเหลว'}")
    return out_path


def run_inpaint(
    video_path: str, progress, engine_id: str, rect: dict,
    start: float = 0.0, duration: float | None = None,
    cancelled=None,
) -> str:
    """ลบวัตถุ/เซ็นเซอร์ในกรอบ rect ({x,y,w,h} สัดส่วน 0–1 ของเฟรม) เฉพาะช่วงที่ส่งมา
    ขั้นตอน: แตกเฟรม → inpaint (LaMa ทีละเฟรม / ProPainter ทั้งช่วง) → ประกอบกลับพร้อมเสียงเดิม
    คืน path ไฟล์ mp4 ใหม่ใน _work/"""
    if not is_installed(engine_id):
        raise RuntimeError(f"ยังไม่ได้ติดตั้ง engine '{engine_id}' (เปิดตั้งค่า ⚙ → AI Engines)")
    if engine_id not in ("inpaint-fast", "inpaint-quality"):
        raise RuntimeError(f"engine '{engine_id}' ไม่ใช่ engine ลบวัตถุ")

    import json as _json
    import time

    from core import video_utils

    stem = Path(video_path).stem
    suffix = f"_{int(start * 1000)}_{int((duration or 0) * 1000)}" if duration else ""
    work = Path("./_work").resolve()
    work.mkdir(exist_ok=True)
    in_dir = work / f"{stem}_inp_in{suffix}"
    out_frames = work / f"{stem}_inp_out{suffix}"
    for d in (in_dir, out_frames):
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir()

    total = video_utils.extract_frames(
        video_path, str(in_dir), start=start, duration=duration, cancelled=cancelled
    )
    progress(0, total)

    root = _engine_dir(engine_id)
    venv_py = root / "venv" / "Scripts" / "python.exe"

    if engine_id == "inpaint-fast":
        # ---- LaMa: worker ของเราเอง ทีละเฟรม รายงาน PROG กลับมาตรงๆ ----
        model = root / "models" / "lama_fp32.onnx"
        worker = Path(__file__).resolve().parent / "workers" / "lama_worker.py"
        proc = subprocess.Popen(
            [str(venv_py), str(worker), str(in_dir), str(out_frames), str(model),
             _json.dumps(rect)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        for line in proc.stdout:
            if cancelled and cancelled():
                proc.kill()
                proc.wait()
                raise JobCancelled()
            parts = line.strip().split()
            if parts and parts[0] == "PROG" and len(parts) == 3:
                progress(int(parts[1]), int(parts[2]))
        if proc.wait() != 0:
            err = proc.stderr.read()[-800:] if proc.stderr else ""
            raise RuntimeError(f"ลบวัตถุไม่สำเร็จ: {err or 'worker ล้มเหลว'}")
    else:
        # ---- ProPainter: เรียก inference script ของ repo ที่แตกไว้ใน bin/ ----
        repo = next((p for p in (root / "bin").glob("ProPainter*") if p.is_dir()), None)
        script = repo / "inference_propainter.py" if repo else None
        if not script or not script.exists():
            raise RuntimeError("ไม่พบซอร์ส ProPainter ใน engine — ลองถอนแล้วติดตั้งใหม่")
        # script หา weights ใน <repo>/weights — ก็อปโมเดลที่โหลดไว้เข้าไป (ครั้งแรกครั้งเดียว)
        wdir = repo / "weights"
        wdir.mkdir(exist_ok=True)
        rename = {"propainter.pth": "ProPainter.pth"}  # ชื่อไฟล์ที่ script คาดหวัง
        for m in (root / "models").glob("*.pth"):
            dst = wdir / rename.get(m.name, m.name)
            if not dst.exists():
                shutil.copy2(m, dst)

        # mask ภาพเดียว (กรอบขาวบนพื้นดำ) ใช้กับทุกเฟรม — สร้างด้วย ffmpeg drawbox
        first = next(in_dir.glob("frame_*.png"))
        import struct
        with open(first, "rb") as f:
            f.seek(16)  # ขนาดภาพอยู่ใน IHDR ของ PNG
            W, H = struct.unpack(">II", f.read(8))
        rx, ry = int(rect["x"] * W), int(rect["y"] * H)
        rw, rh = max(2, int(rect["w"] * W)), max(2, int(rect["h"] * H))
        mask_png = work / f"{stem}_inp_mask{suffix}.png"
        subprocess.run(
            [video_utils.FFMPEG, "-y", "-f", "lavfi", "-i", f"color=black:s={W}x{H}",
             "-vf", f"drawbox=x={rx}:y={ry}:w={rw}:h={rh}:color=white:t=fill",
             "-frames:v", "1", str(mask_png)],
            check=True, capture_output=True,
        )

        result_dir = work / f"{stem}_inp_res{suffix}"
        shutil.rmtree(result_dir, ignore_errors=True)
        err_log = work / f"{stem}_inp{suffix}.log"
        with open(err_log, "w", encoding="utf-8", errors="replace") as errf:
            proc = subprocess.Popen(
                [str(venv_py), str(script),
                 "-i", str(in_dir), "-m", str(mask_png), "-o", str(result_dir),
                 "--fp16"],  # ครึ่ง precision ประหยัด VRAM ผลต่างมองไม่เห็น
                cwd=str(repo), stdout=errf, stderr=subprocess.STDOUT,
            )
            while proc.poll() is None:
                if cancelled and cancelled():
                    proc.kill()
                    proc.wait()
                    raise JobCancelled()
                time.sleep(1.0)
        if proc.returncode != 0:
            tail = err_log.read_text(encoding="utf-8", errors="replace")[-500:]
            raise RuntimeError(f"ลบวัตถุไม่สำเร็จ: {tail}")
        err_log.unlink(missing_ok=True)
        # ผลลัพธ์ของ script: <result_dir>/<ชื่อ input>/inpaint_out.mp4 → แตกกลับเป็นเฟรมเพื่อประกอบท่อเดียวกับ LaMa
        result_mp4 = next(result_dir.rglob("inpaint_out.mp4"), None)
        if not result_mp4:
            raise RuntimeError("ProPainter จบงานแต่ไม่พบไฟล์ผลลัพธ์")
        video_utils.extract_frames(str(result_mp4), str(out_frames), cancelled=cancelled)
        progress(total, total)

    # ---- ประกอบกลับ + เสียงช่วงเดียวกันจากไฟล์เดิม (ท่อเดียวกับ run_upscale) ----
    fps = video_utils.get_video_fps(video_path)
    dst = work / f"{stem}_clean{suffix}.mp4"
    trim = (["-ss", f"{start:.3f}"] if start > 0 else []) + (
        ["-t", f"{duration:.3f}"] if duration else []
    )
    subprocess.run(
        [video_utils.FFMPEG, "-y",
         "-framerate", f"{fps:.4f}", "-i", str(out_frames / "frame_%06d.png"),
         *trim, "-i", video_path,
         "-map", "0:v", "-map", "1:a:0?",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast",
         "-c:a", "aac", "-shortest", str(dst)],
        check=True, capture_output=True,
    )
    shutil.rmtree(in_dir, ignore_errors=True)
    shutil.rmtree(out_frames, ignore_errors=True)
    return str(dst)


def uninstall(engine_id: str):
    root = _engine_dir(engine_id)
    if root.exists():
        shutil.rmtree(root, ignore_errors=True)
