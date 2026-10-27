import React, { useEffect, useMemo, useRef, useState } from "react";
import { Lock, Eye, Volume2, VolumeX, Mic, Repeat, ZoomIn, ZoomOut, SquareSplitHorizontal, Type, AudioLines, LayoutTemplate, Loader2, Clapperboard, Unlink } from "lucide-react";

function formatTC(seconds, fps = 30) {
  const s = Math.max(0, Math.floor(seconds));
  const f = Math.floor((Math.max(0, seconds) % 1) * fps);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60, f]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

// แบ่ง ruler เป็นช่วงสวยๆ (1/2/5/10/15/30/60s ...) ให้ขีดห่างกันราวๆ 110px ตามสเกลจริง
function rulerMarks(duration, pxPerSec) {
  if (!duration || !pxPerSec) return [];
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const step = steps.find((s) => s * pxPerSec >= 110) ?? 1200;
  const marks = [];
  for (let t = 0; t <= duration; t += step) marks.push(t);
  return marks;
}

// โหลดเสียงจากไฟล์วิดีโอ (ผ่าน media://) แล้วย่อเป็น peak ต่อ pixel สำหรับวาด waveform
async function loadPeaks(url, buckets = 600) {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const audio = await ctx.decodeAudioData(buf);
    const data = audio.getChannelData(0); // ใช้ channel ซ้ายพอสำหรับพรีวิว
    const per = Math.max(1, Math.floor(data.length / buckets));
    const peaks = new Float32Array(buckets);
    for (let i = 0; i < buckets; i++) {
      let max = 0;
      const start = i * per;
      const end = Math.min(start + per, data.length);
      for (let j = start; j < end; j += 16) {
        const v = Math.abs(data[j]);
        if (v > max) max = v;
      }
      peaks[i] = max;
    }
    return peaks;
  } finally {
    ctx.close();
  }
}

// cache peaks ต่อไฟล์ — ลากไฟล์เดิมมาซ้ำไม่ต้อง decode ใหม่
const peaksCache = new Map();
function getPeaks(url) {
  if (!peaksCache.has(url)) peaksCache.set(url, loadPeaks(url));
  return peaksCache.get(url);
}

// สร้าง filmstrip: จับภาพเฟรมกระจายทั่วคลิปจาก <video> ลง canvas (ทำครั้งเดียวต่อไฟล์)
async function makeFilmstrip(url) {
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = url;
  await new Promise((res, rej) => {
    video.onloadeddata = res;
    video.onerror = rej;
  });
  const dur = video.duration || 0;
  // คลิปยาวจับถี่ขึ้น (~ทุก 8 วิ) แต่ไม่เกิน 40 ภาพ ไม่ต่ำกว่า 10
  const count = Math.min(40, Math.max(10, Math.round(dur / 8)));
  const H = 160; // ความละเอียดต่อภาพสูงพอให้ซูม/แถวสูงแล้วยังคม
  const W = Math.round(H * ((video.videoWidth / video.videoHeight) || 16 / 9));
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const thumbs = [];
  for (let i = 0; i < count; i++) {
    await new Promise((res) => {
      video.onseeked = res;
      video.currentTime = ((i + 0.5) / count) * dur;
    });
    ctx.drawImage(video, 0, 0, W, H);
    thumbs.push(canvas.toDataURL("image/jpeg", 0.8));
  }
  video.removeAttribute("src");
  // ส่งสัดส่วนภาพไปด้วย — วิดีโอแนวตั้งช่องจะแคบตามจริง เห็นเต็มเฟรมไม่โดนครอบ
  return { thumbs, aspect: W / H };
}

const stripCache = new Map();
function getFilmstrip(url) {
  if (!stripCache.has(url)) stripCache.set(url, makeFilmstrip(url));
  return stripCache.get(url);
}

/** แถบภาพเฟรมในก้อนคลิปวิดีโอ — โชว์ช่วง start–end (สัดส่วน 0–1 ของไฟล์ต้นฉบับ)
 *  จำนวนช่องภาพขึ้นกับความกว้างจริงบนจอ (ช่องละ ~สัดส่วน 16:9 ของความสูงแถว)
 *  ซูมเข้า → ก้อนกว้างขึ้น → ช่องเพิ่มขึ้น → แต่ละช่องแทนช่วงเวลาละเอียดขึ้นเรื่อยๆ */
function Filmstrip({ url, start = 0, end = 1 }) {
  const ref = useRef(null);
  const [strip, setStrip] = useState(null); // {thumbs, aspect}
  const [dims, setDims] = useState({ w: 0, h: 0 });

  useEffect(() => {
    let on = true;
    getFilmstrip(url)
      .then((s) => on && setStrip(s))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [url]);

  // วัดขนาดจริงของก้อน (เปลี่ยนตามซูม/ปรับพาเนล) แล้วคำนวณจำนวนช่องใหม่
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setDims({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  let tiles = [];
  let tileW = 0;
  if (strip && dims.w > 0 && dims.h > 0) {
    const { thumbs, aspect } = strip;
    // ช่องกว้างตามสัดส่วนจริงของวิดีโอ — แนวตั้งช่องแคบ เห็นเต็มเฟรมทั้งภาพ
    tileW = Math.max(12, dims.h * aspect);
    const n = Math.max(1, Math.ceil(dims.w / tileW));
    tileW = dims.w / n; // เกลี่ยให้เต็มก้อนพอดี
    tiles = Array.from({ length: n }, (_, i) => {
      // เวลาที่ตำแหน่งกึ่งกลางช่องนี้ (สัดส่วนในไฟล์ต้นฉบับ) → หยิบเฟรมที่ใกล้สุด
      const frac = start + ((i + 0.5) / n) * (end - start);
      return thumbs[Math.min(thumbs.length - 1, Math.floor(frac * thumbs.length))];
    });
  }

  return (
    <div className="filmstrip" ref={ref}>
      {tiles.map((src, i) => (
        <img key={i} src={src} alt="" draggable={false} style={{ width: tileW }} />
      ))}
    </div>
  );
}

/** ไทม์ไลน์หลัก — sequence: [{id, name, url, offset, duration}] เรียงต่อกันบน V1/A1
 *  time/duration: วินาทีบนแกนรวม, onSeek(t), tool: "select"|"razor"|... */
export default function Timeline({
  sequence = [],
  time = 0,
  duration = 0,
  onSeek,
  onMute,
  tool = "select",
  copyStyleArmed = false, // เครื่องมือก็อปสไตล์ดูดสไตล์ไว้แล้ว (พร้อมทับ) — ใช้เปลี่ยนเคอร์เซอร์
  onResetCopyStyle, // คลิกขวาระหว่างใช้เครื่องมือ = ล้างสไตล์ที่ดูด เริ่มดูดใหม่
  onDropTemplate, // ปล่อยเทมเพลตข้อความลง timeline (json, atSeconds) → สร้างก้อนใหม่
  onApplyTemplate, // ปล่อยเทมเพลตทับก้อน text เดิม (clipId, json)
  onRangeChange,
  onDropClip,
  onDropMedia,
  onDropMediaIntoScene,
  onMoveTextIntoScene,
  onUpdateSceneChild,
  playing = false,
  onSplit,
  onSplitAt,
  onDetachAudio,
  onMergeSelected,
  selectedIds = [],
  merging = false,
  mergePct = 0,
  onDeleteRange, // ลบช่วงโซนน้ำเงิน (start, end, ripple)
  onMoveClip,
  onResizeClip,
  selectedId,
  onSelectClip,
  onAddLayout, // ปุ่มสั่งงานทันที (ไม่ใช่โหมดเครื่องมือ) — เปิด popup แบ่งฉาก
  onAddText, // แทรกก้อนข้อความตรงเส้น playhead
  onAddScene, // แทรกก้อน Scene (วิดีโอเปล่าพื้นดำ) ตรงเส้น playhead
}) {
  // ช่วงที่เลือกไว้ตัด (โหมด Razor): {start, end} หน่วยวินาที
  const [cutRange, setCutRange] = useState(null);

  // ติ๊กอยู่ = เล่นวนเฉพาะในช่วงที่เลือก / เอาออก = เล่นทะลุช่วงได้
  const [loopRange, setLoopRange] = useState(true);

  // แจ้งช่วงที่เลือกขึ้นไปให้ App → Monitor เล่นเฉพาะช่วงนี้ (เฉพาะตอนเปิด loop)
  useEffect(() => {
    onRangeChange?.(loopRange ? cutRange : null);
  }, [cutRange, loopRange]);

  // กด Esc เพื่อยกเลิกช่วงที่เลือก
  useEffect(() => {
    if (!cutRange) return;
    const onKey = (e) => e.key === "Escape" && setCutRange(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cutRange]);

  // เมนูคลิกขวาบนโซนน้ำเงิน: {x, y} พิกัดจอ — คลิกที่อื่น/Esc = ปิด
  const [rangeMenu, setRangeMenu] = useState(null);
  useEffect(() => {
    if (!rangeMenu) return;
    const close = () => setRangeMenu(null);
    const onKey = (e) => e.key === "Escape" && close();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [rangeMenu]);
  const openRangeMenu = (e) => {
    if (!cutRange) return; // ยังไม่มีโซน — ปล่อยคลิกขวาปกติ
    e.preventDefault();
    e.stopPropagation();
    setRangeMenu({ x: e.clientX, y: e.clientY });
  };

  // สถานะ mute รายแทร็กเสียง — เสียงคลิปอยู่บน A1 ดังนั้น mute A1 = ปิดเสียงวิดีโอ
  const [mutedTracks, setMutedTracks] = useState({});
  const toggleMute = (id) => {
    setMutedTracks((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      if (id === "A1") onMute?.(!!next.A1);
      return next;
    });
  };

  const playheadPct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;

  // ---- สเกลเวลาคงที่ + pan: คลิปยาวเท่าไหนก็กินพื้นที่ตามจริง ล้นจอแล้วเลื่อนดูเอา ----
  // 2px/วินาที ≈ นาทีละ 120px → เริ่มต้นเห็นเป็นสเกลนาที (ซูมเข้าไปตัดละเอียดได้)
  const BASE_PX_PER_SEC = 2;
  const [zoom, setZoom] = useState(1);
  const [scrollX, setScrollX] = useState(0); // px ที่เลื่อนไปทางขวา
  const viewportRef = useRef(null); // วัดความกว้างจอ timeline จาก ruler

  const viewportW = () => viewportRef.current?.getBoundingClientRect().width ?? 0;
  // เนื้อหากว้างตามความยาวจริงของ sequence (ไม่บีบให้พอดีจอ) แต่ไม่แคบกว่าจอ
  const contentW = (z = zoom) => Math.max(viewportW(), duration * BASE_PX_PER_SEC * z);
  const maxScroll = (z = zoom) => Math.max(0, contentW(z) - viewportW());
  const clampScroll = (s, z = zoom) => Math.min(Math.max(s, 0), maxScroll(z));

  const setZoomKeepCenter = (nextZoom) => {
    const z = Math.min(Math.max(nextZoom, 0.1), 16);
    const vw = viewportW();
    // ขยาย/ย่อโดยยึดจุดกึ่งกลางจอไว้ที่เดิม
    const ratio = contentW(z) / contentW(zoom);
    setScrollX((s) => clampScroll((s + vw / 2) * ratio - vw / 2, z));
    setZoom(z);
  };

  // style ของเนื้อหาที่ยืดตามความยาวจริง (ใช้ทั้ง ruler และทุก lane)
  const contentStyle = {
    width: duration > 0 ? `${contentW()}px` : "100%",
    transform: `translateX(${-scrollX}px)`,
  };

  // sequence ยาวขึ้น/สั้นลง → กันไม่ให้ scroll ค้างเกินขอบ
  useEffect(() => {
    setScrollX((s) => clampScroll(s));
  }, [duration, zoom]);

  const marks = useMemo(
    () => rulerMarks(duration, BASE_PX_PER_SEC * zoom),
    [duration, zoom]
  );

  // กำลังลากอะไรอยู่บน timeline (scrub/razor/pan/ขอบช่วง) — ใช้ปิด auto-follow
  const draggingRef = useRef(false);

  // auto-follow แบบ "เทปเลื่อน": ระหว่างเล่นอยู่เท่านั้น — playhead เลย ~80% ของจอ
  // จะตรึงเส้นไว้ตรงนั้นแล้วเลื่อนเนื้อหาไหลตามทุกเฟรม ไม่มีเด้งข้ามหน้า
  // หยุดเล่น/กำลังลากอยู่ = จอนิ่งสนิท ไม่ขยับเองเด็ดขาด
  useEffect(() => {
    if (!duration || !playing || draggingRef.current) return;
    const vw = viewportW();
    if (!vw) return;
    const px = (time / duration) * contentW();
    const pin = vw * 0.8;
    if (px > scrollX + pin) {
      setScrollX(clampScroll(px - pin)); // เลื่อนเทปตาม เส้นค้างที่ 80% ของจอ
    } else if (px < scrollX) {
      setScrollX(clampScroll(px - vw * 0.2)); // เส้นอยู่หลังขอบซ้าย → ดึงกลับมาเห็น
    }
  }, [time, playing]);

  // รับคลิปที่ลากมาจาก ProjectPanel — วางลงเลนไหนไปแทร็กนั้น (V1 หลัก / V2 ซ้อน PiP)
  // handler นี้อยู่ที่ container เป็น fallback (วางนอกเลน = V1)
  const makeDropProps = (track = 1) => ({
    onDragOver: (e) => {
      if (
        e.dataTransfer.types.includes("application/x-clip-path") ||
        e.dataTransfer.types.includes("application/x-media-path") ||
        e.dataTransfer.types.includes("application/x-text-template")
      )
        e.preventDefault();
    },
    onDrop: (e) => {
      const path = e.dataTransfer.getData("application/x-clip-path");
      const mediaPath = e.dataTransfer.getData("application/x-media-path");
      const tpl = e.dataTransfer.getData("application/x-text-template");
      if (tpl) {
        // เทมเพลตข้อความ: สร้างก้อน text ใหม่ตรงตำแหน่งที่ปล่อย (คงสไตล์+ตำแหน่ง/ขนาดตามเทมเพลต)
        e.preventDefault();
        e.stopPropagation();
        const laneEl =
          e.currentTarget.querySelector(".lane-content") ??
          e.currentTarget.closest(".track-lane")?.querySelector(".lane-content");
        const at = laneEl && duration > 0 ? timeAt(e.clientX, laneEl.getBoundingClientRect()) : 0;
        try {
          onDropTemplate?.(JSON.parse(tpl), at);
        } catch {}
        return;
      }
      if (path || mediaPath) {
        e.preventDefault();
        e.stopPropagation(); // ไม่ให้ container fallback รับซ้ำ
        if (path) {
          onDropClip?.(path, track);
        } else {
          // รูป/เสียง: วาง "ตรงตำแหน่งที่ปล่อยเมาส์" — เอารูปไปทับช่วงเฟรมที่ต้องการได้เป๊ะๆ
          const laneEl =
            e.currentTarget.querySelector(".lane-content") ??
            e.currentTarget.closest(".track-lane")?.querySelector(".lane-content");
          const at =
            laneEl && duration > 0
              ? timeAt(e.clientX, laneEl.getBoundingClientRect())
              : 0;
          onDropMedia?.(mediaPath, track, at);
        }
      }
    },
  });
  const dropProps = makeDropProps(1);

  const timeAt = (clientX, rect) => {
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    return ratio * duration;
  };

  const dragWith = (onMove, onDone) => {
    const move = (ev) => {
      // ปล่อยปุ่มนอกหน้าต่าง → mouseup ไม่มาถึง เช็คจากสถานะปุ่มจริงแทน
      if (ev.buttons === 0) {
        onUp();
        return;
      }
      onMove(ev);
    };
    const onUp = () => {
      draggingRef.current = false;
      document.body.classList.remove("scrubbing");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", onUp);
      onDone?.();
    };
    draggingRef.current = true;
    document.body.classList.add("scrubbing");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("blur", onUp);
  };

  // กดค้างบน lane/ruler:
  //  - โหมดปกติ: ลาก scrub playhead
  //  - โหมด Razor: ลากคลุมพื้นที่ → ได้เส้น in/out สองเส้นไว้ตัด
  //  - โหมด Hand: ลากเลื่อนดูส่วนที่ล้นจอ (playhead อยู่ที่เดิม ไม่ seek)
  const seekFromEvent = (e) => {
    if (!duration) return;
    if (e.button !== 0) return; // เฉพาะคลิกซ้าย — คลิกขวามีหน้าที่เปิดเมนูโซน ไม่ใช่ scrub/ผ่าคลิป
    e.preventDefault();

    if (tool === "hand") {
      const startX = e.clientX;
      const startScroll = scrollX;
      dragWith((ev) => setScrollX(clampScroll(startScroll - (ev.clientX - startX))));
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();

    if (tool === "razor") {
      // เครื่องมือเลือกโซน: ลากค้าง = สร้างโซนน้ำเงิน / จิ้มเฉยๆ = ล้างโซนเดิม (ไม่ตัดอะไรเด็ดขาด
      // การผ่าคลิปใช้ปุ่ม ┆ บน toolbar หรือเมนูคลิกขวาของโซนเท่านั้น)
      const anchor = timeAt(e.clientX, rect);
      const startX = e.clientX;
      let moved = false;
      dragWith(
        (ev) => {
          if (!moved && Math.abs(ev.clientX - startX) < 4) return;
          moved = true;
          const t = timeAt(ev.clientX, rect);
          setCutRange({ start: Math.min(anchor, t), end: Math.max(anchor, t) });
        },
        () => {
          if (!moved) setCutRange(null); // จิ้มโดยไม่ลาก = ยกเลิกโซนที่ค้างอยู่
        }
      );
      return;
    }

    if (!onSeek) return;
    onSelectClip?.(null); // คลิกพื้นว่าง = ยกเลิกเลือกก้อน
    onSeek(timeAt(e.clientX, rect));
    dragWith((ev) => onSeek(timeAt(ev.clientX, rect)));
  };

  // จับเส้นขอบ in/out ลากปรับช่วงทีหลังได้ (ยึด rect ของ lane แม่)
  const dragEdge = (e, edge) => {
    e.stopPropagation();
    e.preventDefault();
    const laneEl = e.currentTarget.closest(".lane-content, .ruler-marks");
    if (!laneEl || !duration) return;
    const rect = laneEl.getBoundingClientRect();
    dragWith((ev) => {
      const t = timeAt(ev.clientX, rect);
      setCutRange((r) => {
        if (!r) return r;
        const next = { ...r, [edge]: t };
        return { start: Math.min(next.start, next.end), end: Math.max(next.start, next.end) };
      });
    });
  };

  // ---- ลากก้อนคลิปย้ายตำแหน่ง (เครื่องมือ Selection) — เว้นช่องว่างได้ ----
  const snap = true; // snap เปิดตลอด (เอาปุ่มแม่เหล็กออกแล้ว)
  const [showNames, setShowNames] = useState(true); // โชว์ชื่อไฟล์บนก้อนคลิป
  const [showAudio, setShowAudio] = useState(true); // โชว์ก้อนเสียงบนแทร็ก A

  // ตำแหน่งล่าสุดของทุกคลิป — ระหว่างลาก App อาจดันก้อนอื่นขยับ ต้องอ่านค่าปัจจุบันเสมอ
  const seqRef = useRef(sequence);
  seqRef.current = sequence;

  // ก้อนที่กำลังถูกลากอยู่: {id, offset} — วาด override ตำแหน่งให้ลอยตามเมาส์
  const [dragging, setDragging] = useState(null);

  // เมนูคลิกขวาบนก้อนที่ติดเลือกไว้ (โหมดเลือกหลายท่อน): {x, y} | null
  const [clipMenu, setClipMenu] = useState(null);
  useEffect(() => {
    if (!clipMenu) return;
    const close = () => setClipMenu(null);
    const onKey = (e) => e.key === "Escape" && close();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [clipMenu]);

  // คลิกขวาก้อนที่ติดเลือกอยู่ → เปิดเมนูรวมท่อน (ก้อนอื่นปล่อยให้เมนูโซนเดิมทำงาน)
  const onClipContextMenu = (e, clip) => {
    if (!selectedIds.includes(clip.id)) return;
    e.preventDefault();
    e.stopPropagation();
    setClipMenu({ x: e.clientX, y: e.clientY });
  };

  // snap อย่างเดียว (ไม่กันทับ): ขอบดูดเข้า 0 / ขอบคลิปอื่น / playhead
  const snapOffset = (o, clip, pxPerSec) => {
    if (snap && pxPerSec > 0) {
      const others = seqRef.current.filter((c) => c.id !== clip.id);
      const L = clip.duration;
      const tol = 8 / pxPerSec; // ระยะดูด ~8px แปลงเป็นวินาที
      const targets = [0, time, ...others.flatMap((c) => [c.offset, c.offset + c.duration])];
      for (const t of targets) {
        if (Math.abs(o - t) < tol) o = t; // ขอบซ้ายดูดเข้าเป้า
        else if (Math.abs(o + L - t) < tol) o = t - L; // ขอบขวาดูดเข้าเป้า
      }
    }
    return Math.max(0, o);
  };

  // ลากก้อน: ระหว่างลากลอยตามเมาส์อิสระ (ทับกันชั่วคราวได้) — ปล่อยเมาส์ค่อยวางจริง
  // ลากขึ้น-ลงข้ามเลน V1↔V2 ได้ด้วย (ดูจากเลนที่เมาส์ชี้อยู่) — ก้อนย้ายเลนตามมือทันที
  // การชน/ดัน/สลับ จัดการที่ App.moveClip ตอน drop ทีเดียว
  const trackAtPoint = (x, y, fallback) => {
    for (const el of document.elementsFromPoint(x, y)) {
      const t = el.dataset?.track;
      if (t) return Number(t);
    }
    return fallback;
  };

  const startClipDrag = (e, clip) => {
    if (e.button !== 0) return; // เฉพาะคลิกซ้าย
    // เครื่องมือก็อปสไตล์: คลิกก้อนเพื่อดูด/ทับสไตล์ (App จัดการเอง) — ไม่ลากย้าย
    if (tool === "copystyle") {
      e.stopPropagation();
      e.preventDefault();
      onSelectClip?.(clip);
      return;
    }
    // เครื่องมือเลือกหลายท่อน: คลิก = ติด/ปลดเลือกสะสม (App จัดการ) — ไม่ลากย้าย
    if (tool === "multi") {
      e.stopPropagation();
      e.preventDefault();
      onSelectClip?.(clip);
      return;
    }
    if (tool !== "select" || !onMoveClip || !duration) return;
    e.stopPropagation(); // ไม่ให้ lane ข้างใต้จับไป scrub
    e.preventDefault();
    onSelectClip?.(clip); // คลิก = เลือกก้อนนี้ (โชว์คุณสมบัติใน Properties)
    if (clip.locked) return; // ก้อนล็อคอยู่: เลือกได้แต่ลากไม่ได้
    const pxPerSec = contentW() / duration; // ล็อคสเกลไว้ตอนเริ่มลาก กัน jitter ตอน duration ยืด
    const startX = e.clientX;
    const startOffset = clip.offset;
    const startTrack = clip.track || 1;
    // ข้อความอยู่ V3 หรือเลน FX / ก้อนแบ่งฉากอยู่เลน FX1↔FX2 (ซ้อนสองเอฟเฟกต์พร้อมกันได้) / วิดีโอย้ายได้ V1↔V2↔V3
    const allowedTracks =
      clip.type === "text" ? [3, 4, 5]
        : clip.type === "layout" ? [4, 5]
          : clip.type === "scene" ? [1] // Scene เป็นฐานพื้นดำ อยู่ V1 เท่านั้น
            : [1, 2, 3];
    let lastOffset = startOffset;
    let lastTrack = startTrack;
    let lastPointer = { x: e.clientX, y: e.clientY };
    dragWith(
      (ev) => {
        lastPointer = { x: ev.clientX, y: ev.clientY };
        lastOffset = snapOffset(startOffset + (ev.clientX - startX) / pxPerSec, clip, pxPerSec);
        const t = trackAtPoint(ev.clientX, ev.clientY, lastTrack);
        if (allowedTracks.includes(t)) lastTrack = t;
        setDragging({ id: clip.id, offset: lastOffset, track: lastTrack });
      },
      () => {
        setDragging(null);
        // ก้อนข้อความที่กำลังลากอาจบัง Scene อยู่ จึงไล่ทุก element ใต้ pointer
        const sceneEl = document.elementsFromPoint(lastPointer.x, lastPointer.y)
          .map((el) => el.closest?.(".scene-block"))
          .find(Boolean);
        if (clip.type === "text" && sceneEl?.dataset.sceneId) {
          onMoveTextIntoScene?.(sceneEl.dataset.sceneId, clip.id);
          return;
        }
        if (lastOffset !== startOffset || lastTrack !== startTrack)
          onMoveClip(clip.id, lastOffset, lastTrack);
      }
    );
  };

  // ลากขอบซ้าย/ขวาของก้อนข้อความ (V3) เพื่อยืด-หดช่วงเวลาแสดง
  const startTrimDrag = (e, clip, edge) => {
    if (e.button !== 0) return; // เฉพาะคลิกซ้าย
    e.stopPropagation();
    e.preventDefault();
    if (!onResizeClip || !duration) return;
    const pxPerSec = contentW() / duration; // ล็อคสเกลตอนเริ่ม กัน jitter ตอน duration รวมยืด
    const startX = e.clientX;
    const o0 = clip.offset;
    const d0 = clip.duration;
    dragWith((ev) => {
      const dt = (ev.clientX - startX) / pxPerSec;
      if (edge === "right") {
        onResizeClip(clip.id, { duration: Math.max(0.5, d0 + dt) });
      } else {
        const no = Math.min(o0 + d0 - 0.5, Math.max(0, o0 + dt));
        onResizeClip(clip.id, { offset: no, duration: d0 + (o0 - no) });
      }
    });
  };

  // แปลง sequence → ก้อนคลิปบน V1/A1 ตามตำแหน่งจริง
  // ก้อนที่กำลังลากใช้ตำแหน่งจากเมาส์แทน (ลอยตามมือ ทับก้อนอื่นชั่วคราวได้)
  const blocks = duration > 0
    ? sequence.map((c) => {
        const isDragging = dragging?.id === c.id;
        const offset = isDragging ? dragging.offset : c.offset;
        return {
          ...c,
          track: isDragging ? dragging.track : c.track || 1, // ระหว่างลากย้ายเลนตามเมาส์
          isDragging,
          isSelected: selectedId === c.id || selectedIds.includes(c.id),
          leftPct: (offset / duration) * 100,
          widthPct: (c.duration / duration) * 100,
        };
      })
    : [];

  const pictureBlocks = blocks.filter((c) => c.type !== "audio");
  const standaloneAudio = blocks.filter((c) => c.type === "audio");
  const v1blocks = pictureBlocks.filter((c) => (c.track || 1) === 1);
  const v2blocks = pictureBlocks.filter((c) => c.track === 2);
  const v3blocks = pictureBlocks.filter((c) => c.track === 3); // ข้อความ (ปุ่ม T) + วิดีโอชั้นบนสุด
  const fxblocks = blocks.filter((c) => c.track === 4); // เลน FX1: ก้อนแบ่งฉาก / ข้อความ
  const fx2blocks = blocks.filter((c) => c.track === 5); // เลน FX2: ซ้อนเอฟเฟกต์ที่สองช่วงเวลาเดียวกันได้

  const videoTracks = [
    { id: "V3", clips: v3blocks, laneTrack: 3, dropTrack: 3 },
    { id: "V2", clips: v2blocks, laneTrack: 2, dropTrack: 2 },
    { id: "V1", clips: v1blocks, laneTrack: 1, dropTrack: 1 },
  ];
  const audioTracks = [
    // ก้อน Scene ไม่มีเสียง — ไม่ต้องโชว์บนเลนเสียง
    { id: "A1", clips: showAudio ? [...v1blocks.filter((c) => c.type !== "scene" && !c.audioDetached), ...standaloneAudio.filter((c) => (c.track || 1) === 1)] : [], waveform: true, laneTrack: 1, dropTrack: 1 },
    // รูปภาพไม่มีเสียง — ไม่ต้องโชว์บนเลนเสียง
    { id: "A2", clips: showAudio ? [...v2blocks.filter((c) => c.type !== "image" && !c.audioDetached), ...standaloneAudio.filter((c) => c.track === 2)] : [], waveform: true, laneTrack: 2, dropTrack: 2 },
    // A3 = เสียงของวิดีโอบน V3 (ก้อนข้อความ/รูปไม่มีเสียง ไม่ต้องโชว์)
    { id: "A3", clips: showAudio ? [...v3blocks.filter((c) => c.type !== "text" && c.type !== "image" && !c.audioDetached), ...standaloneAudio.filter((c) => c.track === 3)] : [], waveform: true, laneTrack: 3, dropTrack: 3 },
  ];

  const rangePct =
    cutRange && duration > 0
      ? {
          left: (cutRange.start / duration) * 100,
          width: ((cutRange.end - cutRange.start) / duration) * 100,
        }
      : null;

  const copyStyleCls =
    tool === "copystyle" ? (copyStyleArmed ? "copystyle-paste" : "copystyle-pick") : "";

  return (
    <div
      className={`timeline-panel ${tool === "razor" ? "razor-mode" : ""} ${tool === "hand" ? "hand-mode" : ""} ${copyStyleCls}`}
      onContextMenu={(e) => {
        // คลิกขวาระหว่างใช้เครื่องมือก็อปสไตล์ = ล้างที่ดูดไว้ กลับไปโหมด "ดูด" ใหม่
        if (tool === "copystyle") {
          e.preventDefault();
          onResetCopyStyle?.();
        }
      }}
    >
      <div className="timeline-toolbar">
        <span className="tc tc-current">{formatTC(time)}</span>
        {cutRange && (
          <>
            <span className="tc cut-range-label">
              ✂ {formatTC(cutRange.start).slice(3, 8)} – {formatTC(cutRange.end).slice(3, 8)}
            </span>
            <button
              className={`icon-btn tiny ${loopRange ? "active" : ""}`}
              title={loopRange ? "เล่นวนในช่วงอยู่ — กดเพื่อปลดให้เล่นออกนอกช่วงได้" : "กดเพื่อเล่นวนเฉพาะในช่วง"}
              onClick={() => setLoopRange((v) => !v)}
            >
              <Repeat size={13} />
            </button>
            <button
              className="icon-btn tiny cut-range-clear"
              title="ออกจากช่วงที่เลือก (Esc)"
              onClick={() => setCutRange(null)}
            >
              ✕
            </button>
          </>
        )}
        <button
          className={`icon-btn ${showNames ? "active" : ""}`}
          title={showNames ? "ซ่อนชื่อวิดีโอบนก้อนคลิป" : "แสดงชื่อวิดีโอบนก้อนคลิป"}
          onClick={() => setShowNames((v) => !v)}
        >
          <Type size={13} />
        </button>
        <button
          className={`icon-btn ${showAudio ? "active" : ""}`}
          title={showAudio ? "ซ่อนก้อนเสียง (แทร็ก A)" : "แสดงก้อนเสียง (แทร็ก A)"}
          onClick={() => setShowAudio((v) => !v)}
        >
          <AudioLines size={13} />
        </button>
        <span className="toolbar-spacer" />
        <button
          className="icon-btn split-btn"
          title="แบ่งคลิปเป็นสองท่อนตรงเส้น playhead"
          onClick={onSplit}
          disabled={!duration}
        >
          <SquareSplitHorizontal size={13} />
        </button>
        <button
          className="icon-btn"
          title="แยกเสียงออกจากวิดีโอ"
          onClick={() => onDetachAudio?.(selectedId)}
          disabled={!selectedId || !sequence.some((c) => c.id === selectedId && !["audio", "image", "text", "scene"].includes(c.type) && !c.audioDetached)}
        >
          <Unlink size={13} />
        </button>
        {/* สถานะรวมท่อน (สั่งจากคลิกขวาในโหมดเลือกหลายท่อน) */}
        {merging && (
          <span className="tc dim">
            <Loader2 size={12} className="spin" style={{ verticalAlign: -2 }} /> รวมท่อน {mergePct}%
          </span>
        )}
        <span className="toolbar-divider" />
        {/* ปุ่มสั่งงานทันที (แทรกก้อนลง timeline) — อยู่ฝั่งขวา ถัดจากปุ่มแบ่งคลิป */}
        <button className="icon-btn" title="แบ่งฉาก (Split Screen)" onClick={onAddLayout}>
          <LayoutTemplate size={13} />
        </button>
        {/* Scene: ก้อนวิดีโอเปล่าพื้นดำ — ฐานสำหรับวางรูป/ข้อความ/เสียงประกอบฉากเอง */}
        <button
          className="icon-btn"
          title="Scene — แทรกก้อนวิดีโอเปล่า (พื้นหลังดำ) ตรงเส้น playhead ยืด/หด/เลื่อนได้เหมือนคลิปปกติ"
          onClick={onAddScene}
        >
          <Clapperboard size={13} />
        </button>
        <button className="icon-btn" title="ข้อความ (T) — แทรกก้อนข้อความตรงเส้น playhead" onClick={onAddText}>
          <Type size={13} />
        </button>
        <span className="toolbar-divider" />
        <button className="icon-btn" title="ซูมออก" onClick={() => setZoomKeepCenter(zoom / 1.5)} disabled={zoom <= 0.1}>
          <ZoomOut size={13} />
        </button>
        <span className="zoom-label">{`${zoom.toFixed(1)}x`}</span>
        <button className="icon-btn" title="ซูมเข้า" onClick={() => setZoomKeepCenter(zoom * 1.5)} disabled={zoom >= 16}>
          <ZoomIn size={13} />
        </button>
      </div>

      <div className="timeline-body">
        <div className="timeline-ruler">
          <div className="ruler-spacer" />
          <div className="ruler-viewport" ref={viewportRef}>
            <div className="ruler-marks" style={contentStyle} onMouseDown={seekFromEvent}>
              {marks.length ? (
                marks.map((t) => (
                  <span
                    key={t}
                    className={`ruler-mark${t === duration ? " ruler-mark-end" : ""}`}
                    style={{ left: `${(t / duration) * 100}%` }}
                  >
                    {formatTC(t).slice(0, 8)}
                  </span>
                ))
              ) : (
                <span>00:00:00</span>
              )}
              <RangeOverlay rangePct={rangePct} onDragEdge={dragEdge} onMenu={openRangeMenu} />
              <div className="timeline-playhead" style={{ left: `${playheadPct}%` }} />
            </div>
          </div>
        </div>

        <div
          className="timeline-tracks"
          {...dropProps}
          onWheel={(e) => {
            // ล้อเมาส์เลื่อนแกนเวลาได้ตอนซูมอยู่
            if (zoom > 1) setScrollX((s) => clampScroll(s + e.deltaY + e.deltaX));
          }}
        >
          {videoTracks.map((t) => (
            <TrackRow
              key={t.id}
              track={t}
              kind="video"
              playheadPct={playheadPct}
              onSeek={seekFromEvent}
              rangePct={rangePct}
              onDragEdge={dragEdge}
              onRangeMenu={openRangeMenu}
              contentStyle={contentStyle}
              onClipMouseDown={startClipDrag}
              onClipContextMenu={onClipContextMenu}
              draggableClips={tool === "select"}
              showNames={showNames}
              dropProps={t.dropTrack ? makeDropProps(t.dropTrack) : undefined}
              onTrimMouseDown={startTrimDrag}
              onApplyTemplate={onApplyTemplate}
              onDropMediaIntoScene={onDropMediaIntoScene}
              selectedId={selectedId}
              onUpdateSceneChild={onUpdateSceneChild}
            />
          ))}
          {audioTracks.map((t) => (
            <TrackRow
              key={t.id}
              track={t}
              kind="audio"
              playheadPct={playheadPct}
              onSeek={seekFromEvent}
              muted={!!mutedTracks[t.id]}
              onToggleMute={() => toggleMute(t.id)}
              rangePct={rangePct}
              onDragEdge={dragEdge}
              onRangeMenu={openRangeMenu}
              contentStyle={contentStyle}
              onClipMouseDown={startClipDrag}
              onClipContextMenu={onClipContextMenu}
              draggableClips={tool === "select"}
              showNames={showNames}
              dropProps={t.dropTrack ? makeDropProps(t.dropTrack) : undefined}
            />
          ))}
          {/* เลนล่างสุด: ก้อนแบ่งฉาก/ข้อความ — ช่วงเวลาของก้อนคือช่วงที่เอฟเฟกต์ทำงาน
              มี 2 เลน (FX1/FX2) ให้ซ้อนสองเอฟเฟกต์ช่วงเวลาเดียวกันได้ */}
          {[
            { id: "FX1", clips: fxblocks, laneTrack: 4 },
            { id: "FX2", clips: fx2blocks, laneTrack: 5 },
          ].map((t) => (
            <TrackRow
              key={t.id}
              track={t}
              kind="fx"
              playheadPct={playheadPct}
              onSeek={seekFromEvent}
              rangePct={rangePct}
              onDragEdge={dragEdge}
              onRangeMenu={openRangeMenu}
              contentStyle={contentStyle}
              onClipMouseDown={startClipDrag}
              onClipContextMenu={onClipContextMenu}
              draggableClips={tool === "select"}
              showNames={showNames}
              onTrimMouseDown={startTrimDrag}
            />
          ))}
        </div>
      </div>

      {/* เมนูคลิกขวาของโซนน้ำเงิน — ตัด/ลบช่วงที่เลือก */}
      {rangeMenu && cutRange && (
        <div
          className="range-menu"
          style={{ left: rangeMenu.x, top: rangeMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              onDeleteRange?.(cutRange.start, cutRange.end, true);
              setCutRange(null);
              setRangeMenu(null);
            }}
          >
            ✂ ลบช่วงนี้ แล้วเลื่อนชิด
          </button>
          <button
            onClick={() => {
              onDeleteRange?.(cutRange.start, cutRange.end, false);
              setCutRange(null);
              setRangeMenu(null);
            }}
          >
            ✂ ลบช่วงนี้ (เว้นช่องว่างไว้)
          </button>
          <button
            onClick={() => {
              onSplitAt?.(cutRange.start);
              onSplitAt?.(cutRange.end);
              setRangeMenu(null);
            }}
          >
            ┆ ผ่าหัว-ท้ายโซน (แยกก้อน ไม่ลบ)
          </button>
          <button
            onClick={() => {
              setCutRange(null);
              setRangeMenu(null);
            }}
          >
            ยกเลิกโซน (Esc)
          </button>
        </div>
      )}
      {/* เมนูคลิกขวาบนก้อนที่ติดเลือก (โหมดเลือกหลายท่อน) — รวมท่อนที่เลือกเป็นคลิปเดียว */}
      {clipMenu && (
        <div
          className="range-menu"
          style={{ left: clipMenu.x, top: clipMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            disabled={merging || selectedIds.length < 2}
            onClick={() => {
              setClipMenu(null);
              onMergeSelected?.();
            }}
          >
            ⧉ รวม {selectedIds.length} ท่อนที่เลือกเป็นคลิปเดียว
          </button>
          <button
            onClick={() => {
              setClipMenu(null);
              onSelectClip?.(null);
            }}
          >
            ยกเลิกการเลือกทั้งหมด
          </button>
        </div>
      )}
    </div>
  );
}

/** แถบไฮไลต์โซนที่เลือก (น้ำเงิน) + เส้นขอบ in/out ที่จับลากปรับได้ — คลิกขวาเปิดเมนูตัด/ลบ */
function RangeOverlay({ rangePct, onDragEdge, onMenu }) {
  if (!rangePct) return null;
  return (
    <div
      className="cut-range"
      style={{ left: `${rangePct.left}%`, width: `${rangePct.width}%` }}
      onContextMenu={onMenu}
      title="คลิกขวาเพื่อตัด/ลบช่วงนี้"
    >
      <div className="cut-edge start" onMouseDown={(e) => onDragEdge(e, "start")} />
      <div className="cut-edge end" onMouseDown={(e) => onDragEdge(e, "end")} />
    </div>
  );
}

function SceneChildTiming({ scene, child, onUpdate }) {
  const start = Math.max(0, child.offset || 0);
  const dur = Math.min(child.duration || scene.duration, scene.duration - start);
  const dragEdge = (e, edge) => {
    e.preventDefault(); e.stopPropagation();
    const rect = e.currentTarget.closest(".scene-child-timing").parentElement.getBoundingClientRect();
    const startX = e.clientX, start0 = start, dur0 = dur;
    const move = (ev) => {
      const dt = ((ev.clientX - startX) / rect.width) * scene.duration;
      if (edge === "start") {
        const nextStart = Math.max(0, Math.min(start0 + dur0 - 0.1, start0 + dt));
        onUpdate?.(child.id, { offset: nextStart, duration: dur0 + start0 - nextStart });
      } else {
        onUpdate?.(child.id, { duration: Math.max(0.1, Math.min(scene.duration - start0, dur0 + dt)) });
      }
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  return (
    <div className="scene-child-timing" style={{ left: `${start / scene.duration * 100}%`, width: `${dur / scene.duration * 100}%` }} title={`${child.name || child.type}: ${start.toFixed(1)}s–${(start + dur).toFixed(1)}s`}>
      <span className="scene-child-edge start" onMouseDown={(e) => dragEdge(e, "start")} />
      <span className="scene-child-label">{child.type === "text" ? "T" : "รูป"}</span>
      <span className="scene-child-edge end" onMouseDown={(e) => dragEdge(e, "end")} />
    </div>
  );
}

function TrackRow({ track, kind, playheadPct, onSeek, muted, onToggleMute, rangePct, onDragEdge, onRangeMenu, contentStyle, onClipMouseDown, onClipContextMenu, draggableClips, showNames, dropProps, onTrimMouseDown, onApplyTemplate, onDropMediaIntoScene, selectedId, onUpdateSceneChild }) {
  return (
    <div className={`track-row ${kind}`}>
      <div className="track-header">
        <button className="icon-btn tiny" title="Lock track">
          <Lock size={11} />
        </button>
        <span className={`track-badge ${kind}`}>{track.id}</span>
        {kind === "video" ? (
          <button className="icon-btn tiny" title="Toggle track output">
            <Eye size={11} />
          </button>
        ) : (
          <>
            <button
              className={`icon-btn tiny ${muted ? "active" : ""}`}
              title={muted ? "Unmute" : "Mute"}
              onClick={onToggleMute}
            >
              {muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
            </button>
            <button className="icon-btn tiny" title="Voice-over record">
              <Mic size={11} />
            </button>
          </>
        )}
      </div>
      <div className="track-lane" data-track={track.laneTrack || undefined} {...(dropProps || {})}>
        {/* คลิกขวาที่ไหนก็ได้บนเลนตอนมีโซนน้ำเงิน = เปิดเมนูตัด/ลบ (ตัวโซนเป็น pointer-events:none) */}
        <div className="lane-content" style={contentStyle} onMouseDown={onSeek} onContextMenu={onRangeMenu}>
          {track.clips.map((clip, i) => (
            <div
              key={clip.id}
              data-scene-id={clip.type === "scene" ? clip.id : undefined}
              className={`clip-block ${kind} ${kind === "video" && clip.ai ? "ai-tag" : ""} ${i % 2 ? "alt" : ""} ${draggableClips && !clip.locked ? "movable" : ""} ${clip.isDragging ? "dragging" : ""} ${clip.isSelected ? "selected" : ""} ${clip.hidden ? "hidden-clip" : ""} ${clip.type === "scene" ? "scene-block" : ""}`}
              style={{ left: `${clip.leftPct}%`, width: `${clip.widthPct}%` }}
              onMouseDown={(e) => onClipMouseDown?.(e, clip)}
              onContextMenu={(e) => onClipContextMenu?.(e, clip)}
              title={draggableClips ? "ลากซ้าย-ขวาเพื่อย้ายตำแหน่ง (เว้นช่องว่างได้)" : undefined}
              {...(clip.type === "scene" ? {
                onDragOver: (e) => {
                  if (e.dataTransfer.types.includes("application/x-media-path")) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = "copy";
                  }
                },
                onDrop: (e) => {
                  const path = e.dataTransfer.getData("application/x-media-path");
                  if (!path) return;
                  e.preventDefault();
                  e.stopPropagation();
                  onDropMediaIntoScene?.(clip.id, path);
                },
              } : {})}
              {...(clip.type === "text" && onApplyTemplate
                ? {
                    // ปล่อยเทมเพลตทับก้อน text นี้ = เอาสไตล์+ตำแหน่งของเทมเพลตมาใส่ (ข้อความ/เวลาเดิมคงไว้)
                    onDragOver: (e) => {
                      if (e.dataTransfer.types.includes("application/x-text-template")) {
                        e.preventDefault();
                        e.stopPropagation();
                      }
                    },
                    onDrop: (e) => {
                      const tpl = e.dataTransfer.getData("application/x-text-template");
                      if (tpl) {
                        e.preventDefault();
                        e.stopPropagation();
                        try {
                          onApplyTemplate(clip.id, JSON.parse(tpl));
                        } catch {}
                      }
                    },
                  }
                : {})}
            >
              {clip.type === "scene" && clip.children?.some((child) => child.id === selectedId) && (
                <SceneChildTiming scene={clip} child={clip.children.find((child) => child.id === selectedId)} onUpdate={onUpdateSceneChild} />
              )}
              {/* ก้อนข้อความ/แบ่งฉากไม่มีไฟล์วิดีโอ — โชว์ป้ายแทน filmstrip + ที่จับยืดขอบ */}
              {clip.type === "text" && <span className="clip-text-preview">T “{clip.text}”</span>}
              {/* ที่จับลากไปบันทึกเป็นเทมเพลต (ลากไปที่แท็บ Templates) — mousedown ไม่ให้ไปเริ่มลากย้าย */}
              {clip.type === "text" && (
                <div
                  className="clip-tpl-grip"
                  draggable
                  title="ลากไปที่แท็บ Templates เพื่อบันทึกสไตล์ + ตำแหน่งเป็นเทมเพลต"
                  onMouseDown={(e) => e.stopPropagation()}
                  onDragStart={(e) => {
                    e.stopPropagation();
                    e.dataTransfer.effectAllowed = "copy";
                    e.dataTransfer.setData(
                      "application/x-text-template",
                      JSON.stringify({
                        text: clip.text,
                        style: clip.style || {},
                        transform: clip.transform || null,
                        duration: clip.duration,
                      })
                    );
                  }}
                >
                  ★
                </div>
              )}
              {/* เส้นบอกช่วงเอฟเฟกต์ (เริ่ม/จบ) — โผล่เมื่อตั้งช่วงต่างจากเต็มก้อน */}
              {clip.type === "text" &&
                clip.duration > 0 &&
                (() => {
                  const inAt = Math.max(0, clip.style?.inAt ?? 0);
                  const outAt = clip.style?.outAt != null ? Math.min(clip.duration, clip.style.outAt) : clip.duration;
                  if (inAt <= 0.001 && outAt >= clip.duration - 0.001) return null; // เต็มก้อน = ไม่ต้องโชว์
                  const sp = (inAt / clip.duration) * 100;
                  const ep = (outAt / clip.duration) * 100;
                  return (
                    <>
                      {sp > 0.1 && <div className="fx-window-dim" style={{ left: 0, width: `${sp}%` }} />}
                      {ep < 99.9 && <div className="fx-window-dim" style={{ left: `${ep}%`, right: 0 }} />}
                      <div className="fx-window-mark start" style={{ left: `${sp}%` }} />
                      <div className="fx-window-mark end" style={{ left: `${ep}%` }} />
                    </>
                  );
                })()}
              {clip.type === "layout" && <span className="clip-text-preview">▚ {clip.name}</span>}
              {clip.type === "scene" && <span className="clip-text-preview">🎬 {clip.name}</span>}
              {(clip.type === "text" || clip.type === "layout" || clip.type === "scene") && draggableClips && !clip.locked && (
                <>
                  <div
                    className="clip-trim left"
                    title="ลากเพื่อยืด-หดจากหัวก้อน"
                    onMouseDown={(e) => onTrimMouseDown?.(e, clip, "left")}
                  />
                  <div
                    className="clip-trim right"
                    title="ลากเพื่อยืด-หดจากท้ายก้อน"
                    onMouseDown={(e) => onTrimMouseDown?.(e, clip, "right")}
                  />
                </>
              )}
              {/* ช่วงเนื้อไฟล์ของท่อนนี้ = in .. in + ความยาว timeline × สปีด */}
              {kind === "video" && clip.type !== "text" && clip.type !== "scene" && (
                <Filmstrip
                  url={clip.url}
                  start={(clip.inPoint || 0) / (clip.srcDuration || clip.duration)}
                  end={((clip.inPoint || 0) + clip.duration * (clip.speed || 1)) / (clip.srcDuration || clip.duration)}
                />
              )}
              {track.waveform && clip.type !== "scene" && (
                <AudioClipWave
                  url={clip.url}
                  start={(clip.inPoint || 0) / (clip.srcDuration || clip.duration)}
                  end={((clip.inPoint || 0) + clip.duration * (clip.speed || 1)) / (clip.srcDuration || clip.duration)}
                />
              )}
              {showNames && <span className="clip-name">{clip.name}</span>}
            </div>
          ))}
          <RangeOverlay rangePct={rangePct} onDragEdge={onDragEdge} onMenu={onRangeMenu} />
          <div className="timeline-playhead" style={{ left: `${playheadPct}%` }} />
        </div>
      </div>
    </div>
  );
}

/** waveform ของคลิปเสียงหนึ่งก้อน — โหลด peaks จาก cache แล้ววาดเฉพาะช่วง start–end
 *  (สัดส่วน 0–1 ของไฟล์ต้นฉบับ — ท่อนที่ถูกแบ่งจะโชว์เฉพาะเสียงช่วงของตัวเอง) */
function AudioClipWave({ url, start = 0, end = 1 }) {
  const [peaks, setPeaks] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setPeaks(null);
    getPeaks(url)
      .then((p) => !cancelled && setPeaks(p))
      .catch((err) => console.warn("decode audio ไม่สำเร็จ:", err));
    return () => {
      cancelled = true;
    };
  }, [url]);
  return <WaveformCanvas peaks={peaks} start={start} end={end} />;
}

/** วาด waveform จริงจาก peaks ลง canvas (แนวสมมาตรบน-ล่างแบบ Premiere) */
function WaveformCanvas({ peaks, start = 0, end = 1 }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !peaks) return;
    const draw = () => {
      const { width: w, height: h } = canvas.getBoundingClientRect();
      if (!w || !h) return;
      canvas.width = w * devicePixelRatio;
      canvas.height = h * devicePixelRatio;
      const ctx = canvas.getContext("2d");
      ctx.scale(devicePixelRatio, devicePixelRatio);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      const mid = h / 2;
      for (let x = 0; x < w; x++) {
        const frac = start + (x / w) * (end - start);
        const p = peaks[Math.floor(frac * peaks.length)] || 0;
        const half = Math.max(0.5, p * mid * 0.95);
        ctx.fillRect(x, mid - half, 1, half * 2);
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [peaks, start, end]);

  if (!peaks) return <div className="waveform" style={{ opacity: 0.2 }} />;
  return <canvas ref={ref} className="waveform-canvas" />;
}
