"""
core/workers/whisper_worker.py — ถอดเสียงพูดเป็นซับไตเติล (รันใน venv ของ engine whisper-*)

ถูกเรียกเป็น subprocess:
    python whisper_worker.py <audio.wav> <model_dir> <language>
      language = "auto" ให้ตรวจภาษาเอง หรือระบุ เช่น "th", "en"

สื่อสารกลับทาง stdout (บรรทัดละ 1 เหตุการณ์):
    PROG <done_ms> <total_ms>          — ความคืบหน้า (ไมล์วินาที)
    SEG  {json}                        — 1 ประโยคซับ: {"start","end","text"}
    DONE                               — จบงาน
โมเดลใช้ faster-whisper (CTranslate2) โหลดจากโฟลเดอร์โลคัล — รันบน CPU int8 ได้ทุกเครื่อง
"""

import json
import sys

# บังคับ stdout เป็น UTF-8 — ไม่งั้นบน Windows ข้อความไทยจะเพี้ยน (mojibake)
# เพราะ default encoding ของ console เป็น cp ภาษาถิ่น ไม่ใช่ utf-8
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from faster_whisper import WhisperModel


def emit(line: str):
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def main():
    audio_path = sys.argv[1]
    model_dir = sys.argv[2]
    language = sys.argv[3] if len(sys.argv) > 3 else "auto"
    lang = None if language in ("", "auto") else language

    # int8 บน CPU = เบาสุด รันได้ทุกเครื่อง (มี GPU ก็ยังใช้ CPU path นี้เพื่อความเข้ากันได้)
    model = WhisperModel(model_dir, device="cpu", compute_type="int8")

    # vad_filter ตัดช่วงเงียบทิ้ง → ซับไม่โผล่ตอนไม่มีคนพูด และเร็วขึ้น
    segments, info = model.transcribe(
        audio_path, language=lang, vad_filter=True, beam_size=5,
    )
    total_ms = int((info.duration or 0) * 1000)
    emit(f"PROG 0 {total_ms}")

    for seg in segments:
        text = (seg.text or "").strip()
        if text:
            emit("SEG " + json.dumps(
                {"start": round(seg.start, 3), "end": round(seg.end, 3), "text": text},
                ensure_ascii=False,
            ))
        emit(f"PROG {int(seg.end * 1000)} {total_ms}")

    emit("DONE")


if __name__ == "__main__":
    main()
