"""
ai_pipeline.py
โครง "ช่องเสียบ" สำหรับ AI แต่ละตัว ตอนนี้เป็นแค่ stub (ยังไม่ใส่โมเดลจริง)
พอถึงเวลาทำจริง ให้แทนที่ import และ logic ข้างในแต่ละฟังก์ชัน โดยไม่ต้องแก้ที่อื่น
เพราะ main.py เรียกผ่าน interface เดียวกันหมด (รับภาพเข้า, ส่งภาพออก)

ลำดับที่แนะนำให้ทำจริงก่อน-หลัง (จากที่คุยกันไว้):
1. face_swap        -> ใช้ insightface / FaceFusion เป็นฐาน
2. background_replace -> ใช้ rembg (เร็ว ติดตั้งง่าย) ก่อน แล้วค่อยอัพเป็น RVM/SAM2
3. image_generate    -> เรียก API ภายนอก (เช่น Stable Diffusion API) หรือรันโลคอลด้วย diffusers
4. lora_train        -> เรียก kohya_ss เป็น subprocess แยกต่างหาก ไม่ต้องเขียนเทรนเอง
"""

from PIL import Image


def face_swap(frame: Image.Image, source_face_path: str) -> Image.Image:
    """
    TODO: เสียบโมเดล face swap จริง เช่น insightface
    ตอนนี้แค่ return ภาพเดิม (pass-through) เพื่อให้ pipeline รันได้ก่อน
    """
    # ตัวอย่างโครงตอนทำจริง:
    # from insightface.app import FaceAnalysis
    # swapper = ... โหลดโมเดลครั้งเดียวตอน server start ไม่ใช่ทุกเฟรม
    # result = swapper.get(frame, source_face)
    return frame


def background_replace(frame: Image.Image, new_bg: Image.Image) -> Image.Image:
    """
    TODO: เสียบโมเดล segmentation/matting จริง เช่น rembg หรือ RVM
    ตอนนี้แค่ return ภาพเดิม
    """
    # ตัวอย่างโครงตอนทำจริง (ใช้ rembg ซึ่งติดตั้งง่ายสุดสำหรับเริ่มต้น):
    # from rembg import remove
    # mask = remove(frame, only_mask=True)
    # composited = Image.composite(frame, new_bg, mask)
    # return composited
    return frame


def generate_image(prompt: str, reference_face_path: str | None = None) -> Image.Image:
    """
    TODO: เรียก Stable Diffusion / Flux (local หรือผ่าน API)
    ถ้ามี reference_face_path ให้ใช้ IP-Adapter/InstantID เพื่อคุมหน้าตัวละครให้เหมือนเดิม
    """
    raise NotImplementedError("ยังไม่ได้เสียบโมเดล image generation")


def start_lora_training(image_folder: str, subject_name: str) -> str:
    """
    TODO: เรียก kohya_ss เป็น subprocess แยก ไม่ต้องเขียน training loop เอง
    คืนค่า job_id ให้ frontend เอาไป poll สถานะความคืบหน้า
    """
    raise NotImplementedError("ยังไม่ได้ผูก kohya_ss")
