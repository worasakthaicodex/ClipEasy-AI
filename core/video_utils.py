"""
video_utils.py
งานพื้นฐานเกี่ยวกับวิดีโอที่ไม่ต้องใช้ AI เลย: แตกเฟรม, ต่อเฟรมกลับ, ดึง/ใส่เสียง
ทุกฟังก์ชันเรียก ffmpeg ผ่าน subprocess ตรงๆ (ต้องติดตั้ง ffmpeg ในเครื่องก่อน: https://ffmpeg.org)
"""

import os
import subprocess
import shutil
import time
import math
import tempfile
import uuid
from pathlib import Path


class JobCancelled(Exception):
    """งานถูกผู้ใช้สั่งยกเลิกกลางทาง"""


def _find_tool(name: str) -> str:
    """หา ffmpeg/ffprobe: เช็ค PATH ก่อน ไม่เจอค่อยไล่หาที่ winget ติดตั้งไว้
    (winget ลงเสร็จแต่ process ที่เปิดค้างอยู่ก่อนหน้าจะยังไม่เห็น PATH ใหม่)"""
    found = shutil.which(name)
    if found:
        return found
    winget_pkgs = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
    for exe in winget_pkgs.glob(f"Gyan.FFmpeg*/*/bin/{name}.exe"):
        return str(exe)
    return name  # ปล่อยให้ subprocess ล้มพร้อมข้อความชัดๆ ถ้าไม่มีจริง


FFMPEG = _find_tool("ffmpeg")
FFPROBE = _find_tool("ffprobe")


def check_ffmpeg_installed() -> bool:
    """เช็คว่าเครื่องมี ffmpeg ให้เรียกใช้ไหม (PATH หรือ winget)"""
    return shutil.which("ffmpeg") is not None or Path(FFMPEG).exists()


def get_video_fps(video_path: str) -> float:
    """ดึงค่า fps ของวิดีโอต้นฉบับ ไว้ใช้ตอน rebuild ให้ตรงเดิม"""
    cmd = [
        FFPROBE, "-v", "0", "-of", "csv=p=0",
        "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate",
        video_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    num, den = result.stdout.strip().split("/")
    return float(num) / float(den)


def get_total_frames(video_path: str) -> int:
    """ประมาณจำนวนเฟรมทั้งหมดจาก duration × fps (เร็วกว่านับแพ็คเก็ตจริง ใช้ทำ progress)"""
    cmd = [
        FFPROBE, "-v", "0", "-of", "csv=p=0",
        "-show_entries", "format=duration", video_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    duration = float(result.stdout.strip())
    return int(duration * get_video_fps(video_path))


def extract_frames(
    video_path: str, out_dir: str, start: float = 0.0, duration: float | None = None,
    cancelled=None,
) -> int:
    """แตกวิดีโอเป็นเฟรมภาพ PNG เรียงลำดับ คืนค่าจำนวนเฟรมที่ได้
    start/duration (วินาที) = แตกเฉพาะช่วงของก้อนที่เลือก ไม่ใช่ทั้งไฟล์
    cancelled() คืน True เมื่อไหร่ = ฆ่า ffmpeg แล้ว raise JobCancelled"""
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    cmd = [FFMPEG, "-y"]
    if start > 0:
        cmd += ["-ss", f"{start:.3f}"]
    cmd += ["-i", video_path]
    if duration is not None:
        cmd += ["-t", f"{duration:.3f}"]
    cmd += [f"{out_dir}/frame_%06d.png"]
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    while proc.poll() is None:
        if cancelled and cancelled():
            proc.kill()
            proc.wait()
            raise JobCancelled()
        time.sleep(0.3)
    if proc.returncode != 0:
        raise RuntimeError("ffmpeg แตกเฟรมล้มเหลว — เช็คว่าไฟล์วิดีโอเปิดได้")
    return len(list(Path(out_dir).glob("frame_*.png")))


def _probe_size(video_path: str) -> tuple[int, int]:
    """คืน (width, height) ของสตรีมวิดีโอ"""
    out = subprocess.run(
        [FFPROBE, "-v", "0", "-of", "csv=p=0", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", video_path],
        capture_output=True, text=True, check=True,
    )
    w, h = out.stdout.strip().split(",")
    return int(w), int(h)


def _has_audio(video_path: str) -> bool:
    out = subprocess.run(
        [FFPROBE, "-v", "0", "-select_streams", "a", "-show_entries", "stream=index",
         "-of", "csv=p=0", video_path],
        capture_output=True, text=True,
    )
    return bool(out.stdout.strip())


def merge_videos(segments: list[dict], progress=None, cancelled=None, settings: dict | None = None) -> str:
    """Export timeline clips, preserving gaps, trims, audio and source-space Mask FX.

    start/duration are source seconds, offset is timeline seconds. Mask clips are
    baked at output cadence before composition; their audio stays on the original
    source so a silent intermediate never loses or duplicates attached audio.
    """
    settings = settings or {}
    overlays = [dict(s) for s in settings.get("overlays", [])]
    if not segments and not overlays:
        raise ValueError("ไม่มีวิดีโอสำหรับส่งออก")
    first = (segments or overlays)[0]
    source_w, source_h = _probe_size(first["path"])
    W = max(2, int(settings.get("width") or source_w) // 2 * 2)
    H = max(2, int(settings.get("height") or source_h) // 2 * 2)
    fps = float(settings.get("fps") or get_video_fps(first["path"]))
    if not math.isfinite(fps) or fps <= 0:
        raise ValueError("Frame rate must be greater than zero")
    include_audio = bool(settings.get("audio", True))
    detached_audio = [dict(a) for a in settings.get("detached_audio", [])]

    def normalize(s, default_offset=0):
        s = dict(s)
        for key, default in (("start", 0), ("duration", 0), ("speed", 1), ("offset", default_offset)):
            s[key] = float(s.get(key, default))
            if not math.isfinite(s[key]):
                raise ValueError(f"Invalid export {key}")
        if s["duration"] <= 0 or s["speed"] <= 0 or s["start"] < 0 or s["offset"] < 0:
            raise ValueError("Export time, duration or playback speed is invalid")
        s["out_duration"] = s["duration"] / s["speed"]
        return s

    main, cursor = [], 0
    for s in segments:
        clip = normalize(s, cursor)
        main.append(clip)
        cursor = clip["offset"] + clip["out_duration"]
    main.sort(key=lambda s: s["offset"])
    overlays = sorted((normalize(s) for s in overlays), key=lambda s: (s.get("track", 2), s["offset"]))
    detached_audio = [normalize(a) for a in detached_audio]
    out_total = max([float(settings.get("timeline_duration") or 0)] +
                    [s["offset"] + s["out_duration"] for s in main + overlays + detached_audio])
    timeline, cursor = [], 0
    for s in main:
        if s["offset"] < cursor - 1e-5:
            raise ValueError("คลิปบน V1 ซ้อนกัน กรุณาจัดช่วงเวลาให้ไม่ซ้อนก่อน Export")
        if s["offset"] > cursor + 1e-5:
            timeline.append({"gap": True, "out_duration": s["offset"] - cursor})
        timeline.append(s)
        cursor = s["offset"] + s["out_duration"]
    if out_total > cursor + 1e-5:
        timeline.append({"gap": True, "out_duration": out_total - cursor})

    out_dir = Path("./_work").resolve()
    out_dir.mkdir(exist_ok=True)
    dst = out_dir / f"{Path(first['path']).stem}_merged_{uuid.uuid4().hex[:10]}.mp4"
    def has_mask_effect(segment):
        transform = segment.get("transform") or {}
        points = transform.get("fxMaskPath")
        return (isinstance(points, list) and len(points) >= 3 and
                (transform.get("maskFx") or {}).get("enabled", True) is not False)

    masked = [s for s in main + overlays if has_mask_effect(s)]
    for s in masked:
        tf = s.get("transform") or {}
        unsupported = (tf.get("shape") not in (None, "none") or
            tf.get("videoFx") not in (None, "none", "fit") or
            tf.get("videoFxIn") not in (None, "none", "fade-in") or
            tf.get("videoFxOut") not in (None, "none", "fade-out") or
            tf.get("look") not in (None, "none") or
            (tf.get("colorGrade") not in (None, "none") and tf.get("colorGradeStrength", 100) != 0) or
            float(tf.get("blur") or 0) > 0 or float(tf.get("sharpen") or 0) > 0 or
            tf.get("blend") not in (None, "normal"))
        if unsupported:
            raise ValueError("Mask FX ร่วมกับ Shape, Ratio พิเศษ, โทนสี หรือเอฟเฟกต์ภาพขั้นสูงยังส่งออกไม่ได้ กรุณาปิดเอฟเฟกต์เหล่านั้นบนคลิป Mask ก่อน")
    with tempfile.TemporaryDirectory(prefix="mask_export_", dir=out_dir) as work:
        if masked:
            from core.mask_fx import bake_mask_clip
            for n, s in enumerate(masked):
                s["baked_path"] = bake_mask_clip(s["path"], str(Path(work) / f"mask_{n}.mp4"), s["transform"],
                    start=s["start"], duration=s["duration"], speed=s["speed"], fps=fps,
                    cancelled=cancelled,
                    progress=(lambda done, total, n=n: progress(int(60 * (n + done / max(1, total)) / len(masked)))) if progress else None)

        args = [FFMPEG, "-y", "-v", "error"]
        fparts, input_count = [], 0

        def add_input(path, start, duration):
            nonlocal input_count
            idx = input_count
            input_count += 1
            args.extend((["-ss", f"{start:.7f}"] if start else []) + ["-t", f"{duration:.7f}", "-i", path])
            return idx

        for s in main + overlays:
            baked = s.get("baked_path")
            s["video_input"] = add_input(baked or s["path"], 0 if baked else s["start"], s["out_duration"] if baked else s["duration"])
            s["audio_input"] = None
            if include_audio and not s.get("mute") and _has_audio(s["path"]):
                s["audio_input"] = add_input(s["path"], s["start"], s["duration"]) if baked else s["video_input"]
        if include_audio:
            for a in detached_audio:
                if not _has_audio(a["path"]):
                    raise ValueError(f"Audio source has no audio stream: {Path(a['path']).name}")
                a["audio_input"] = add_input(a["path"], a["start"], a["duration"])

        def audio_chain(s, label, delay=False):
            idx, dur = s.get("audio_input"), s["out_duration"]
            if idx is None:
                fparts.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={dur:.7f}[{label}]")
                return
            tempo, filters = s["speed"], ["asetpts=PTS-STARTPTS"]
            while tempo > 2:
                filters.append("atempo=2"); tempo /= 2
            while tempo < .5:
                filters.append("atempo=0.5"); tempo *= 2
            filters += [f"atempo={tempo:.7f}", "aresample=48000", "aformat=channel_layouts=stereo"]
            tf = s.get("transform") or {}
            volume = max(0, min(5, float(s.get("volume", tf.get("volume", 100))) / 100))
            pan = max(-1, min(1, float(s.get("pan", tf.get("pan", 0))) / 100))
            filters += [f"volume={volume:.7f}", f"stereotools=balance_out={pan:.7f}"]
            fade_in = max(0, min(dur, float(s.get("fade_in", tf.get("audioFadeIn", 0)) or 0)))
            fade_out = max(0, min(dur, float(s.get("fade_out", tf.get("audioFadeOut", 0)) or 0)))
            if fade_in: filters.append(f"afade=t=in:d={fade_in:.7f}")
            if fade_out: filters.append(f"afade=t=out:st={dur-fade_out:.7f}:d={fade_out:.7f}")
            filters += ["apad", f"atrim=duration={dur:.7f}", "asetpts=PTS-STARTPTS"]
            if delay:
                filters.append(f"adelay={int(round(s['offset'] * 1000))}:all=1")
            fparts.append(f"[{idx}:a]{','.join(filters)}[{label}]")

        def visual_chain(s, label, overlay=False):
            tf, dur = s.get("transform") or {}, s["out_duration"]
            speed = 1 if s.get("baked_path") else s["speed"]
            filters = [f"setpts=(PTS-STARTPTS)/{speed:.7f}", f"fps={fps:.7f}"]
            if overlay:
                filters += ["format=rgba", f"scale={W}:{H}:force_original_aspect_ratio=decrease", f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=black@0"]
            else:
                filters += [f"scale={W}:{H}:force_original_aspect_ratio=decrease", f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2"]
            filters += ["setsar=1", "format=rgba", f"trim=duration={dur:.7f}"]
            scale = max(.01, float(tf.get("scale", 100)) / 100)
            if scale != 1:
                filters.append(f"scale={max(2, round(W*scale))}:{max(2, round(H*scale))}")
            angle = math.radians(float(tf.get("rotation") or 0))
            if angle:
                filters.append(f"rotate={angle:.9f}:ow=rotw({angle:.9f}):oh=roth({angle:.9f}):c=none")
            # CSS applies rotate before its signed scale. Mirroring first would
            # rotate the masked subject toward the opposite side of the frame.
            if tf.get("flipH"): filters.append("hflip")
            if tf.get("flipV"): filters.append("vflip")
            opacity = max(0, min(1, float(tf.get("opacity", 100)) / 100))
            if opacity != 1: filters.append(f"colorchannelmixer=aa={opacity:.7f}")
            fade = max(0, float(tf.get("fade") or 0))
            fade_in = max(fade, float(tf.get("videoFxInDuration") or 1) if tf.get("videoFxIn") == "fade-in" else 0)
            fade_out = max(fade, float(tf.get("videoFxOutDuration") or 1) if tf.get("videoFxOut") == "fade-out" else 0)
            if fade_in: filters.append(f"fade=t=in:d={fade_in:.7f}:alpha=1")
            if fade_out: filters.append(f"fade=t=out:st={max(0,dur-fade_out):.7f}:d={fade_out:.7f}:alpha=1")
            if overlay: filters.append(f"setpts=PTS+{s['offset']:.7f}/TB")
            fparts.append(f"[{s['video_input']}:v]{','.join(filters)}[{label}]")

        for i, s in enumerate(timeline):
            dur = s["out_duration"]
            fparts.append(f"color=c=black:s={W}x{H}:r={fps:.7f}:d={dur:.7f}[bg{i}]")
            if s.get("gap"):
                fparts.append(f"[bg{i}]setpts=PTS-STARTPTS[v{i}]")
            else:
                visual_chain(s, f"patch{i}")
                tf = s.get("transform") or {}
                x, y = float(tf.get("x") or 0) * W / 640, float(tf.get("y") or 0) * W / 640
                fparts.append(f"[bg{i}][patch{i}]overlay=x=(W-w)/2+{x:.7f}:y=(H-h)/2+{y:.7f}:shortest=1,format=yuv420p,setsar=1[v{i}]")
            if include_audio: audio_chain(s, f"a{i}")
        pairs = "".join(f"[v{i}][a{i}]" if include_audio else f"[v{i}]" for i in range(len(timeline)))
        fparts.append(f"{pairs}concat=n={len(timeline)}:v=1:a={int(include_audio)}[basev]" + ("[basea]" if include_audio else ""))
        video_label, extra_audio = "basev", []
        for i, s in enumerate(overlays):
            visual_chain(s, f"ov{i}", overlay=True)
            tf = s.get("transform") or {}
            x, y = float(tf.get("x") or 0) * W / 640, float(tf.get("y") or 0) * W / 640
            next_label = f"composite{i}"
            fparts.append(f"[{video_label}][ov{i}]overlay=x=(W-w)/2+{x:.7f}:y=(H-h)/2+{y:.7f}:eof_action=pass:repeatlast=0:enable='gte(t,{s['offset']:.7f})*lt(t,{s['offset']+s['out_duration']:.7f})'[{next_label}]")
            video_label = next_label
            if include_audio and s.get("audio_input") is not None:
                audio_chain(s, f"ova{i}", delay=True)
                extra_audio.append(f"[ova{i}]")
        if include_audio:
            for i, a in enumerate(detached_audio):
                audio_chain(a, f"da{i}", delay=True)
                extra_audio.append(f"[da{i}]")
            if extra_audio:
                fparts.append(f"[basea]{''.join(extra_audio)}amix=inputs={len(extra_audio)+1}:duration=longest:normalize=0,atrim=duration={out_total:.7f}[ao]")
            else:
                fparts.append("[basea]anull[ao]")
        args += ["-filter_complex", ";".join(fparts), "-map", f"[{video_label}]",
                 *(["-map", "[ao]"] if include_audio else []),
                 "-c:v", "libx265" if settings.get("codec") == "h265" else "libx264",
                 "-pix_fmt", "yuv420p", "-crf", str(int(settings.get("crf", 18))),
                 "-preset", str(settings.get("encode_preset") or "veryfast"),
                 *(["-c:a", "aac", "-ar", "48000"] if include_audio else ["-an"]),
                 "-t", f"{out_total:.7f}", "-movflags", "+faststart",
                 "-progress", "pipe:1", "-nostats", str(dst)]
        # stderr goes to a file so long filter errors cannot fill a pipe and hang.
        with open(Path(work) / "ffmpeg.log", "w+", encoding="utf-8") as error_log:
            proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=error_log, text=True)
            try:
                for line in proc.stdout:
                    if cancelled and cancelled():
                        raise JobCancelled()
                    if line.startswith("out_time_ms=") and progress:
                        done_s = int(line.split("=")[1]) / 1e6
                        floor = 60 if masked else 0
                        progress(min(99, floor + int((100-floor)*done_s/out_total)))
                if proc.wait() != 0:
                    error_log.seek(0)
                    raise RuntimeError("ส่งออกไม่สำเร็จ: " + error_log.read()[-1600:])
            except Exception:
                if proc.poll() is None:
                    proc.kill(); proc.wait()
                dst.unlink(missing_ok=True)
                raise
            finally:
                proc.stdout.close()
    if progress: progress(100)
    return str(dst)


def censor_region(
    video_path: str, rect: dict, style: str = "blur", strength: int = 12,
    start: float = 0.0, duration: float | None = None, cancelled=None,
) -> str:
    """เบิร์นเซ็นเซอร์ (เบลอ/โมเสก) ลงไฟล์จริงเฉพาะกรอบ rect ({x,y,w,h} สัดส่วน 0–1 ของเฟรม)
    เฉพาะช่วงเวลา start..start+duration (วินาที ในไทม์ไลน์ของไฟล์นี้) — นอกช่วงภาพเดิมไม่ถูกแตะ
    ประมวลผลทั้งไฟล์ (ไม่ตัด) เพื่อให้ inPoint ของก้อนบน timeline ยังใช้ได้เหมือนเดิม
    คืน path ไฟล์ mp4 ใหม่ใน _work/ (ต้นฉบับไม่ถูกแตะ)"""
    W, H = _probe_size(video_path)
    # แปลงสัดส่วน → พิกเซล (บังคับเลขคู่ ให้ตัวเข้ารหัส/สเกลไม่งอแง)
    cw = max(2, (int(rect["w"] * W) // 2) * 2)
    ch = max(2, (int(rect["h"] * H) // 2) * 2)
    cx = min(max(0, int(rect["x"] * W)), W - cw)
    cy = min(max(0, int(rect["y"] * H)), H - ch)
    px = max(1, int(strength))

    if style == "mosaic":
        # ย่อลงด้วย neighbor แล้วขยายกลับ → บล็อกพิกเซลคมแบบโมเสกจริง
        dw = max(1, cw // px)
        dh = max(1, ch // px)
        censor = f"scale={dw}:{dh}:flags=neighbor,scale={cw}:{ch}:flags=neighbor"
    else:
        # เบลอกล่อง — วนหลายรอบตามความแรงให้เนียนขึ้น
        censor = f"boxblur=luma_radius={px}:luma_power=2:chroma_radius={px}:chroma_power=1"

    # ช่วงเวลาที่ให้เซ็นเซอร์ทำงาน (นอกช่วงนี้ overlay ถูกปิด = ภาพเดิม)
    if duration is not None:
        enable = f":enable='between(t,{start:.3f},{start + duration:.3f})'"
    else:
        enable = ""
    fc = (
        f"[0:v]crop={cw}:{ch}:{cx}:{cy},{censor}[fg];"
        f"[0:v][fg]overlay={cx}:{cy}{enable}[v]"
    )

    work = Path("./_work").resolve()
    work.mkdir(exist_ok=True)
    suffix = f"_{int(start * 1000)}_{int((duration or 0) * 1000)}"
    dst = work / f"{Path(video_path).stem}_censor{suffix}.mp4"

    # stderr ต้องลงไฟล์ ห้าม PIPE ค้างไว้ — ffmpeg พ่น stats ต่อเนื่อง ถ้าไม่มีใครระบาย buffer เต็มแล้ว deadlock
    err_log = work / f"{Path(video_path).stem}_censor{suffix}.log"
    with open(err_log, "w", encoding="utf-8", errors="replace") as errf:
        proc = subprocess.Popen(
            [FFMPEG, "-y", "-nostats", "-loglevel", "error", "-i", video_path,
             "-filter_complex", fc, "-map", "[v]", "-map", "0:a:0?",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast",
             "-c:a", "copy", str(dst)],
            stdout=subprocess.DEVNULL, stderr=errf,
        )
        while proc.poll() is None:
            if cancelled and cancelled():
                proc.kill()
                proc.wait()
                raise JobCancelled()
            time.sleep(0.3)
    if proc.returncode != 0:
        tail = err_log.read_text(encoding="utf-8", errors="replace")[-800:]
        raise RuntimeError(f"เซ็นเซอร์ไม่สำเร็จ: {tail or 'ffmpeg ล้มเหลว'}")
    err_log.unlink(missing_ok=True)
    return str(dst)


def extract_audio(video_path: str, out_audio_path: str) -> bool:
    """ดึงเสียงออกมาเป็นไฟล์แยก คืน False ถ้าวิดีโอไม่มีเสียง"""
    cmd = [FFMPEG, "-y", "-i", video_path, "-vn", "-acodec", "aac", out_audio_path]
    result = subprocess.run(cmd, capture_output=True)
    return result.returncode == 0 and Path(out_audio_path).exists()


def rebuild_video(
    frames_dir: str,
    out_video_path: str,
    fps: float = 30.0,
    audio_path: str | None = None,
) -> None:
    """ต่อเฟรมกลับเป็นวิดีโอ ใส่เสียงกลับด้วยถ้ามี"""
    cmd = [
        FFMPEG, "-y",
        "-framerate", str(fps),
        "-i", f"{frames_dir}/frame_%06d.png",
    ]
    if audio_path and Path(audio_path).exists():
        cmd += ["-i", audio_path, "-map", "0:v", "-map", "1:a", "-c:a", "aac"]
    cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", out_video_path]
    subprocess.run(cmd, check=True, capture_output=True)


def reverse_video(video_path: str) -> str:
    """สร้างไฟล์ใหม่ที่เล่นถอยหลังทั้งภาพและเสียง (เอฟเฟคย้อนกลับ) — ผลลัพธ์อยู่ใน _work/
    หมายเหตุ: filter reverse ต้องอ่านทั้งไฟล์เข้าหน่วยความจำ คลิปยาวมากจะช้า/กินแรม"""
    out_dir = Path("./_work").resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{Path(video_path).stem}_reverse.mp4"
    src = Path(video_path)
    if out.exists() and src.exists() and out.stat().st_mtime >= src.stat().st_mtime:
        return str(out)  # ทำไว้แล้วและต้นฉบับไม่เปลี่ยน — ใช้ของเดิม

    def run(cmd):
        return subprocess.run(cmd, capture_output=True, text=True)

    base = [FFMPEG, "-y", "-i", video_path, "-vf", "reverse"]
    result = run(base + ["-af", "areverse", str(out)])
    if result.returncode != 0:
        # ไฟล์ไม่มีเสียง → areverse ล้ม ลองใหม่แบบภาพอย่างเดียว
        result = run(base + [str(out)])
    if result.returncode != 0:
        tail = "\n".join(result.stderr.strip().splitlines()[-3:])
        raise RuntimeError(f"reverse ล้มเหลว: {tail}")
    return str(out)


# ระดับความแรงของการลดสั่น: smoothing = ขนาดหน้าต่างเกลี่ยเส้นทางกล้อง (เฟรม)
# zoom = ซูมชดเชยกันขอบดำ — ยิ่งแรงภาพยิ่งนิ่งแต่ครอปขอบมากขึ้น
STAB_PRESETS = {
    "low": {"smoothing": 8, "zoom": 1.04},
    "medium": {"smoothing": 18, "zoom": 1.08},
    "high": {"smoothing": 35, "zoom": 1.13},
}


def stabilize_video(
    video_path: str, strength: str = "medium",
    start: float = 0.0, duration: float | None = None,
    progress=None, cancelled=None,
) -> str:
    """ลดสั่นแบบ 2-pass ด้วย OpenCV: pass1 track จุดเด่นหาการเคลื่อนกล้องต่อเฟรม →
    เกลี่ยเส้นทาง (moving average) → pass2 warp ชดเชย + ซูมกันขอบดำ เข้ารหัสผ่าน ffmpeg
    (เขียนเองแทน vid.stab เพราะ ffmpeg build ปัจจุบัน vidstabtransform แครชสุ่มบน Windows)
    progress(percent 0–100) / cancelled() → raise JobCancelled — ผลลัพธ์ mp4 ใน _work/ มี cache"""
    import cv2
    import numpy as np

    p = STAB_PRESETS.get(strength, STAB_PRESETS["medium"])
    out_dir = Path("./_work").resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    suffix = f"_{int(start * 1000)}_{int((duration or 0) * 1000)}" if duration else ""
    dst = out_dir / f"{Path(video_path).stem}_stab_{strength}{suffix}.mp4"
    src = Path(video_path)
    if dst.exists() and src.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
        if progress:
            progress(100)
        return str(dst)  # เคยทำ combo นี้แล้วและต้นฉบับไม่เปลี่ยน

    fps = get_video_fps(video_path)
    first_frame = int(start * fps)
    n_frames = int(duration * fps) if duration else None

    def open_at_start():
        cap = cv2.VideoCapture(video_path)
        if first_frame > 0:
            cap.set(cv2.CAP_PROP_POS_FRAMES, first_frame)
        return cap

    def check_cancel():
        if cancelled and cancelled():
            dst.unlink(missing_ok=True)
            raise JobCancelled()

    # ---- pass 1: หา dx,dy,da (เลื่อน+หมุน) ระหว่างเฟรมติดกัน ด้วย optical flow ----
    cap = open_at_start()
    ok, prev = cap.read()
    if not ok:
        raise RuntimeError("อ่านวิดีโอไม่ได้ — เช็คว่าไฟล์เปิดได้")
    h, w = prev.shape[:2]
    prev_gray = cv2.cvtColor(prev, cv2.COLOR_BGR2GRAY)
    total_guess = n_frames or int(cap.get(cv2.CAP_PROP_FRAME_COUNT) - first_frame) or 1
    transforms = []  # ต่อเฟรม: [dx, dy, da]

    while n_frames is None or len(transforms) < n_frames - 1:
        check_cancel()
        ok, cur = cap.read()
        if not ok:
            break
        cur_gray = cv2.cvtColor(cur, cv2.COLOR_BGR2GRAY)
        pts = cv2.goodFeaturesToTrack(
            prev_gray, maxCorners=200, qualityLevel=0.01, minDistance=24, blockSize=3
        )
        m = None
        if pts is not None and len(pts) >= 6:
            nxt, st, _ = cv2.calcOpticalFlowPyrLK(prev_gray, cur_gray, pts, None)
            good = st.reshape(-1) == 1
            if good.sum() >= 6:
                m, _ = cv2.estimateAffinePartial2D(pts[good], nxt[good])
        if m is None:
            transforms.append([0.0, 0.0, 0.0])  # หา feature ไม่ได้ (ฉากเรียบ/มืด) — ถือว่านิ่ง
        else:
            transforms.append([m[0, 2], m[1, 2], float(np.arctan2(m[1, 0], m[0, 0]))])
        prev_gray = cur_gray
        if progress and len(transforms) % 10 == 0:
            progress(min(49, int(len(transforms) / total_guess * 50)))
    cap.release()
    total = len(transforms) + 1

    # ---- เกลี่ยเส้นทางกล้าม (moving average) — ส่วนต่างจากเส้นเกลี่ยคือการสั่นที่ต้องชดเชย ----
    traj = np.cumsum(np.array(transforms or [[0, 0, 0]]), axis=0)
    win = min(p["smoothing"], max(2, len(traj)))
    kernel = np.ones(win) / win
    pad = win // 2
    smooth = np.empty_like(traj)
    for i in range(3):
        ext = np.concatenate([np.repeat(traj[0, i], pad), traj[:, i], np.repeat(traj[-1, i], pad)])
        smooth[:, i] = np.convolve(ext, kernel, mode="same")[pad:pad + len(traj)]
    correction = smooth - traj

    # ---- pass 2: warp ชดเชย + ซูมกันขอบดำ → ส่ง raw frame เข้า ffmpeg เข้ารหัส (เสียงจากไฟล์เดิม) ----
    zoom = p["zoom"]
    zoom_m = cv2.getRotationMatrix2D((w / 2, h / 2), 0, zoom)
    trim = (["-ss", f"{start:.3f}"] if start > 0 else []) + (
        ["-t", f"{duration:.3f}"] if duration else []
    )
    enc = subprocess.Popen(
        [FFMPEG, "-v", "error", "-y",
         "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}", "-r", f"{fps:.4f}", "-i", "-",
         *trim, "-i", video_path,
         "-map", "0:v", "-map", "1:a:0?",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "19", "-preset", "veryfast",
         "-c:a", "aac", "-shortest", str(dst)],
        stdin=subprocess.PIPE,
    )
    try:
        cap = open_at_start()
        for i in range(total):
            check_cancel()
            ok, frame = cap.read()
            if not ok:
                break
            dx, dy, da = correction[min(i, len(correction) - 1)] if i > 0 else (0.0, 0.0, 0.0)
            cos, sin = np.cos(da), np.sin(da)
            m = np.array([[cos, -sin, dx], [sin, cos, dy]], np.float32)
            warped = cv2.warpAffine(frame, m, (w, h), flags=cv2.INTER_LINEAR,
                                    borderMode=cv2.BORDER_REPLICATE)
            warped = cv2.warpAffine(warped, zoom_m, (w, h), flags=cv2.INTER_LINEAR)
            enc.stdin.write(warped.tobytes())
            if progress and i % 10 == 0:
                progress(min(99, 50 + int(i / total * 50)))
        cap.release()
        enc.stdin.close()
        if enc.wait() != 0:
            dst.unlink(missing_ok=True)
            raise RuntimeError("ลดสั่นล้มเหลว: ffmpeg เข้ารหัสไม่สำเร็จ")
    except JobCancelled:
        enc.kill()
        dst.unlink(missing_ok=True)
        raise
    if progress:
        progress(100)
    return str(dst)


def burn_subtitles(video_path: str, srt_path: str, out_video_path: str) -> None:
    """เผาซับไตเติลติดลงในวิดีโอถาวร (hardsub)"""
    cmd = [
        FFMPEG, "-y", "-i", video_path,
        "-vf", f"subtitles={srt_path}",
        "-c:a", "copy", out_video_path,
    ]
    subprocess.run(cmd, check=True, capture_output=True)
