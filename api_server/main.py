"""
api_server/main.py
FastAPI เป็นแค่ "เปลือก" ที่ห่อฟังก์ชันจาก core/ ให้ frontend (Electron/React) เรียกผ่าน HTTP
ตัว logic จริงทั้งหมดอยู่ใน core/ — ไฟล์นี้ไม่ควรมี business logic เอง มีแค่ endpoint + เรียก core

รันตอน dev: uvicorn api_server.main:app --reload --port 8420
"""

import sys
from pathlib import Path

# ให้ import core/ ได้จากโฟลเดอร์แม่ (โปรเจกต์ root)
sys.path.append(str(Path(__file__).resolve().parent.parent))

import threading
import uuid
import math

from fastapi import FastAPI, HTTPException, UploadFile, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from core import audio_tools, engines as engine_mgr, video_utils
from core.video_utils import JobCancelled

app = FastAPI(title="AIClip Studio Backend")

# อนุญาต localhost ทุกพอร์ต เพราะ Electron/Vite รันคนละพอร์ตกัน แต่ทั้งคู่อยู่ในเครื่องเดียวกัน
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# เก็บสถานะงานที่กำลังประมวลผล (แบบง่ายสุด เก็บใน memory ก่อน พอโปรเจกต์โตค่อยย้ายไป DB เบาๆ เช่น sqlite)
jobs: dict[str, dict] = {}


def _cancel_check(job_id: str):
    """คืน callable ให้ core ใช้เช็คเป็นระยะว่างานนี้ถูกสั่งยกเลิกหรือยัง"""
    return lambda: jobs.get(job_id, {}).get("cancel", False)


@app.get("/health")
def health():
    """เช็คว่า backend พร้อมใช้งาน + มี ffmpeg ติดตั้งไหม"""
    return {
        "status": "ok",
        "ffmpeg_installed": video_utils.check_ffmpeg_installed(),
    }


@app.get("/video/fps")
def video_fps(path: str):
    """fps จริงของไฟล์ (ffprobe) — frontend ใช้คำนวณจำนวนเฟรมให้ตรงกับงาน AI"""
    try:
        return {"fps": video_utils.get_video_fps(path)}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class ExtractFramesRequest(BaseModel):
    video_path: str
    start: float = 0.0  # แตกเฉพาะช่วงของก้อนที่เลือก
    duration: float | None = None


@app.post("/video/extract-frames")
def extract_frames(req: ExtractFramesRequest):
    """เริ่มงานแตกเฟรมแบบ background คืน job_id ทันที ให้ frontend poll /jobs/{job_id} เอาความคืบหน้า"""
    # โฟลเดอร์แยกตามช่วงเวลา — ก้อนคนละท่อนของไฟล์เดิมไม่ทับกัน
    suffix = f"_{int(req.start * 1000)}_{int((req.duration or 0) * 1000)}" if req.duration else ""
    out_dir = (Path("./_work") / f"{Path(req.video_path).stem}_frames{suffix}").resolve()
    job_id = uuid.uuid4().hex[:8]
    try:
        if req.duration:
            total = int(req.duration * video_utils.get_video_fps(req.video_path))
        else:
            total = video_utils.get_total_frames(req.video_path)
    except Exception:
        total = 0  # ประมาณไม่ได้ก็ยังแตกได้ แค่ progress ไม่รู้ %
    jobs[job_id] = {"status": "working", "done": 0, "total": total, "frames_dir": str(out_dir)}

    def run():
        try:
            count = video_utils.extract_frames(
                req.video_path, str(out_dir), start=req.start, duration=req.duration,
                cancelled=_cancel_check(job_id),
            )
            jobs[job_id].update(status="done", frame_count=count, done=count, total=count)
        except JobCancelled:
            jobs[job_id].update(status="cancelled")
        except Exception as exc:
            jobs[job_id].update(status="error", error=str(exc))

    threading.Thread(target=run, daemon=True).start()
    return {"job_id": job_id}


class ClipProcessRequest(BaseModel):
    video_path: str
    reverse: bool = False
    denoise: bool = False
    enhance: bool = False


@app.post("/audio/process")
def clip_process(req: ClipProcessRequest):
    """เอฟเฟคต่อก้อนแบบติ๊ก: ย้อนกลับ / ลดนอยซ์ / เสียงพูดชัด — ทำต่อกันเป็นลูกโซ่
    ได้ไฟล์ใหม่ใน _work/ (ต้นฉบับไม่ถูกแตะ) ทำซ้ำ combo เดิมได้จาก cache ทันที"""
    if not (req.reverse or req.denoise or req.enhance):
        raise HTTPException(status_code=400, detail="ต้องเลือกอย่างน้อยหนึ่งอย่าง")
    job_id = uuid.uuid4().hex[:8]
    jobs[job_id] = {"status": "working"}

    def run():
        try:
            path = req.video_path
            if req.reverse:
                path = video_utils.reverse_video(path)
            if req.denoise:
                path = audio_tools.reduce_noise(path)
            if req.enhance:
                path = audio_tools.enhance_speech(path)
            jobs[job_id].update(status="done", out_path=path)
        except Exception as exc:
            jobs[job_id].update(status="error", error=str(exc))

    threading.Thread(target=run, daemon=True).start()
    return {"job_id": job_id}


class ReplaceFrameRequest(BaseModel):
    frames_dir: str
    frame: int  # หมายเลขเฟรม (1-based ตามชื่อไฟล์)
    image_path: str


@app.post("/frames/replace")
def replace_frame(req: ReplaceFrameRequest):
    """เอารูปภาพไปแทนเฟรมที่เลือก — ย่อ/ครอปให้พอดีขนาดเฟรมเดิม (cover)"""
    from PIL import Image

    dst = Path(req.frames_dir) / f"frame_{req.frame:06d}.png"
    if not dst.exists():
        raise HTTPException(status_code=404, detail="ไม่พบเฟรมนั้น")
    with Image.open(dst) as base:
        W, H = base.size
    img = Image.open(req.image_path).convert("RGB")
    scale = max(W / img.width, H / img.height)
    img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))))
    left, top = (img.width - W) // 2, (img.height - H) // 2
    img.crop((left, top, left + W, top + H)).save(dst)
    return {"ok": True}


class RebuildRequest(BaseModel):
    frames_dir: str
    video_path: str  # ไฟล์ต้นฉบับ (เอา fps + เสียงช่วงเดียวกันกลับมา)
    start: float = 0.0
    duration: float | None = None


@app.post("/frames/rebuild")
def rebuild_frames(req: RebuildRequest):
    """ประกอบเฟรม (ที่อาจถูกแทนบางเฟรมแล้ว) กลับเป็นวิดีโอ + เสียงเดิมของช่วงนั้น"""
    import subprocess as sp

    job_id = uuid.uuid4().hex[:8]
    jobs[job_id] = {"status": "working"}

    def run():
        try:
            fps = video_utils.get_video_fps(req.video_path)
            out = (Path("./_work") / f"{Path(req.video_path).stem}_edit_{job_id}.mp4").resolve()
            # ดึงเสียงช่วงเดียวกันจากไฟล์เดิม (ไม่มีเสียงก็ประกอบแบบเงียบ)
            audio = out.with_suffix(".m4a")
            trim = (["-ss", f"{req.start:.3f}"] if req.start > 0 else []) + (
                ["-t", f"{req.duration:.3f}"] if req.duration else []
            )
            got_audio = (
                sp.run(
                    [video_utils.FFMPEG, "-y", *trim, "-i", req.video_path,
                     "-vn", "-c:a", "aac", str(audio)],
                    capture_output=True,
                ).returncode == 0 and audio.exists()
            )
            video_utils.rebuild_video(
                req.frames_dir, str(out), fps=fps, audio_path=str(audio) if got_audio else None
            )
            audio.unlink(missing_ok=True)
            jobs[job_id].update(status="done", out_path=str(out))
        except Exception as exc:
            jobs[job_id].update(status="error", error=str(exc))

    threading.Thread(target=run, daemon=True).start()
    return {"job_id": job_id}


class RemoveBgRequest(BaseModel):
    video_path: str
    engine: str = "fast"  # เลือกโมเดลได้ถ้าติดตั้งไว้หลายตัว
    start: float = 0.0  # ทำเฉพาะช่วงของก้อนที่เลือก
    duration: float | None = None


@app.post("/video/remove-bg")
def remove_bg(req: RemoveBgRequest):
    """ตัดฉากหลังทั้งคลิปด้วย engine ที่เลือก — คืน job_id, ผลลัพธ์เป็น WebM มี alpha ใน _work/"""
    if not engine_mgr.is_installed(req.engine):
        raise HTTPException(status_code=400, detail=f"ยังไม่ได้ติดตั้ง engine '{req.engine}'")
    job_id = uuid.uuid4().hex[:8]
    jobs[job_id] = {"status": "working", "done": 0, "total": 0}

    def run():
        try:
            out = engine_mgr.run_remove_bg(
                req.video_path,
                lambda d, t: jobs[job_id].update(done=d, total=t),
                engine_id=req.engine,
                start=req.start,
                duration=req.duration,
                cancelled=_cancel_check(job_id),
            )
            jobs[job_id].update(status="done", out_path=out)
        except JobCancelled:
            jobs[job_id].update(status="cancelled")
        except Exception as exc:
            jobs[job_id].update(status="error", error=str(exc))

    threading.Thread(target=run, daemon=True).start()
    return {"job_id": job_id}


class TranscribeRequest(BaseModel):
    video_path: str
    engine: str = "whisper-small"
    language: str = "auto"  # "auto" = ตรวจภาษาเอง หรือระบุ เช่น "th", "en"
    start: float = 0.0  # ถอดเฉพาะช่วงของก้อนที่เลือก
    duration: float | None = None


@app.post("/audio/transcribe")
def transcribe(req: TranscribeRequest):
    """ถอดเสียงพูดในก้อนที่เลือกเป็นซับ (Whisper) — คืน job_id
    เมื่อ status=done จะมี segments = [{start,end,text}] (เวลานับจากต้นก้อน)"""
    if not engine_mgr.is_installed(req.engine):
        raise HTTPException(status_code=400, detail=f"ยังไม่ได้ติดตั้ง engine '{req.engine}'")
    job_id = uuid.uuid4().hex[:8]
    jobs[job_id] = {"status": "working", "done": 0, "total": 0}

    def run():
        try:
            segs = engine_mgr.run_transcribe(
                req.video_path,
                lambda d, t: jobs[job_id].update(done=d, total=t),
                engine_id=req.engine,
                language=req.language,
                start=req.start,
                duration=req.duration,
                cancelled=_cancel_check(job_id),
            )
            jobs[job_id].update(status="done", segments=segs)
        except JobCancelled:
            jobs[job_id].update(status="cancelled")
        except Exception as exc:
            jobs[job_id].update(status="error", error=str(exc))

    threading.Thread(target=run, daemon=True).start()
    return {"job_id": job_id}


class UpscaleRequest(BaseModel):
    video_path: str
    engine: str = "esrgan"
    start: float = 0.0
    duration: float | None = None


@app.post("/video/upscale")
def upscale(req: UpscaleRequest):
    """อัปสเกล/ปรับภาพชัดเฉพาะช่วงที่ส่งมา — คืน job_id ผลลัพธ์เป็น mp4 ใน _work/"""
    if not engine_mgr.is_installed(req.engine):
        raise HTTPException(status_code=400, detail=f"ยังไม่ได้ติดตั้ง engine '{req.engine}'")
    job_id = uuid.uuid4().hex[:8]
    jobs[job_id] = {"status": "working", "done": 0, "total": 0}

    def run():
        try:
            out = engine_mgr.run_upscale(
                req.video_path,
                lambda d, t: jobs[job_id].update(done=d, total=t),
                engine_id=req.engine,
                start=req.start,
                duration=req.duration,
                cancelled=_cancel_check(job_id),
            )
            jobs[job_id].update(status="done", out_path=out)
        except JobCancelled:
            jobs[job_id].update(status="cancelled")
        except Exception as exc:
            jobs[job_id].update(status="error", error=str(exc))

    threading.Thread(target=run, daemon=True).start()
    return {"job_id": job_id}


class FaceCensorRequest(BaseModel):
    video_path: str
    engine: str = "face-censor"
    style: str = "blur"  # blur | mosaic
    strength: int = 12
    start: float = 0.0
    duration: float | None = None
    # เลือกคน: keep = {"faces": [{t,x,y,w,h}], "invert": bool} — เว้น None = เบลอทุกหน้า
    keep: dict | None = None


@app.post("/video/face-censor")
def face_censor(req: FaceCensorRequest):
    """ตรวจจับใบหน้าอัตโนมัติแล้วเบลอ/โมเสกตามทุกเฟรม — คืน job_id ผลลัพธ์ mp4 ใน _work/"""
    if not engine_mgr.is_installed(req.engine):
        raise HTTPException(status_code=400, detail=f"ยังไม่ได้ติดตั้ง engine '{req.engine}'")
    job_id = uuid.uuid4().hex[:8]
    jobs[job_id] = {"status": "working", "done": 0, "total": 0}

    def run():
        try:
            out = engine_mgr.run_face_censor(
                req.video_path,
                lambda d, t: jobs[job_id].update(done=d, total=t),
                engine_id=req.engine, style=req.style, strength=req.strength,
                start=req.start, duration=req.duration, keep=req.keep,
                cancelled=_cancel_check(job_id),
            )
            jobs[job_id].update(status="done", out_path=out)
        except JobCancelled:
            jobs[job_id].update(status="cancelled")
        except Exception as exc:
            jobs[job_id].update(status="error", error=str(exc))

    threading.Thread(target=run, daemon=True).start()
    return {"job_id": job_id}


class CensorRequest(BaseModel):
    video_path: str
    rect: dict  # {x, y, w, h} สัดส่วน 0–1 ของเฟรม
    style: str = "blur"  # blur | mosaic
    strength: int = 12
    start: float = 0.0  # ช่วงเวลาในไฟล์นี้ที่ให้เซ็นเซอร์ทำงาน
    duration: float | None = None


@app.post("/video/censor")
def censor(req: CensorRequest):
    """เบิร์นเซ็นเซอร์ (เบลอ/โมเสก) ลงไฟล์จริง เฉพาะกรอบ+ช่วงเวลาที่ส่งมา — ไม่ต้องใช้ AI
    คืน job_id ผลลัพธ์เป็น mp4 ใน _work/ (เร็ว เพราะเป็น ffmpeg ล้วน)"""
    job_id = uuid.uuid4().hex[:8]
    jobs[job_id] = {"status": "working"}

    def run():
        try:
            out = video_utils.censor_region(
                req.video_path, req.rect, style=req.style, strength=req.strength,
                start=req.start, duration=req.duration, cancelled=_cancel_check(job_id),
            )
            jobs[job_id].update(status="done", out_path=out)
        except JobCancelled:
            jobs[job_id].update(status="cancelled")
        except Exception as exc:
            jobs[job_id].update(status="error", error=str(exc))

    threading.Thread(target=run, daemon=True).start()
    return {"job_id": job_id}


class InpaintRequest(BaseModel):
    video_path: str
    engine: str = "inpaint-fast"
    # กรอบพื้นที่ที่จะลบ (สัดส่วน 0–1 ของเฟรม) — วาดจากจอ Program
    rect: dict  # {x, y, w, h}
    start: float = 0.0
    duration: float | None = None


@app.post("/video/inpaint")
def inpaint(req: InpaintRequest):
    """ลบวัตถุ/เซ็นเซอร์ในกรอบที่เลือก — คืน job_id ผลลัพธ์เป็น mp4 ใน _work/"""
    if not engine_mgr.is_installed(req.engine):
        raise HTTPException(status_code=400, detail=f"ยังไม่ได้ติดตั้ง engine '{req.engine}'")
    job_id = uuid.uuid4().hex[:8]
    jobs[job_id] = {"status": "working", "done": 0, "total": 0}

    def run():
        try:
            out = engine_mgr.run_inpaint(
                req.video_path,
                lambda d, t: jobs[job_id].update(done=d, total=t),
                engine_id=req.engine,
                rect=req.rect,
                start=req.start,
                duration=req.duration,
                cancelled=_cancel_check(job_id),
            )
            jobs[job_id].update(status="done", out_path=out)
        except JobCancelled:
            jobs[job_id].update(status="cancelled")
        except Exception as exc:
            jobs[job_id].update(status="error", error=str(exc))

    threading.Thread(target=run, daemon=True).start()
    return {"job_id": job_id}


class MergeRequest(BaseModel):
    # ท่อนที่จะต่อ ตามลำดับ — start/duration เป็นวินาทีในไฟล์จริง
    segments: list[dict]  # [{path, start, duration, speed}]
    settings: dict | None = None


@app.post("/video/merge")
def merge_videos(req: MergeRequest):
    """ต่อท่อนวิดีโอ (เลนเดียวกัน) เป็นไฟล์เดียวเนื้อเดียว — คืน job_id, progress เป็น % (done/100)"""
    job_id = uuid.uuid4().hex[:8]
    jobs[job_id] = {"status": "working", "done": 0, "total": 100}

    def run():
        try:
            out = video_utils.merge_videos(
                req.segments,
                progress=lambda pct: jobs[job_id].update(done=pct),
                cancelled=_cancel_check(job_id),
                settings=req.settings,
            )
            jobs[job_id].update(status="done", done=100, out_path=out)
        except JobCancelled:
            jobs[job_id].update(status="cancelled")
        except Exception as exc:
            jobs[job_id].update(status="error", error=str(exc))

    threading.Thread(target=run, daemon=True).start()
    return {"job_id": job_id}


class FaceSwapRequest(BaseModel):
    video_path: str
    face_image: str | None = None  # เดี่ยว (เข้ากันได้ย้อนหลัง)
    # หลายหน้า: [{"source": path, "ref": {t,x,y,w,h}|null}] — ref = ชี้ว่ารูปนี้ไปคนไหน
    maps: list | None = None
    engine: str = "face-swap-local"
    enhance: bool = True  # GFPGAN เก็บหน้าคม (ช้าขึ้น แต่คุ้ม)
    start: float = 0.0
    duration: float | None = None


@app.post("/video/swap-face")
def swap_face(req: FaceSwapRequest):
    """สลับหน้าคนในวิดีโอเป็นหน้าจากรูปต้นแบบ — คืน job_id ผลลัพธ์ mp4 ใน _work/"""
    if not engine_mgr.is_installed(req.engine):
        raise HTTPException(status_code=400, detail=f"ยังไม่ได้ติดตั้ง engine '{req.engine}'")
    job_id = uuid.uuid4().hex[:8]
    jobs[job_id] = {"status": "working", "done": 0, "total": 0}

    def run():
        try:
            out = engine_mgr.run_face_swap(
                req.video_path,
                lambda d, t: jobs[job_id].update(done=d, total=t),
                face_image=req.face_image,
                maps=req.maps,
                engine_id=req.engine,
                enhance=req.enhance,
                start=req.start,
                duration=req.duration,
                cancelled=_cancel_check(job_id),
            )
            jobs[job_id].update(status="done", out_path=out)
        except JobCancelled:
            jobs[job_id].update(status="cancelled")
        except Exception as exc:
            jobs[job_id].update(status="error", error=str(exc))

    threading.Thread(target=run, daemon=True).start()
    return {"job_id": job_id}


class TrackRequest(BaseModel):
    video_path: str
    engine: str = "track-csrt"
    # กรอบเป้าที่ผู้ใช้ตีไว้ ณ เฟรมแรกของช่วง (สัดส่วน 0–1 ของเฟรม)
    rect: dict  # {x, y, w, h}
    style: str = "box"  # circle | arrow | box
    color: str = "#ffd60a"
    start: float = 0.0
    duration: float | None = None


class MaskTrackRequest(BaseModel):
    video_path: str
    points: list[dict]
    reference_time: float = 0.0
    start: float = 0.0
    duration: float | None = None


@app.post("/video/mask-track")
def mask_track(req: MaskTrackRequest):
    """Track an authored polygon and return reusable source-time transforms."""
    from core.mask_fx import normalized_points, track_mask

    try:
        normalized_points(req.points)
        if not Path(req.video_path).is_file():
            raise ValueError("Video file not found")
        if not all(math.isfinite(value) for value in (req.reference_time, req.start)
                   + (() if req.duration is None else (req.duration,))):
            raise ValueError("Tracking times must be finite numbers")
        if req.start < 0 or (req.duration is not None and req.duration <= 0):
            raise ValueError("The tracking range must have a positive duration")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    job_id = uuid.uuid4().hex[:8]
    jobs[job_id] = {"status": "working", "done": 0, "total": 0}

    def run():
        try:
            keyframes = track_mask(
                req.video_path, req.points, reference_time=req.reference_time,
                start=req.start, duration=req.duration,
                progress=lambda done, total: jobs[job_id].update(done=done, total=total),
                cancelled=_cancel_check(job_id),
            )
            if _cancel_check(job_id)():
                raise JobCancelled()
            jobs[job_id].update(status="done", mask_track=keyframes,
                                done=len(keyframes), total=len(keyframes),
                                lost_frames=sum(bool(frame.get("lost")) for frame in keyframes))
        except JobCancelled:
            jobs[job_id].update(status="cancelled")
        except Exception as exc:
            jobs[job_id].update(status="error", error=str(exc))

    threading.Thread(target=run, daemon=True).start()
    return {"job_id": job_id}


@app.post("/video/track")
def track(req: TrackRequest):
    """ตีกรอบเป้าครั้งเดียว → AI ตามเป้าทั้งช่วง + วาดสัญลักษณ์ชี้เป้าวิ่งตาม — คืน job_id"""
    if not engine_mgr.is_installed(req.engine):
        raise HTTPException(status_code=400, detail=f"ยังไม่ได้ติดตั้ง engine '{req.engine}'")
    job_id = uuid.uuid4().hex[:8]
    jobs[job_id] = {"status": "working", "done": 0, "total": 0}

    def run():
        try:
            out = engine_mgr.run_track(
                req.video_path,
                lambda d, t: jobs[job_id].update(done=d, total=t),
                engine_id=req.engine,
                rect=req.rect,
                style=req.style,
                color=req.color,
                start=req.start,
                duration=req.duration,
                cancelled=_cancel_check(job_id),
            )
            jobs[job_id].update(status="done", out_path=out)
        except JobCancelled:
            jobs[job_id].update(status="cancelled")
        except Exception as exc:
            jobs[job_id].update(status="error", error=str(exc))

    threading.Thread(target=run, daemon=True).start()
    return {"job_id": job_id}


class StabilizeRequest(BaseModel):
    video_path: str
    strength: str = "medium"  # low | medium | high
    start: float = 0.0
    duration: float | None = None


@app.post("/video/stabilize")
def stabilize(req: StabilizeRequest):
    """ลดสั่นด้วย vid.stab (ffmpeg 2-pass) — คืน job_id, progress เป็น % (done/100)"""
    job_id = uuid.uuid4().hex[:8]
    jobs[job_id] = {"status": "working", "done": 0, "total": 100}

    def run():
        try:
            out = video_utils.stabilize_video(
                req.video_path, strength=req.strength,
                start=req.start, duration=req.duration,
                progress=lambda pct: jobs[job_id].update(done=pct),
                cancelled=_cancel_check(job_id),
            )
            jobs[job_id].update(status="done", done=100, out_path=out)
        except JobCancelled:
            jobs[job_id].update(status="cancelled")
        except Exception as exc:
            jobs[job_id].update(status="error", error=str(exc))

    threading.Thread(target=run, daemon=True).start()
    return {"job_id": job_id}


# ---------- AI Engine Manager ----------

@app.get("/engines")
def list_engines():
    """สเปคเครื่อง + รายการ engine (ติดตั้งแล้ว/ลงได้/แนะนำ) สำหรับหน้า Engine Manager"""
    return engine_mgr.overview()


@app.post("/engines/{engine_id}/install")
def install_engine(engine_id: str):
    """ติดตั้ง engine เป็นงาน background — poll /jobs/{job_id} ดูความคืบหน้า"""
    job_id = uuid.uuid4().hex[:8]
    jobs[job_id] = {"status": "working", "phase": "เตรียมการ…"}

    def run():
        try:
            engine_mgr.install(
                engine_id,
                lambda **kw: jobs[job_id].update(**kw),
                cancelled=lambda: jobs[job_id].get("cancelled", False),
            )
            jobs[job_id].update(status="done")
        except engine_mgr.InstallCancelled:
            engine_mgr.uninstall(engine_id)  # เก็บกวาดไฟล์ครึ่งๆ กลางๆ
            jobs[job_id].update(status="cancelled")
        except Exception as exc:
            jobs[job_id].update(status="error", error=str(exc))

    threading.Thread(target=run, daemon=True).start()
    return {"job_id": job_id}


@app.delete("/engines/{engine_id}")
def delete_engine(engine_id: str):
    engine_mgr.uninstall(engine_id)
    return {"ok": True}


@app.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    """สั่งยกเลิกงานที่กำลังรัน — ตั้งทั้งสอง flag ให้ครอบคลุมทุกงาน
    (งานวิดีโอเช็ค "cancel" ผ่าน _cancel_check / งานติดตั้ง engine เช็ค "cancelled")"""
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    if job["status"] == "working":
        job["cancel"] = True
        job["cancelled"] = True
    return {"ok": True}


@app.get("/jobs/{job_id}")
def job_status(job_id: str):
    """สถานะงาน — งานแตกเฟรมนับไฟล์ที่ ffmpeg เขียนแล้วเป็น progress"""
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    if job["status"] == "working" and "frames_dir" in job:
        job["done"] = len(list(Path(job["frames_dir"]).glob("frame_*.png")))
    return job


# TODO ถัดไป (ตามลำดับที่วางแผนไว้):
# @app.post("/ai/face-swap")      -> เรียก core.ai_pipeline.face_swap ทีละเฟรม + track progress
# @app.post("/ai/background-replace")
# @app.post("/ai/generate-image")
# @app.post("/ai/lora/train")      -> คืน job_id ให้ frontend poll ผ่าน /jobs/{job_id}
