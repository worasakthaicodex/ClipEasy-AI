"""
audio_tools.py
งานปรับปรุงเสียงแบบเบา (ไม่ใช้โมเดล AI ใหญ่): ลดนอยซ์ + ปรับเสียงพูดให้ดัง-คมชัดมาตรฐาน
ผลลัพธ์เป็นไฟล์วิดีโอใหม่ (video stream copy เดิม เปลี่ยนเฉพาะเสียง) ไม่แตะไฟล์ต้นฉบับ
"""

import subprocess
import tempfile
from pathlib import Path

import numpy as np
import noisereduce as nr
from scipy.io import wavfile

from core.video_utils import FFMPEG


def _run(cmd: list[str]) -> None:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        # เอาบรรทัดท้ายๆ ของ stderr มาเป็นข้อความ error (ffmpeg เขียน log ยาวมาก)
        tail = "\n".join(result.stderr.strip().splitlines()[-3:])
        raise RuntimeError(f"ffmpeg ล้มเหลว: {tail}")


def _out_path(video_path: str, suffix: str) -> Path:
    """ไฟล์ผลลัพธ์ใน _work/ ชื่อเดิม + ต่อท้ายด้วยชนิดงาน"""
    out_dir = Path("./_work").resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir / f"{Path(video_path).stem}_{suffix}.mp4"


def _cached(out: Path, src: str) -> bool:
    """ผลลัพธ์เดิมยังใช้ได้ไหม (มีอยู่และใหม่กว่าต้นฉบับ) — ติ๊กเปิด/ปิดซ้ำจะได้ไม่ต้องรอใหม่"""
    src_p = Path(src)
    return out.exists() and src_p.exists() and out.stat().st_mtime >= src_p.stat().st_mtime


def enhance_speech(video_path: str) -> str:
    """ทำเสียงพูดให้ดังสม่ำเสมอ-คมชัดขึ้น: ตัดความถี่ต่ำกวนๆ + normalize ความดังตามมาตรฐาน
    highpass 80Hz = ตัดเสียงฮัม/ลมกระแทกไมค์ / loudnorm = ดัน loudness ไปที่ -16 LUFS (มาตรฐานงานพูด)
    """
    out = _out_path(video_path, "enhance")
    if _cached(out, video_path):
        return str(out)
    _run([
        FFMPEG, "-y", "-i", video_path,
        "-af", "highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        str(out),
    ])
    return str(out)


def reduce_noise(video_path: str) -> str:
    """ลดเสียงรบกวนพื้นหลัง (spectral gating ผ่าน noisereduce) แล้วประกอบเสียงกลับเข้าวิดีโอเดิม"""
    out = _out_path(video_path, "denoise")
    if _cached(out, video_path):
        return str(out)
    with tempfile.TemporaryDirectory() as tmp:
        raw_wav = Path(tmp) / "raw.wav"
        clean_wav = Path(tmp) / "clean.wav"

        # 1) ดึงเสียงเป็น PCM wav (16-bit / 48kHz) ให้ scipy อ่านได้ตรงๆ
        _run([
            FFMPEG, "-y", "-i", video_path,
            "-vn", "-acodec", "pcm_s16le", "-ar", "48000",
            str(raw_wav),
        ])

        # 2) ลดนอยซ์ — noisereduce ต้องการ shape (channels, samples) แต่ scipy ให้ (samples, channels)
        rate, data = wavfile.read(raw_wav)
        stereo = data.ndim == 2
        y = data.T if stereo else data
        cleaned = nr.reduce_noise(y=y.astype(np.float32), sr=rate, stationary=False)
        cleaned = np.clip(cleaned, -32768, 32767).astype(np.int16)
        wavfile.write(clean_wav, rate, cleaned.T if stereo else cleaned)

        # 3) ประกอบเสียงที่สะอาดแล้วกลับเข้าวิดีโอ (ภาพ copy เดิม ไม่ re-encode)
        _run([
            FFMPEG, "-y", "-i", video_path, "-i", str(clean_wav),
            "-map", "0:v", "-map", "1:a",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            str(out),
        ])
    return str(out)
