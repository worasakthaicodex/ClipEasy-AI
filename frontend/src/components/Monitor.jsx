import React, { useEffect, useRef, useState } from "react";
import { BubbleSvg, bubblePad } from "./TextBubbles";
import { effectStyle } from "./TextEffects";
import { animStyle, isOutAnim, ease, imageAnimStyle, KINETIC_ANIMS, LETTER_ANIMS } from "./TextAnimations";
import { lookFilter, colorGradeFilter } from "./looks";
import MaskSurface from './MaskSurface';
import { Play, Pause, SkipBack, SkipForward, StepBack, StepForward, Camera } from "lucide-react";

const FPS = 30; // ใช้แสดง timecode เฉยๆ ยังไม่ได้อ่าน fps จริงจากไฟล์
const CRT_SOFT_MASK = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'%3E%3Cdefs%3E%3Cfilter id='b' x='-15%25' y='-15%25' width='130%25' height='130%25'%3E%3CfeGaussianBlur stdDeviation='1.5'/%3E%3C/filter%3E%3C/defs%3E%3Crect x='2.5' y='3.5' width='95' height='93' rx='8' ry='12' fill='white' filter='url(%23b)'/%3E%3C/svg%3E")`;

// แปลงสี hex → rgba ตามความทึบ (รับ rgba(...) เดิมมาก็ส่งผ่านเฉยๆ)
function hexToRgba(color, alpha = 1) {
  if (!color?.startsWith("#")) return color;
  let h = color.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** แยกข้อความเป็นชิ้นตาม *คำ* — คำใน * จะได้สีเน้น (ขอบ/เงา/เอฟเฟกต์ยังตามสไตล์หลัก)
 *  ต้องเซ็ตทั้ง color และ WebkitTextFillColor เพราะเอฟเฟกต์แบบไล่สีใช้ fill โปร่งใส */
function renderRichText(text, highlight) {
  const parts = String(text ?? "").split(/\*([^*\n]+)\*/g);
  if (parts.length === 1) return text;
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <span key={i} style={{ color: highlight, WebkitTextFillColor: highlight }}>
        {p}
      </span>
    ) : (
      p
    )
  );
}

/** เผยข้อความแบบ kinetic: แยกเป็นคำ/ตัวอักษร แล้วเล่นเอฟเฟกต์เหลื่อมเวลารายตัว (แบบ jitter.video)
 *  styleForPos(pos, n) คืน style ของ item ที่ลำดับการเข้า = pos จากทั้งหมด n ตัว */
function KineticText({ text, highlight, mode, order = "forward", seed = "", styleForPos }) {
  const segs = String(text ?? "").split(/\*([^*\n]+)\*/g); // even=ปกติ / odd=highlight
  const cells = [];
  segs.forEach((seg, si) => {
    const isHi = si % 2 === 1;
    if (mode === "words") {
      seg.split(/(\s+)/).forEach((tok) => {
        if (tok === "") return;
        if (/^\s+$/.test(tok)) cells.push({ ws: tok });
        else cells.push({ text: tok, isHi, anim: true });
      });
    } else {
      for (const ch of seg) {
        if (ch === "\n") cells.push({ br: true });
        else if (/\s/.test(ch)) cells.push({ ws: ch });
        else cells.push({ text: ch, isHi, anim: true });
      }
    }
  });
  const n = cells.filter((c) => c.anim).length || 1;

  // ลำดับการเข้า (pos) ตาม order — random ใช้ seed จาก id ก้อนให้คงที่ทุกเฟรม
  let randRank = null;
  if (order === "random") {
    const s = String(seed).split("").reduce((a, ch) => a + ch.charCodeAt(0), 0);
    const arr = [...Array(n).keys()].map((i) => {
      const x = Math.sin(i * 99.13 + s) * 43758.5453;
      return { i, r: x - Math.floor(x) };
    });
    arr.sort((a, b) => a.r - b.r);
    randRank = new Array(n);
    arr.forEach((o, rank) => (randRank[o.i] = rank));
  }
  const posOf = (i) => {
    switch (order) {
      case "backward": return n - 1 - i;
      case "center": return Math.abs(i - (n - 1) / 2);
      case "random": return randRank[i];
      default: return i;
    }
  };

  let idx = 0;
  return cells.map((c, k) => {
    if (c.br) return <br key={k} />;
    if (c.ws) return <span key={k} style={{ whiteSpace: "pre" }}>{c.ws}</span>;
    const i = idx++;
    return (
      <span
        key={k}
        style={{
          display: "inline-block",
          whiteSpace: "pre",
          willChange: "transform, opacity",
          color: c.isHi ? highlight : undefined,
          WebkitTextFillColor: c.isHi ? highlight : undefined,
          ...styleForPos(posOf(i), n),
        }}
      >
        {c.text}
      </span>
    );
  });
}

// สัดส่วนภาพของจอ Program — เลือกแล้ว "ครอป" วิดีโอให้เต็มเฟรมสัดส่วนนั้น (ไม่ใส่แถบดำ)
const RATIOS = [
  { label: "Original", v: null },
  { label: "16:9", v: 16 / 9 },
  { label: "4:3", v: 4 / 3 },
  { label: "2.35:1", v: 2.35 },
  { label: "2:1", v: 2 },
  { label: "1.85:1", v: 1.85 },
  { label: "9:16", v: 9 / 16 },
  { label: "3:4", v: 3 / 4 },
  { label: "5.8-inch", v: 9 / 19.5 },
  { label: "1:1", v: 1 },
];

/** รูปทรงตัวอย่างสัดส่วนในเมนู (กล่องเปล่าแนวนอน/แนวตั้งตามค่า) */
function RatioShape({ v }) {
  if (!v) return <span className="ratio-shape" style={{ width: 18, height: 12, borderStyle: "dashed" }} />;
  const w = v >= 1 ? 18 : Math.max(7, 16 * v);
  const h = v >= 1 ? Math.max(7, 18 / v) : 16;
  return <span className="ratio-shape" style={{ width: w, height: h }} />;
}

function formatTC(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const f = Math.floor((Math.max(0, seconds) % 1) * FPS);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60, f]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

/** จอ Source / Program: เล่น sequence (คลิปหลายตัวต่อกัน) เวลาเป็นแกนรวมทั้ง timeline
 *  sequence: [{id, url, offset, duration}] เรียงตามลำดับ
 *  onPlayback(globalTime, totalDuration), controlRef.seekTo(globalT)
 *  playRange: {start, end} หน่วยวินาทีบนแกนรวม — เล่นวนเฉพาะช่วงนี้ */
/** เลเยอร์ซ้อน (V2/PiP): เล่นคลิปที่คร่อมเวลารวมปัจจุบัน sync กับตัวหลักทุกเฟรม
 *  ทรงกำหนดผ่าน transform.shape: none | circle | square | phone (แนวตั้ง 9:16) */
/** ทรงแบ่งฉาก (clip-path) — ใช้ได้ทั้งวิดีโอหลัก V1 และชั้นซ้อน V2/V3
 *  half/col = เลเยอร์เต็มจอโดนตัดเหลือส่วนของตัวเอง ซ้อนกันเป็น split screen
 *  heart/star = กล่องลอยกลางจอแบบเดียวกับวงกลม แต่ตัดเป็นรูปหัวใจ/ดาว */
export const SHAPE_CLIP = {
  "half-l": "inset(0 50% 0 0)",
  "half-r": "inset(0 0 0 50%)",
  "half-t": "inset(0 0 50% 0)",
  "half-b": "inset(50% 0 0 0)",
  "col-l": "inset(0 66.7% 0 0)",
  "col-c": "inset(0 33.4% 0 33.3%)",
  "col-r": "inset(0 0 0 66.7%)",
  heart:
    "polygon(50% 91%, 15% 60%, 4% 38%, 8% 15%, 28% 5%, 50% 20%, 72% 5%, 92% 15%, 96% 38%, 85% 60%)",
  star: "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
};

// ทรงที่ทาบเต็มจอ (ไม่ใช่กล่องลอย) — ใช้ตัดสินว่าต้อง translate กลางจอไหม
const FULL_FRAME_SHAPE = (s) => s?.startsWith("half-") || s?.startsWith("col-");

/** polygon ครึ่งระนาบ: ตัดกรอบจอ (0–100%) ด้วยเส้นแบ่งผ่านจุด (cx,cy) เอียง angle องศา
 *  side=false เอาฝั่งหนึ่ง / true เอาฝั่งตรงข้าม — ใช้ทำแบ่งฉากเอียงมุมอิสระ */
function halfPlaneClip(cx, cy, angleDeg, side) {
  const rad = ((angleDeg + 90 + (side ? 180 : 0)) * Math.PI) / 180; // normal ตั้งฉากกับเส้นแบ่ง
  const nx = Math.cos(rad);
  const ny = Math.sin(rad);
  const pts = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const d = (p) => (p[0] - cx) * nx + (p[1] - cy) * ny;
  const out = [];
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    if (d(a) >= 0) out.push(a);
    if (d(a) >= 0 !== (d(b) >= 0)) {
      const t = d(a) / (d(a) - d(b));
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  if (out.length < 3) return "polygon(0 0, 0 0, 0 0)"; // เส้นออกนอกจอ — ฝั่งนี้ไม่เหลือพื้นที่
  return `polygon(${out.map((p) => `${p[0].toFixed(1)}% ${p[1].toFixed(1)}%`).join(", ")})`;
}

// clip-path ของทรงลอยใน fx shape (ใช้ใน mask กล่องลอย ไม่ใช่เต็มจอ)
const FX_SHAPE_CLIP = {
  circle: "circle(50% at 50% 50%)",
  square: "inset(0 round 8%)",
  heart: SHAPE_CLIP.heart,
  star: SHAPE_CLIP.star,
};

/** เส้นแบ่งจริงบนภาพ (คนดูเห็น) — วาดตามสี/ความหนาที่ตั้งไว้ในก้อนแบ่งฉาก
 *  ต่างจากเส้นเหลืองใน FxEditor ที่เป็นแค่ไกด์ตอนเลือกก้อน */
function FxDividerLine({ fx }) {
  const rad = (fx.angle * Math.PI) / 180;
  return (
    <svg className="fx-line-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
      <line
        x1={fx.cx - Math.cos(rad) * 200}
        y1={fx.cy - Math.sin(rad) * 200}
        x2={fx.cx + Math.cos(rad) * 200}
        y2={fx.cy + Math.sin(rad) * 200}
        stroke={fx.lineColor || "#ffffff"}
        strokeWidth={fx.lineWidth || 3}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** เส้นแบ่ง + จุดจับบนจอ Program — ลากวงกลมกลาง = ย้าย, ลากปุ่มเล็ก = เอียงมุม/ปรับขนาด */
function FxEditor({ fx, onUpdate }) {
  const startDrag = (e, onMove) => {
    e.stopPropagation();
    e.preventDefault();
    const stage = e.target.closest(".monitor-content");
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const toPct = (ev) => ({
      x: Math.min(100, Math.max(0, ((ev.clientX - rect.left) / rect.width) * 100)),
      y: Math.min(100, Math.max(0, ((ev.clientY - rect.top) / rect.height) * 100)),
    });
    const move = (ev) => {
      if (ev.buttons === 0) return up();
      onMove(toPct(ev));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const { cx, cy, angle, size, kind } = fx;
  const rad = (angle * Math.PI) / 180;
  // ปุ่มหมุน (split) วางบนเส้นห่างจากกลาง 18% / ปุ่มขนาด (shape) วางขอบขวาของทรง
  const knob =
    kind === "split"
      ? { x: cx + Math.cos(rad) * 18, y: cy + Math.sin(rad) * 18 }
      : { x: cx + size / 2, y: cy };

  return (
    <div className="fx-editor">
      {kind === "split" && (
        <svg className="fx-line-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          <line
            x1={cx - Math.cos(rad) * 200}
            y1={cy - Math.sin(rad) * 200}
            x2={cx + Math.cos(rad) * 200}
            y2={cy + Math.sin(rad) * 200}
            className="fx-line"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
      <div
        className="fx-handle"
        style={{ left: `${cx}%`, top: `${cy}%` }}
        title="ลากเพื่อย้ายเส้นแบ่ง/รูปทรง"
        onMouseDown={(e) => startDrag(e, (p) => onUpdate(fx.id, { cx: p.x, cy: p.y }))}
      />
      <div
        className="fx-knob"
        style={{ left: `${knob.x}%`, top: `${knob.y}%` }}
        title={kind === "split" ? "ลากเพื่อเอียงมุมเส้นแบ่ง" : "ลากเพื่อปรับขนาด"}
        onMouseDown={(e) =>
          startDrag(e, (p) => {
            if (kind === "split") {
              const deg = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI;
              onUpdate(fx.id, { angle: deg });
            } else {
              const s = Math.min(100, Math.max(6, Math.abs(p.x - cx) * 2));
              onUpdate(fx.id, { size: s });
            }
          })
        }
      />
    </div>
  );
}

/** โหมดวาดกรอบสำหรับลบวัตถุ (AI): ทาบเต็มจอ ลากเมาส์วาดสี่เหลี่ยม
 *  ปล่อยเมาส์ = ส่งกรอบเป็นสัดส่วน 0–1 ของจอกลับไป / Esc หรือคลิกเฉยๆ = ยกเลิก */
function DrawRectOverlay({ onDone, hint, videoRef }) {
  const [box, setBox] = useState(null); // {x0,y0,x1,y1} เป็น %
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onDone?.(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const startDraw = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const toPct = (ev) => ({
      x: Math.min(100, Math.max(0, ((ev.clientX - rect.left) / rect.width) * 100)),
      y: Math.min(100, Math.max(0, ((ev.clientY - rect.top) / rect.height) * 100)),
    });
    const p0 = toPct(e);
    let last = p0;
    const move = (ev) => {
      if (ev.buttons === 0) return up(ev);
      last = toPct(ev);
      setBox({ x0: p0.x, y0: p0.y, x1: last.x, y1: last.y });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      const x = Math.min(p0.x, last.x);
      const y = Math.min(p0.y, last.y);
      const w = Math.abs(last.x - p0.x);
      const h = Math.abs(last.y - p0.y);
      // ลากเล็กเกิน = คลิกพลาด ไม่นับ (ยังอยู่ในโหมดวาดต่อ)
      if (w < 1.5 || h < 1.5) return setBox(null);
      let out = { x: x / 100, y: y / 100, w: w / 100, h: h / 100 };
      // จอ Program มีขอบดำ (object-fit: contain) — แปลงจากสัดส่วนของ "จอ"
      // เป็นสัดส่วนของ "เนื้อวิดีโอจริง" ไม่งั้นกรอบที่ส่งให้ backend เพี้ยนตำแหน่ง
      const v = videoRef?.current;
      if (v && v.videoWidth) {
        const scale = Math.min(rect.width / v.videoWidth, rect.height / v.videoHeight);
        const vw = v.videoWidth * scale;
        const vh = v.videoHeight * scale;
        const ox = (rect.width - vw) / 2;
        const oy = (rect.height - vh) / 2;
        out = {
          x: (out.x * rect.width - ox) / vw,
          y: (out.y * rect.height - oy) / vh,
          w: (out.w * rect.width) / vw,
          h: (out.h * rect.height) / vh,
        };
        out.x = Math.max(0, Math.min(1, out.x));
        out.y = Math.max(0, Math.min(1, out.y));
        out.w = Math.max(0.005, Math.min(1 - out.x, out.w));
        out.h = Math.max(0.005, Math.min(1 - out.y, out.h));
      }
      onDone?.(out);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <div className="draw-overlay" onMouseDown={startDraw}>
      <div className="draw-hint">{hint || "ลากกรอบครอบสิ่งที่ต้องการลบ — Esc ยกเลิก"}</div>
      {box && (
        <div
          className="draw-rect"
          style={{
            left: `${Math.min(box.x0, box.x1)}%`,
            top: `${Math.min(box.y0, box.y1)}%`,
            width: `${Math.abs(box.x1 - box.x0)}%`,
            height: `${Math.abs(box.y1 - box.y0)}%`,
          }}
        />
      )}
    </div>
  );
}

/** กล่องเซ็นเซอร์ (เบลอ/โมเสก) ทับภาพในตำแหน่งกล่อง — ไม่แตะไฟล์จริง เอาออก/แก้ได้ตลอด
 *  ลากตัวกล่อง = ย้าย / ลากมุมขวาล่าง = ปรับขนาด (เฉพาะตอนก้อนถูกเลือกบน timeline) */
function CensorBox({ fx, editable, onUpdate }) {
  const startMove = (e) => {
    if (!editable) return;
    e.stopPropagation();
    e.preventDefault();
    const stage = e.target.closest(".monitor-content");
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const cx0 = fx.cx, cy0 = fx.cy;
    const move = (ev) => {
      if (ev.buttons === 0) return up();
      const dx = ((ev.clientX - sx) / rect.width) * 100;
      const dy = ((ev.clientY - sy) / rect.height) * 100;
      onUpdate(fx.id, {
        cx: Math.min(100, Math.max(0, cx0 + dx)),
        cy: Math.min(100, Math.max(0, cy0 + dy)),
      });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const startResize = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const stage = e.target.closest(".monitor-content");
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const w0 = fx.boxW, h0 = fx.boxH;
    const move = (ev) => {
      if (ev.buttons === 0) return up();
      const dw = ((ev.clientX - sx) / rect.width) * 100 * 2; // มุมลากออกจากกลาง → ×2
      const dh = ((ev.clientY - sy) / rect.height) * 100 * 2;
      onUpdate(fx.id, {
        boxW: Math.min(100, Math.max(4, w0 + dw)),
        boxH: Math.min(100, Math.max(4, h0 + dh)),
      });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const px = Math.max(1, fx.strength || 12);
  const mosaic = fx.censorStyle === "mosaic";
  const canvasRef = useRef(null);

  // โมเสกจริง: ดึงภาพจากวิดีโอตรงกล่อง มาวาดลง canvas เล็กๆ (1 บล็อก = 1 พิกเซล canvas)
  // แล้วขยายเต็มกล่องด้วย image-rendering: pixelated → ได้บล็อกสี่เหลี่ยมคมแบบโมเสกจริง
  useEffect(() => {
    if (!mosaic) return;
    let raf;
    const draw = () => {
      const canvas = canvasRef.current;
      const boxEl = canvas?.parentElement;
      const stage = boxEl?.closest(".monitor-content");
      const video = stage?.querySelector(".monitor-video");
      if (canvas && boxEl && video && video.videoWidth) {
        const vr = video.getBoundingClientRect();
        const br = boxEl.getBoundingClientRect();
        // แปลงกรอบกล่อง (พิกัดจอ) → พิกเซลต้นฉบับของวิดีโอ (วิดีโอเต็มกรอบ object-fit)
        const sx = ((br.left - vr.left) / vr.width) * video.videoWidth;
        const sy = ((br.top - vr.top) / vr.height) * video.videoHeight;
        const sw = (br.width / vr.width) * video.videoWidth;
        const sh = (br.height / vr.height) * video.videoHeight;
        // จำนวนบล็อก = ขนาดกล่องบนจอ ÷ ความแรง (px = ขนาดบล็อกโดยประมาณ)
        const cols = Math.max(1, Math.round(br.width / px));
        const rows = Math.max(1, Math.round(br.height / px));
        if (canvas.width !== cols) canvas.width = cols;
        if (canvas.height !== rows) canvas.height = rows;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        try {
          ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cols, rows);
        } catch {}
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [mosaic, px, fx.cx, fx.cy, fx.boxW, fx.boxH]);

  return (
    <div
      className={`censor-box ${editable ? "editable" : ""}`}
      style={{
        left: `${fx.cx}%`,
        top: `${fx.cy}%`,
        width: `${fx.boxW}%`,
        height: `${fx.boxH}%`,
        transform: "translate(-50%, -50%)",
        // เบลอ = เบลอเนียนด้วย backdrop / โมเสก = วาดบล็อกพิกเซลจริงลง canvas ด้านล่าง
        backdropFilter: mosaic ? undefined : `blur(${px}px)`,
        WebkitBackdropFilter: mosaic ? undefined : `blur(${px}px)`,
        background: mosaic ? "#000" : undefined, // กันภาพเดิมโผล่ก่อน canvas เฟรมแรก
      }}
      onMouseDown={startMove}
    >
      {mosaic && <canvas ref={canvasRef} className="censor-mosaic" />}
      {editable && <div className="censor-resize" onMouseDown={startResize} />}
    </div>
  );
}

function OverlayVideo({ clips, time, playing, muted, fxClip = null, fxBox = null, scale = 1, maskProps = {} }) {
  const ref = useRef(null);
  const active =
    clips.find((c) => time >= c.offset && time < c.offset + c.duration) || null;

  useEffect(() => {
    const v = ref.current;
    if (!v || !active || active.type === "image") return; // รูปภาพไม่ต้อง sync เวลา
    const tf = active.transform || {};
    v.volume = Math.min(1, Math.max(0, (tf.volume ?? 100) / 100));
    v.playbackRate = active.speed || 1;
    // เวลาในไฟล์ที่ควรอยู่ ณ ตอนนี้ — เพี้ยนเกิน 0.2s ค่อยดึงกลับ (แก้ทุกเฟรมภาพจะกระตุก)
    const target = (active.inPoint || 0) + (time - active.offset) * (active.speed || 1);
    if (Math.abs(v.currentTime - target) > (maskProps.active ? .001 : .2)) v.currentTime = target;
    if (playing && !maskProps.active && v.paused) v.play().catch(() => {});
    if ((!playing || maskProps.active) && !v.paused) v.pause();
  }, [time, playing, active?.id, maskProps.active]);

  if (!active) return null;
  const tf = active.transform || {};
  const cinema = cinemaInset(active, time);
  const transitionMask = videoTransitionClip(active, time);
  const tv = tvOnStyle(active, time);
  const transitionOpacity = videoTransitionOpacity(active, time);
  const crtMask = active.transform?.videoFx === "crt-screen";
  const shape = tf.shape || "none";
  // ก้อนแบ่งฉาก (เลน FX) คุมทรงของชั้นนี้อยู่ — ทับค่าทรงของก้อนเอง
  // fxClip = ครึ่งระนาบเต็มจอ / fxBox = กล่องลอยรูปทรง (วงกลม/หัวใจ/ดาว) ที่ลากปรับได้
  const fullFrame = fxClip ? true : fxBox ? false : shape === "none" || FULL_FRAME_SHAPE(shape);
  const boxStyle = fxBox
    ? {
        top: `${fxBox.cy}%`,
        left: `${fxBox.cx}%`,
        width: `${fxBox.size}%`,
        aspectRatio: "1",
        clipPath: FX_SHAPE_CLIP[fxBox.shape],
      }
    : { clipPath: transitionMask ?? (cinema != null ? `inset(${cinema}% 0)` : (fxClip ?? SHAPE_CLIP[shape])) };
  return (
    <div
      className={`pip-box ${fxClip ? "pip-fxfull" : fxBox ? "pip-fxbox" : `pip-${shape}`}`}
      style={{
        ...boxStyle,
        zIndex: maskProps.active && active.id === maskProps.selectedId ? 65 : undefined,
        ...(crtMask ? { WebkitMaskImage: CRT_SOFT_MASK, maskImage: CRT_SOFT_MASK, WebkitMaskSize: "100% 100%", maskSize: "100% 100%", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat" } : {}),
        transform:
          // ทรงเต็มจอ (ปกติ/แบ่งฉาก) ทาบทั้งจอ — ทรงอื่นเป็นกล่องลอยยึดตามจุดกึ่งกลาง
          `${fullFrame ? "" : "translate(-50%, -50%)"} translate(${((tf.x || 0) + tv.x) * scale}px, ${((tf.y || 0) + tv.y) * scale}px) ` +
          `skewX(${tv.skew}deg) scale(${((tf.scale ?? 100) / 100) * (tf.flipH ? -1 : 1) * tv.scaleX}, ${((tf.scale ?? 100) / 100) * (tf.flipV ? -1 : 1) * tv.scaleY}) ` +
          `rotate(${tf.rotation || 0}deg)`,
        opacity: ((tf.opacity ?? 100) / 100) * tv.opacity * transitionOpacity,
        filter:
          [lookFilter(tf.look), colorGradeFilter(tf.colorGrade, tf.colorGradeStrength), tf.blur ? `blur(${tf.blur}px)` : "", tf.videoFx === "crt-screen" ? "contrast(1.1) saturate(.88) brightness(.94)" : "", tv.filter].filter(Boolean).join(" ") ||
          undefined,
      }}
    >
      {active.type === "image" ? (
        <img
          key={active.id}
          src={active.url}
          alt=""
          style={{ objectPosition: `${tf.cropX ?? 50}% ${tf.cropY ?? 50}%`, transformOrigin: `${tf.cropX ?? 50}% ${tf.cropY ?? 50}%`, transform: `scale(${(tf.cropZoom ?? 100) / 100})` }}
          /* รูปนิ่งจาก Media Browser */
        />
      ) : (
        <video
          key={active.id}
          ref={ref}
          src={active.url}
          muted={muted || active.audioDetached}
          onPlay={e => { if (maskProps.active) e.currentTarget.pause(); }}
          onContextMenu={e => { if (maskProps.active) e.preventDefault(); }}
          /* ก้อนเสียงล้วน: เล่นเสียงแต่ไม่โชว์จอดำทับวิดีโอ */
          style={active.type === "audio" ? { display: "none" } : undefined}
        />
      )}
      {active.type !== 'image' && active.type !== 'audio' && <MaskSurface sourceRef={ref} clip={active} time={time}
        selected={active.id === maskProps.selectedId} active={maskProps.active && active.id === maskProps.selectedId && !active.locked}
        redraw={maskProps.redraw} onCommit={maskProps.onCommit} onDelete={maskProps.onDelete} onExit={maskProps.onExit} />}
    </div>
  );
}

function cinemaInset(clip, time) {
  if (!clip) return null;
  const tf = clip.transform || {};
  const ratioInset = tf.videoFx === "cinema-bars" ? 12.5 : 0;
  let inset = ratioInset, enabled = ratioInset > 0;
  if (tf.videoFxIn === "cinema-open") {
    const d = Math.max(.05, tf.videoFxInDuration || .8);
    const p = Math.max(0, Math.min(1, (time - clip.offset) / d));
    inset = Math.max(inset, 50 - p * (50 - ratioInset)); enabled = true;
  }
  if (tf.videoFxOut === "cinema-close") {
    const d = Math.max(.05, tf.videoFxOutDuration || .8);
    const p = Math.max(0, Math.min(1, (time - (clip.offset + clip.duration - d)) / d));
    inset = Math.max(inset, p * 50); enabled = true;
  }
  return enabled ? inset : null;
}

function videoTransitionClip(clip, time) {
  if (!clip) return null;
  const tf = clip.transform || {};
  if (tf.videoFxIn === "tv-on") {
    const d = Math.max(.1, tf.videoFxInDuration || 1);
    const p = Math.max(0, Math.min(1, (time - clip.offset) / d));
    if (p < 1) {
      const open = p < .18 ? .008 : p < .7 ? .008 + ((p - .18) / .52) * .992 : 1;
      return `inset(${Math.max(0, (1 - open) * 50)}% 0)`;
    }
  }
  if (tf.videoFxOut === "tv-off") {
    const d = Math.max(.1, tf.videoFxOutDuration || 1);
    const outP = Math.max(0, Math.min(1, (time - (clip.offset + clip.duration - d)) / d));
    if (outP > 0) {
      const p = 1 - outP;
      const open = p < .18 ? .008 : p < .7 ? .008 + ((p - .18) / .52) * .992 : 1;
      return `inset(${Math.max(0, (1 - open) * 50)}% 0)`;
    }
  }
  if (tf.videoFxIn === "iris-open") {
    const d = Math.max(.1, tf.videoFxInDuration || 1);
    const p = Math.max(0, Math.min(1, (time - clip.offset) / d));
    if (p < 1) {
      const radius = p < .2 ? 11 : 11 + ((p - .2) / .8) * 64;
      return `circle(${radius}% at 50% 50%)`;
    }
  }
  if (tf.videoFxOut === "iris-close") {
    const d = Math.max(.1, tf.videoFxOutDuration || 1);
    const p = Math.max(0, Math.min(1, (time - (clip.offset + clip.duration - d)) / d));
    if (p > 0) {
      let radius;
      if (p < .72) radius = 75 - (p / .72) * 64;
      else if (p < .9) radius = 11;
      else radius = 11 * (1 - (p - .9) / .1);
      return `circle(${Math.max(0, radius)}% at 50% 50%)`;
    }
  }
  return null;
}

function videoTransitionOpacity(clip, time) {
  if (!clip) return 1;
  const tf = clip.transform || {};
  let opacity = 1;
  if (tf.videoFxIn === "fade-in") {
    const d = Math.max(.05, tf.videoFxInDuration || 1);
    opacity = Math.min(opacity, Math.max(0, Math.min(1, (time - clip.offset) / d)));
  }
  if (tf.videoFxOut === "fade-out") {
    const d = Math.max(.05, tf.videoFxOutDuration || 1);
    opacity = Math.min(opacity, Math.max(0, Math.min(1, (clip.offset + clip.duration - time) / d)));
  }
  return opacity;
}

function tvOnStyle(clip, time) {
  const tf = clip?.transform || {};
  const isOn = tf.videoFxIn === "tv-on";
  const isOff = tf.videoFxOut === "tv-off";
  if (!isOn && !isOff) return { filter: "", opacity: 1, scaleY: 1, scaleX: 1, x: 0, y: 0, skew: 0, scan: 0, wave: 0 };
  let p = 1;
  if (isOn) {
    const d = Math.max(.1, tf.videoFxInDuration || 1);
    p = Math.max(0, Math.min(1, (time - clip.offset) / d));
  }
  if (isOff) {
    const d = Math.max(.1, tf.videoFxOutDuration || 1);
    const outP = Math.max(0, Math.min(1, (time - (clip.offset + clip.duration - d)) / d));
    if (outP > 0) p = 1 - outP;
  }
  if (p >= 1) return { filter: "", opacity: 1, scaleY: 1, scaleX: 1, x: 0, y: 0, skew: 0, scan: 0, wave: 0 };
  if (p < .08) return { filter: "brightness(0)", opacity: 0, scaleY: .01, scaleX: .2, x: 0, y: 0, skew: 0, scan: 0, wave: 0 };
  if (p < .22) return { filter: "url(#tv-wave) brightness(5) contrast(2) saturate(0) blur(1px)", opacity: 1, scaleY: .015, scaleX: 1 + Math.sin(p * 110) * .12, x: Math.sin(p * 170) * 7, y: 0, skew: Math.sin(p * 90) * 7, scan: .8, wave: 70 };
  const q = Math.min(1, (p - .22) / .48);
  const flash = Math.max(1, 2.8 - q * 1.8);
  const flicker = p < .82 ? 1 + Math.sin(p * 95) * .07 : 1;
  const shake = Math.max(0, 1 - q);
  return {
    filter: `${q < .9 ? "url(#tv-wave) " : ""}brightness(${flash * flicker}) contrast(${1.55 - q * .55}) saturate(${.45 + q * .55}) hue-rotate(${Math.sin(p * 120) * 9 * shake}deg)`,
    opacity: 1, scaleY: .02 + q * .98, scaleX: 1 + Math.sin(p * 83) * .035 * shake,
    x: Math.sin(p * 205) * 6 * shake, y: Math.cos(p * 157) * 3 * shake,
    skew: Math.sin(p * 69) * 8 * shake, scan: Math.max(0, .65 - q * .5), wave: 72 * Math.pow(shake, .75),
  };
}

function DetachedAudioLayer({ clip, time, playing, muted }) {
  const ref = useRef(null);
  const graphRef = useRef(null);
  const active = time >= clip.offset && time < clip.offset + clip.duration;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = new AudioContext();
    const src = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(gain); gain.connect(pan); pan.connect(analyser); analyser.connect(ctx.destination);
    graphRef.current = { ctx, gain, pan, analyser };
    const buf = new Float32Array(128);
    let raf = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const db = rms > .0001 ? Math.max(-60, Math.min(0, 20 * Math.log10(rms))) : -60;
      window.dispatchEvent(new CustomEvent("clipeasy:audio-level", { detail: { source: clip.id, left: db, right: db } }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); ctx.close().catch(() => {}); window.dispatchEvent(new CustomEvent("clipeasy:audio-level", { detail: { source: clip.id, remove: true } })); };
  }, [clip.id]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = (clip.inPoint || 0) + Math.max(0, time - clip.offset) * (clip.speed || 1);
    el.playbackRate = clip.speed || 1;
    const tf = clip.transform || {};
    const local = Math.max(0, time - clip.offset);
    const remain = Math.max(0, clip.duration - local);
    let fade = 1;
    if ((tf.audioFadeIn || 0) > 0) fade = Math.min(fade, local / tf.audioFadeIn);
    if ((tf.audioFadeOut || 0) > 0) fade = Math.min(fade, remain / tf.audioFadeOut);
    const graph = graphRef.current;
    if (graph) {
      const now = graph.ctx.currentTime;
      const volume = active && !muted ? Math.max(0, Math.min(5, (tf.volume ?? 100) / 100)) * Math.max(0, Math.min(1, fade)) : 0;
      graph.gain.gain.setTargetAtTime(volume, now, 0.025);
      graph.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, (tf.pan || 0) / 100)), now, 0.025);
    }
    if (Math.abs((el.currentTime || 0) - target) > 0.22) el.currentTime = target;
    if (active && playing && !muted) { graphRef.current?.ctx.resume().catch(() => {}); el.play().catch(() => {}); }
    else el.pause();
  }, [active, playing, muted, time, clip.offset, clip.inPoint, clip.speed, clip.duration, clip.transform?.volume, clip.transform?.pan, clip.transform?.audioFadeIn, clip.transform?.audioFadeOut]);
  return <video ref={ref} src={clip.url} style={{ display: "none" }} />;
}

/** รูปที่เป็นลูกของ Scene — อยู่ในกรอบจอเสมอ และแก้ตำแหน่ง/ขนาดได้จาก Program Monitor */
function SceneMediaLayer({ clips, time, selectedId, onSelect, onUpdate, screenScale = 1, layerW = 1920, layerH = 1080 }) {
  return clips.filter((c) => time >= c.offset && time < c.offset + c.duration).map((c) => {
    const tf = c.transform || {};
    const pathOffset = (path, effect, exiting = false) => {
      if (!path || path === "auto") {
        // In: ลูกศรคือทิศที่รูปเคลื่อนเข้าหาตำแหน่งจริง / Out: ลูกศรคือทิศที่รูปออกจากตำแหน่งจริง
        const incoming = { "slide-left": [layerW * .55, 0], "slide-right": [-layerW * .55, 0], "slide-up": [0, layerH * .55] }[effect] || [0, 0];
        return exiting ? [-incoming[0], -incoming[1]] : incoming;
      }
      if (path === "center") return [-(tf.x || 0), -(tf.y || 0)];
      if (path === "bottom") return [0, layerH * .55];
      if (path === "top") return [0, -layerH * .55];
      if (path === "left") return [-layerW * .55, 0];
      if (path === "right") return [layerW * .55, 0];
      return [0, 0];
    };
    let imageAnim = { opacity: 1, transform: "" };
    const applyAnim = (id, p, path, exiting = false) => {
      if (id?.startsWith("slide")) {
        const [dx, dy] = pathOffset(path, id, exiting);
        return { opacity: p, transform: `translate(${(1 - p) * dx}px, ${(1 - p) * dy}px)` };
      }
      return imageAnimStyle(id, p);
    };
    const inDur = Math.max(0.1, tf.imageInDur ?? 0.6);
    const outDur = Math.max(0.1, tf.imageOutDur ?? 0.6);
    if (tf.imageIn && time - c.offset < inDur) imageAnim = applyAnim(tf.imageIn, (time - c.offset) / inDur, tf.imageInPath, false);
    if (tf.imageOut && c.offset + c.duration - time < outDur) imageAnim = applyAnim(tf.imageOut, (c.offset + c.duration - time) / outDur, tf.imageOutPath, true);
    const selected = c.id === selectedId;
    const startDrag = (e, mode = "move") => {
      e.preventDefault();
      e.stopPropagation();
      onSelect?.(c.id);
      const sx = e.clientX, sy = e.clientY;
      const x0 = tf.x || 0, y0 = tf.y || 0, scale0 = tf.scale ?? 45;
      const box = e.currentTarget.closest(".scene-media")?.getBoundingClientRect();
      const cx = box ? box.left + box.width / 2 : sx, cy = box ? box.top + box.height / 2 : sy;
      const angle0 = Math.atan2(sy - cy, sx - cx), rotation0 = tf.rotation || 0;
      const move = (ev) => {
        if (ev.buttons === 0) return up();
        if (mode === "resize") {
          const delta = ((ev.clientX - sx) + (ev.clientY - sy)) / 3;
          onUpdate?.(c.id, { transform: { ...tf, scale: Math.min(200, Math.max(8, scale0 + delta / screenScale)) } });
        } else if (mode === "rotate") {
          let rotation = rotation0 + (Math.atan2(ev.clientY - cy, ev.clientX - cx) - angle0) * 180 / Math.PI;
          if (ev.shiftKey) rotation = Math.round(rotation / 15) * 15;
          onUpdate?.(c.id, { transform: { ...tf, rotation } });
        } else {
          onUpdate?.(c.id, { transform: { ...tf, x: x0 + (ev.clientX - sx) / screenScale, y: y0 + (ev.clientY - sy) / screenScale } });
        }
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    };
    return (
      <React.Fragment key={c.id}>
      <div
        className={`scene-media ${selected ? "selected" : ""}`}
        onMouseDown={(e) => startDrag(e)}
        style={{
          position: "absolute", left: "50%", top: "50%", width: "70%", zIndex: 40,
          transform: `translate(-50%, -50%) translate(${tf.x || 0}px, ${tf.y || 0}px) scale(${(tf.scale ?? 45) / 100}) rotate(${tf.rotation || 0}deg) ${imageAnim.transform}`,
          opacity: ((tf.opacity ?? 100) / 100) * imageAnim.opacity,
          transformOrigin: "center", cursor: "move", pointerEvents: "auto",
        }}
      >
        <div style={{ width: "100%", aspectRatio: tf.shape === "circle" ? "1" : undefined, clipPath: tf.shape === "circle" ? "circle(50% at 50% 50%)" : undefined, overflow: "hidden" }}>
          <img src={c.url} alt="" draggable={false} style={{ display: "block", width: "100%", height: tf.shape === "circle" ? "100%" : undefined, maxHeight: "100%", objectFit: tf.shape === "circle" ? "cover" : "contain", objectPosition: `${tf.cropX ?? 50}% ${tf.cropY ?? 50}%`, transformOrigin: `${tf.cropX ?? 50}% ${tf.cropY ?? 50}%`, transform: `scale(${(tf.cropZoom ?? 100) / 100})` }} />
        </div>
        {selected && <span className="scene-media-rotate" title="ลากเพื่อหมุน (Shift = ทีละ 15°)" onMouseDown={(e) => startDrag(e, "rotate")} />}
        {selected && <span className="scene-media-resize" onMouseDown={(e) => startDrag(e, "resize")} />}
      </div>
      </React.Fragment>
    );
  });
}

/** เลเยอร์ข้อความ (V3): โชว์ทุกก้อนข้อความที่คร่อมเวลาปัจจุบัน ทับบนสุด
 *  ตำแหน่ง/ขนาด/หมุน ใช้ transform เดียวกับคลิปวิดีโอ สไตล์ตัวอักษรอยู่ใน clip.style */
function TextOverlay({ clips, time, selectedId, onSelect, onUpdate, scale = 1, screenScale = 1 }) {
  return clips
    .filter((c) => time >= c.offset && time < c.offset + c.duration)
    .map((c) => {
      const tf = c.transform || {};
      const st = c.style || {};
      const selected = c.id === selectedId;
      const editable = !!onUpdate && !c.locked;
      const sz = (st.size || 48) * scale; // ขนาดฟอนต์จริงบนจอ = ขนาดฐาน × สเกลจอ

      // ลากย้ายตำแหน่ง (แกน x/y เป็น px บนจอ monitor ตรงๆ)
      const dragWith = (e, onMove) => {
        e.stopPropagation();
        e.preventDefault();
        onSelect?.(c.id);
        const move = (ev) => {
          if (ev.buttons === 0) return up();
          onMove(ev);
        };
        const up = () => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      };

      const startMove = (e) => {
        if (!editable) return;
        const sx = e.clientX, sy = e.clientY;
        const x0 = tf.x || 0, y0 = tf.y || 0;
        dragWith(e, (ev) =>
          onUpdate(c.id, {
            // เมาส์ขยับเป็น px จริงบนจอ → หารด้วย screenScale เป็นพิกัดในเลเยอร์อ้างอิง
            transform: { ...tf, x: x0 + (ev.clientX - sx) / screenScale, y: y0 + (ev.clientY - sy) / screenScale },
          })
        );
      };

      // จุดกึ่งกลางกล่องข้อความบนจอ ใช้คำนวณทั้งย่อขยายและหมุน
      const centerOf = (e) => {
        const r = e.currentTarget.closest(".text-overlay").getBoundingClientRect();
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      };

      const startScale = (e) => {
        const { cx, cy } = centerOf(e);
        const d0 = Math.max(4, Math.hypot(e.clientX - cx, e.clientY - cy));
        const s0 = tf.scale ?? 100;
        dragWith(e, (ev) => {
          const d = Math.hypot(ev.clientX - cx, ev.clientY - cy);
          onUpdate(c.id, {
            transform: { ...tf, scale: Math.min(1000, Math.max(5, (s0 * d) / d0)) },
          });
        });
      };

      const startRotate = (e) => {
        const { cx, cy } = centerOf(e);
        const a0 = Math.atan2(e.clientY - cy, e.clientX - cx);
        const r0 = tf.rotation || 0;
        dragWith(e, (ev) => {
          const a = Math.atan2(ev.clientY - cy, ev.clientX - cx);
          let deg = r0 + ((a - a0) * 180) / Math.PI;
          if (ev.shiftKey) deg = Math.round(deg / 15) * 15; // กด Shift = ล็อคทีละ 15°
          onUpdate(c.id, { transform: { ...tf, rotation: deg } });
        });
      };

      // ยืดความกว้าง "กล่องข้อความ" (boxW หน่วยพิกัดอ้างอิง) — กล่องกว้างกว่าข้อความแล้ว
      // จัดชิดซ้าย/กลาง/ขวา (st.align) ถึงเห็นผลจริง / ดับเบิลคลิกที่จับ = กลับเป็นพอดีข้อความ
      const startWidth = (e) => {
        const { cx } = centerOf(e);
        dragWith(e, (ev) => {
          const w = Math.max(60, (Math.abs(ev.clientX - cx) * 2) / screenScale);
          onUpdate(c.id, { style: { ...st, boxW: Math.round(w) } });
        });
      };
      const tl = time - c.offset; // เวลาปัจจุบันนับจากต้นก้อนข้อความ
      // fade เข้า-ออกหัวท้ายก้อนแบบเดียวกับวิดีโอ
      let fadeMul = 1;
      if (tf.fade > 0) {
        fadeMul = Math.max(0, Math.min(1, Math.min(tl, c.duration - tl) / tf.fade));
      }

      // จุดเริ่ม–จุดจบเอฟเฟกต์ (วินาที นับจากต้นก้อน): ข้อความโผล่เฉพาะช่วง [inAt, outAt]
      // เช่น ก้อนวางไว้ 0–9s แต่ให้ข้อความมีผลจริงแค่ 4–7s → นอกช่วงนี้ซ่อน
      const inAt = Math.max(0, st.inAt ?? 0);
      const outAt = st.outAt != null ? Math.min(c.duration, st.outAt) : c.duration;
      if (tl < inAt - 0.001 || tl > outAt + 0.001) fadeMul = 0;

      // อนิเมชั่นข้อความ (แท็บ Effect Controls) — p = ระดับ "โผล่เต็มตัว" (0 ซ่อน → 1 ปกติ)
      // ตัวแบบเข้า: วิ่ง 0→1 ที่จุด inAt / ตัวแบบออก: วิ่ง 1→0 จบพอดีที่ outAt
      // ใส่ easing (animEase) ปรับความหน่วงของเส้นก่อนคำนวณ style
      const easeId = st.animEase ?? "spring"; // ค่าเริ่มต้น spring ให้เด้งมีมิติแบบ jitter
      const hasPhases = !!(st.animIn || st.animOut);
      const inDur = Math.max(0.1, st.animInDur ?? st.animDur ?? 0.6);
      const outDur = Math.max(0.1, st.animOutDur ?? st.animDur ?? 0.6);
      const inActive = !!st.animIn && tl - inAt < inDur;
      const outActive = !!st.animOut && outAt - tl < outDur;
      const animId = hasPhases ? (outActive ? st.animOut : inActive ? st.animIn : null) : st.anim;
      const isOut = hasPhases ? outActive : (st.anim ? isOutAnim(st.anim) : false);
      const d = isOut ? outDur : inDur;
      // กระจายเอฟเฟกต์รายตัว: ทีละคำ (ค่าเริ่มต้น) / ตัวอักษร — เฉพาะเอฟเฟกต์ที่ทำได้
      // เอฟเฟกต์กลุ่ม "ทีละตัวอักษร" default เป็น letters ให้เลย
      const animBy = st.animBy ?? (LETTER_ANIMS.has(animId) ? "letters" : "words");
      const kinetic = animId && animBy !== "all" && KINETIC_ANIMS.has(animId);
      const stagger = st.animStagger != null ? st.animStagger : animBy === "letters" ? 0.035 : 0.08;

      let anim = { inner: null };
      if (animId && !kinetic) {
        const raw = isOut
          ? Math.max(0, Math.min(1, (outAt - tl) / d))
          : Math.max(0, Math.min(1, (tl - inAt) / d));
        anim = animStyle(animId, ease(easeId, raw), sz);
      }

      // style ของ item ลำดับ pos (จากทั้งหมด n) — เหลื่อมเวลาตาม stagger แล้วผ่าน spring
      const styleForPos = (pos, n) => {
        let raw;
        if (isOut) {
          // ออก: ตัวแรกที่ pos=0 เริ่มหายก่อน จบทั้งหมดพอดีที่ outAt
          const startOut = outAt - d - (n - 1) * stagger;
          raw = 1 - Math.max(0, Math.min(1, (tl - startOut - pos * stagger) / d));
        } else {
          raw = Math.max(0, Math.min(1, (tl - inAt - pos * stagger) / d));
        }
        return animStyle(animId, ease(easeId, raw), sz).inner || {};
      };
      return (
        <div
          key={c.id}
          className={`text-overlay ${editable ? "editable" : ""} ${selected ? "selected" : ""}`}
          onMouseDown={startMove}
          style={{
            transform:
              `translate(-50%, -50%) translate(${(tf.x || 0) * scale}px, ${(tf.y || 0) * scale}px) ` +
              `scale(${(tf.scale ?? 100) / 100}) rotate(${tf.rotation || 0}deg)`,
            opacity: ((tf.opacity ?? 100) / 100) * fadeMul,
            fontSize: sz,
            color: st.color || "#ffffff",
            fontFamily: st.font && st.font !== "System" ? `'${st.font}', sans-serif` : undefined,
            fontWeight: st.bold ? 700 : 400,
            fontStyle: st.italic ? "italic" : undefined,
            textDecoration: st.underline ? "underline" : undefined,
            textTransform:
              { upper: "uppercase", lower: "lowercase", title: "capitalize" }[st.textCase] ||
              undefined,
            textShadow: st.outline
              ? "0 0 4px rgba(0,0,0,0.9), 0 2px 8px rgba(0,0,0,0.6)"
              : undefined,
            WebkitTextStroke: st.stroke
              ? `${Math.max(1, sz / 28)}px ${st.stroke}` // ขอบตัวอักษร หนาตามขนาดฟอนต์
              : undefined,
            // กล่องหลังเป็นเลเยอร์แยก (วาดด้านล่าง) — ตรงนี้คุมแค่ padding รอบตัวอักษร
            padding: st.bubble
              ? bubblePad(st.bubble)
              : st.bg
                ? `${0.12 * ((st.bgPad ?? 100) / 100)}em ${0.35 * ((st.bgPad ?? 100) / 100)}em`
                : undefined,
            letterSpacing: st.letterSpacing ? `${st.letterSpacing * scale}px` : undefined, // ระยะห่างตัวอักษร
            lineHeight: `${sz * 1.2 + (st.lineSpacing || 0) * scale}px`, // ระยะห่างบรรทัด (ฐาน 1.2 ของขนาดฟอนต์)
            textAlign: st.align || "center",
            // ความกว้างกล่อง: ตั้งไว้ = จัดซ้าย/ขวาในกล่องได้จริง / ไม่ตั้ง = หดพอดีข้อความ (จำกัด 90%)
            width: st.boxW ? st.boxW * scale : undefined,
            maxWidth: st.boxW ? "none" : undefined,
            whiteSpace: "pre-wrap", // ให้ขึ้นบรรทัดใหม่ตามที่พิมพ์ใน textarea
            ...(st.effect ? effectStyle(st.effect, sz) : null), // WordArt ทับสี/เงาพื้นฐาน
            ...(anim.mask ? { clipPath: "inset(-0.15em -0.3em)" } : null), // Mask: บังตัวอักษรที่เลื่อนออกนอกกล่อง
          }}
        >
          {st.bubble && <BubbleSvg id={st.bubble} />}
          {!st.bubble && st.bg && (
            // กล่องหลังแยกเลเยอร์: ปรับทึบ/ขนาด/เลื่อนตำแหน่งได้โดยไม่แตะตัวอักษร
            <span
              style={{
                position: "absolute",
                inset: 0,
                background: hexToRgba(st.bg, (st.bgOpacity ?? 100) / 100),
                borderRadius: "0.15em",
                transform: `translate(${(st.bgX || 0) * scale}px, ${(st.bgY || 0) * scale}px)`,
                pointerEvents: "none",
              }}
            />
          )}
          <span style={{ position: "relative", display: "inline-block", ...(kinetic ? null : anim.inner || null) }}>
            {kinetic ? (
              <KineticText
                text={c.text}
                highlight={st.highlight || "#ff4d4d"}
                mode={animBy}
                order={st.animOrder || "forward"}
                seed={c.id}
                styleForPos={styleForPos}
              />
            ) : (
              renderRichText(c.text, st.highlight || "#ff4d4d")
            )}
          </span>
          {selected && editable && (
            <>
              <div className="tx-handle rotate" title="ลากเพื่อหมุน (Shift = ทีละ 15°)" onMouseDown={startRotate} />
              <div className="tx-handle scale" title="ลากเพื่อย่อ-ขยาย" onMouseDown={startScale} />
              <div
                className="tx-handle width"
                title="ลากเพื่อยืดกล่องข้อความ (แล้วจัดชิดซ้าย/ขวาได้) — ดับเบิลคลิก = กลับเป็นพอดีข้อความ"
                onMouseDown={startWidth}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  const s = { ...st };
                  delete s.boxW;
                  onUpdate(c.id, { style: s });
                }}
              />
            </>
          )}
        </div>
      );
    });
}

export default function Monitor({
  sequence = [],
  overlay = [],
  overlay2 = [], // วิดีโอบน V3 — ชั้นบนสุดก่อนถึงข้อความ
  audio = [], // เสียงที่แยกออกจากวิดีโอแล้ว
  blanks = [], // ก้อน Scene (พื้นดำเปล่า) — ไม่มีไฟล์ นับแค่ความยาวรวม เล่นเป็นจอดำ
  fx = [], // ก้อนแบ่งฉากจากเลน FX — คุมการแบ่งจอ V1/V2 ช่วงเวลาของก้อน
  texts = [],
  sceneMedia = [],
  placeholder,
  onPlayback,
  controlRef,
  muted = false,
  playRange = null,
  onDropClip,
  onPlayingChange,
  selectedId = null,
  onSelect,
  onUpdateClip,
  drawMode = false, // โหมดวาดกรอบ (ลบวัตถุ AI): ลากกรอบบนจอ → onDrawRect({x,y,w,h} สัดส่วน 0–1) / Esc = ยกเลิก
  drawHint,
  onDrawRect,
  maskDrawMode = false,
  onDrawMask,
  maskToolActive = false,
  maskRedraw = 0,
  onDeleteMask,
  onExitMask,
}) {
  const videoRef = useRef(null);
  const bgVideoRef = useRef(null); // วิดีโอฉากหลังเบลอ (เอฟเฟค "พื้นหลังเบลอ") — sync เวลากับตัวหลัก
  const scrubberRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // สัดส่วนภาพที่เลือก + เมนูเลือกสัดส่วน
  const [aspect, setAspect] = useState(RATIOS[0]);
  const [ratioMenu, setRatioMenu] = useState(false);
  useEffect(() => {
    if (!ratioMenu) return;
    const close = () => setRatioMenu(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [ratioMenu]);

  // วัดขนาดจอจริงด้วย ResizeObserver แล้วคำนวณกรอบสัดส่วนเป็น px ตรงๆ
  // (ปล่อยให้ CSS aspect-ratio คิดเองแล้วมันล้นกรอบ)
  const viewportElRef = useRef(null);
  const [vpSize, setVpSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = viewportElRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setVpSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stageStyle = (() => {
    if (!aspect.v || !vpSize.w || !vpSize.h) return undefined;
    const fitW = Math.min(vpSize.w, vpSize.h * aspect.v);
    return { width: fitW, height: fitW / aspect.v };
  })();

  // ---- กล่องเนื้อวิดีโอ (content box) — ระบบพิกัด "มิติเดียว" ของ overlay ทั้งหมด ----
  // เดิมยึดขนาด viewport → จอเปลี่ยนทรง ข้อความหลุด/บรรทัดเปลี่ยน ตอนนี้ยึด "สัดส่วนจริงของวิดีโอ":
  // เลือกสัดส่วนไว้ = ตาม stage / ไม่เลือก = fit ตามสัดส่วนวิดีโอ V1 (ที่เหลือเป็นขอบดำนอกกล่อง)
  // ทุกเลเยอร์อยู่ "ใน" กล่องนี้ + overflow hidden → ไม่มีอะไรล้นกรอบวิดีโอเด็ดขาด
  const [vidAR, setVidAR] = useState(null); // สัดส่วนจริงของวิดีโอ (อ่านจาก metadata)
  const REF_W = 640; // หน่วยพิกัดอ้างอิง (คงที่) — st.size/tf.x/tf.y ทั้งหมดอยู่ในสเกลนี้
  const contentW = stageStyle
    ? stageStyle.width
    : vpSize.w && vpSize.h
      ? Math.min(vpSize.w, vpSize.h * (vidAR || 16 / 9))
      : 0;
  const contentH = stageStyle ? stageStyle.height : contentW ? contentW / (vidAR || 16 / 9) : 0;
  const dispAspect = contentW && contentH ? contentW / contentH : 16 / 9;
  const layerW = REF_W;
  const layerH = REF_W / dispAspect;
  const overlayScale = contentW ? contentW / REF_W : 1; // = k: สเกลเลเยอร์ให้กว้างเท่าเนื้อวิดีโอ
  const [time, setTime] = useState(0); // เวลาบนแกนรวม
  const [index, setIndex] = useState(0); // คลิปที่กำลังเล่นอยู่ใน sequence
  const pendingSeekRef = useRef(null); // เวลาใน "คลิป" ที่ต้อง set หลัง src ใหม่โหลดเสร็จ
  const autoplayRef = useRef(false); // ให้เล่นต่อทันทีหลังสลับคลิป
  const gapRef = useRef(null); // กำลังไหลผ่านช่องว่างระหว่างคลิป: {raf}
  const [inGap, setInGap] = useState(false); // ใช้ซ่อนภาพ (จอดำ) ระหว่างช่องว่าง

  const last = sequence[sequence.length - 1];
  const seqEnd = last ? last.offset + last.duration : 0; // จุดจบของเลน V1
  // ความยาวรวมคิดจาก "ทุกเลน" — ไม่มี V1 ก็เล่นได้ (พื้นหลังดำ) เช่นทำเอฟเฟกต์บนพื้นดำ
  const layerEnd = Math.max(
    0,
    ...[...overlay, ...overlay2, ...texts, ...blanks].map((c) => c.offset + c.duration)
  );
  const total = Math.max(seqEnd, layerEnd);
  const current = sequence[Math.min(index, sequence.length - 1)] || null;
  const maskProps = { selectedId, active: maskToolActive, redraw: maskRedraw, onCommit: onDrawMask, onDelete: onDeleteMask, onExit: onExitMask };

  // transform ต่อคลิป (จาก Properties): Position/Scale/Rotation/Opacity/Volume/Blur/Blend/Flip/Fade
  const tf = current?.transform || {};
  const spd = current?.speed || 1; // สปีดเฉพาะก้อน — duration บน timeline ถูกหาร speed ไว้แล้ว

  // ---- ก้อนแบ่งฉาก (เลน FX1/FX2) ที่คร่อมเวลาปัจจุบัน — ทำงานพร้อมกันได้ 2 ก้อน ----
  const fxActives = fx.filter((c) => time >= c.offset && time < c.offset + c.duration);
  // censor = กล่องเบลอทับภาพ (โชว์ได้ทุกก้อนพร้อมกัน ไม่จำกัด) — แยกจาก split/shape
  const fxCensors = fxActives.filter((c) => c.kind === "censor");
  // split: V1 ได้ครึ่งระนาบฝั่งหนึ่ง / V2 ฝั่งตรงข้าม (ใช้ split ได้ทีละก้อน)
  const fxSplit = fxActives.find((c) => c.kind === "split") || null;
  const fxShapes = fxActives.filter((c) => c.kind === "shape");
  const toBox = (s) => (s ? { cx: s.cx, cy: s.cy, size: s.size, shape: s.shape } : null);
  const fxMainClip = fxSplit ? halfPlaneClip(fxSplit.cx, fxSplit.cy, fxSplit.angle, false) : null;
  const fxOverlayClip = fxSplit ? halfPlaneClip(fxSplit.cx, fxSplit.cy, fxSplit.angle, true) : null;
  // shape: กล่องทรงลอย — ปกติคุม V2 / ถ้า V2 ถูก split ใช้อยู่ (หรือมี shape สองก้อน) ก้อนถัดไปคุม V3
  const fxOverlayBox = fxSplit ? null : toBox(fxShapes[0]);
  const fxOverlay2Box = toBox(fxSplit ? fxShapes[0] : fxShapes[1]);

  // ---- Web Audio: source → gain (Level 0-500%) → pan (ซ้าย-ขวา) → limiter (กันเสียงแตก) ----
  // ใช้แทน <video>.volume เพราะ property นั้น browser จำกัดไว้ที่ 1.0 (100%) บูสต์เกินไม่ได้
  const audioRef = useRef(null); // {ctx, src, gain, pan, comp, el}

  const ensureAudioGraph = (v) => {
    let a = audioRef.current;
    if (a && a.el === v) return a;
    // element เก่าถูก remount ทิ้งไปแล้ว (key ต่อคลิป) — ตัด node เก่าออกจาก graph
    if (a) {
      try {
        a.src.disconnect();
        a.gain.disconnect();
        a.pan.disconnect();
        a.splitter?.disconnect();
        a.anL?.disconnect();
        a.anR?.disconnect();
        a.merger?.disconnect();
        a.comp.disconnect();
      } catch {}
    }
    const ctx = a?.ctx || new AudioContext();
    const src = ctx.createMediaElementSource(v);
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner();
    const splitter = ctx.createChannelSplitter(2);
    const anL = ctx.createAnalyser();
    const anR = ctx.createAnalyser();
    const merger = ctx.createChannelMerger(2);
    anL.fftSize = anR.fftSize = 256;
    anL.smoothingTimeConstant = anR.smoothingTimeConstant = 0.72;
    const comp = ctx.createDynamicsCompressor(); // ทำหน้าที่ limiter: ratio สูง knee แข็ง attack ไว
    comp.threshold.value = -3;
    comp.knee.value = 0;
    comp.ratio.value = 20;
    comp.attack.value = 0.002;
    comp.release.value = 0.1;
    src.connect(gain);
    gain.connect(pan);
    pan.connect(splitter);
    splitter.connect(anL, 0);
    splitter.connect(anR, 1);
    anL.connect(merger, 0, 0);
    anR.connect(merger, 0, 1);
    merger.connect(comp);
    comp.connect(ctx.destination);
    a = { ctx, src, gain, pan, splitter, anL, anR, merger, comp, el: v };
    audioRef.current = a;
    return a;
  };

  // fade เสียงหัว-ท้ายก้อน (แยกจาก fade ภาพ): คูณ gain ตามระยะห่างจากขอบคลิป
  const audioFadeMul = (g) => {
    if (!current) return 1;
    const fadeIn = tf.audioFadeIn || 0;
    const fadeOut = tf.audioFadeOut || 0;
    const tl = g - current.offset;
    const rem = current.duration - tl;
    let m = 1;
    if (fadeIn > 0) m = Math.min(m, tl / fadeIn);
    if (fadeOut > 0) m = Math.min(m, rem / fadeOut);
    return Math.max(0, Math.min(1, m));
  };

  // ไล่ค่าแบบ setTargetAtTime กัน zipper noise/pop เวลาเปลี่ยนค่าแรงๆ (เช่น 500%→200%)
  const updateAudioParams = (g) => {
    const a = audioRef.current;
    if (!a) return;
    const base = current?.audioDetached ? 0 : Math.max(0, Math.min(5, (tf.volume ?? 100) / 100));
    const now = a.ctx.currentTime;
    a.gain.gain.setTargetAtTime(base * audioFadeMul(g), now, 0.05);
    a.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, (tf.pan || 0) / 100)), now, 0.05);
  };

  // playbackRate คุมผ่าน property ของ <video> (attribute ไม่มี) — เสียงคุมผ่าน Web Audio ทั้งหมด
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = 1; // ให้ gain node เป็นคนคุมระดับแทน
    v.playbackRate = spd;
    updateAudioParams(globalNow());
  }, [tf.volume, tf.pan, tf.audioFadeIn, tf.audioFadeOut, spd, index]);

  // sequence สั้นลงจน index หลุดขอบ → กลับคลิปแรก
  useEffect(() => {
    if (sequence.length && index >= sequence.length) setIndex(0);
    if (!sequence.length) {
      setIndex(0);
      setIsPlaying(false);
      if (total <= 0) {
        // ไม่เหลือคลิปเลนไหนเลย ค่อยรีเซ็ตเวลา — ถ้า V2/V3 ยังอยู่ให้เล่นบนพื้นดำต่อได้
        cancelGap();
        setTime(0);
        onPlayback?.(0, 0);
      }
    }
  }, [sequence.length]);

  const rangeRef = useRef(null);
  rangeRef.current = playRange && playRange.end - playRange.start > 0.05 ? playRange : null;

  // คลิปที่ถูกแบ่ง: inPoint = จุดเริ่มในไฟล์ต้นฉบับ (เวลาใน <video> = inPoint + เวลาในท่อน)
  const inPt = (c) => c?.inPoint || 0;

  // เวลาบนแกนรวม = offset + (เวลาในไฟล์ - จุด in) / สปีด
  const globalNow = () => {
    const v = videoRef.current;
    return current
      ? current.offset + (v ? (v.currentTime - inPt(current)) / (current.speed || 1) : 0)
      : 0;
  };

  // ---- โหมดช่องว่าง: จอดำ + เวลาเดินตามจริง จนถึงต้นคลิปถัดไปค่อยเล่นต่อ ----
  const cancelGap = () => {
    if (gapRef.current) {
      cancelAnimationFrame(gapRef.current.raf);
      gapRef.current = null;
      setInGap(false);
      onPlayingChange?.(false);
    }
  };

  const startGap = (from, until, nextIndex) => {
    if (maskToolActive) return;
    if (gapRef.current) return;
    setInGap(true);
    onPlayingChange?.(true); // ให้ timeline ยัง auto-follow ระหว่างไหลผ่านช่องว่าง
    const t0 = performance.now();
    gapRef.current = { raf: 0 };
    const tick = () => {
      if (!gapRef.current) return;
      const g = from + (performance.now() - t0) / 1000;
      if (g >= until) {
        gapRef.current = null;
        setInGap(false);
        if (nextIndex == null) {
          // เดินเวลาบนพื้นดำจนสุด (ไม่มีคลิป V1 ถัดไป) → หยุดตรงปลาย
          setTime(until);
          onPlayback?.(until, total);
          onPlayingChange?.(false);
        } else {
          autoplayRef.current = true;
          pendingSeekRef.current = null;
          setIndex(nextIndex);
        }
      } else {
        setTime(g);
        onPlayback?.(g, total);
        gapRef.current.raf = requestAnimationFrame(tick);
      }
    };
    gapRef.current.raf = requestAnimationFrame(tick);
  };

  useEffect(() => cancelGap, []); // unmount แล้วอย่าปล่อย rAF ค้าง

  // ส่งระดับเสียงจริงจาก Web Audio analyser ไปยังมิเตอร์ข้าง Timeline
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const bufL = new Float32Array(128), bufR = new Float32Array(128);
    const dbOf = (an, buf) => {
      if (!an) return -60;
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      return rms > 0.0001 ? Math.max(-60, Math.min(0, 20 * Math.log10(rms))) : -60;
    };
    const tick = (now) => {
      if (now - last > 32) {
        const a = audioRef.current;
        window.dispatchEvent(new CustomEvent("clipeasy:audio-level", { detail: { source: "program-main", left: dbOf(a?.anL, bufL), right: dbOf(a?.anR, bufR), active: !!a && a.ctx.state === "running" } }));
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.dispatchEvent(new CustomEvent("clipeasy:audio-level", { detail: { source: "program-main", remove: true } })); };
  }, []);

  // unmount ทั้ง Monitor → ปิด AudioContext ไม่ให้ค้าง
  useEffect(
    () => () => {
      audioRef.current?.ctx.close().catch(() => {});
      audioRef.current = null;
    },
    []
  );

  // ไปคลิปถัดไป — ถ้ามีช่องว่างคั่นให้ไหลผ่านช่องว่างก่อน (เวลาเดินจริง ไม่กระโดดข้าม)
  const advanceToNext = (wasPlaying) => {
    const next = sequence[index + 1];
    const curEnd = current.offset + current.duration;
    if (next.offset - curEnd > 0.05 && wasPlaying) {
      startGap(curEnd, next.offset, index + 1);
    } else {
      autoplayRef.current = wasPlaying;
      pendingSeekRef.current = null;
      setIndex(index + 1);
    }
  };

  // ท่อนนี้เล่นถึงจุด out แล้ว → ไปท่อนถัดไป (หรือหยุดถ้าเป็นท่อนสุดท้าย)
  const advanceIfClipEnded = (v) => {
    if (maskToolActive || !current || gapRef.current) return;
    // จุด out ในไฟล์ = in + ความยาว timeline × สปีด
    const endT = inPt(current) + current.duration * (current.speed || 1);
    if (v.currentTime >= endT - 0.03) {
      if (index < sequence.length - 1) {
        const wasPlaying = !v.paused;
        if (wasPlaying) v.pause();
        advanceToNext(wasPlaying);
      } else if (!v.paused) {
        v.pause();
        // เลนอื่น (V2/V3/ข้อความ) ยาวกว่า V1 → เดินต่อบนพื้นดำจนสุด
        const endG = current.offset + current.duration;
        if (total - endG > 0.05) startGap(endG, total, null);
      }
    }
  };

  // seek บนแกนรวม — ข้ามไปคลิปอื่นใน sequence ให้เองถ้าจำเป็น
  const seekTo = (t) => {
    if (total <= 0) return;
    cancelGap(); // ผู้ใช้ seek เอง = ออกจากโหมดไหลผ่านช่องว่าง
    let g = Math.min(Math.max(t, 0), total);
    // ไม่มีคลิป V1 เลย หรือ seek เลยท้าย V1 ไปช่วงพื้นดำ → ตั้งเวลาตรงๆ ไม่ต้องยุ่งกับ <video>
    if (!sequence.length || g > seqEnd + 0.001) {
      videoRef.current?.pause();
      setTime(g);
      onPlayback?.(g, total);
      return;
    }
    let i = sequence.findIndex((c) => g < c.offset + c.duration);
    if (i === -1) i = sequence.length - 1;
    // จิ้มลงช่องว่างระหว่างคลิป → เด้งไปต้นคลิปถัดไป
    if (g < sequence[i].offset) g = sequence[i].offset;
    const local = Math.max(0, Math.min(g - sequence[i].offset, sequence[i].duration));
    // เวลาจริงในไฟล์ต้นฉบับ (คูณสปีดของก้อน)
    const fileT = (sequence[i].inPoint || 0) + local * (sequence[i].speed || 1);
    const v = videoRef.current;
    if (i === index && v) {
      v.currentTime = fileT;
    } else {
      autoplayRef.current = isPlaying;
      pendingSeekRef.current = fileT;
      setIndex(i);
    }
    setTime(g);
    onPlayback?.(g, total);
  };

  if (controlRef) controlRef.current = { seekTo, pause: () => { autoplayRef.current = false; videoRef.current?.pause(); bgVideoRef.current?.pause(); cancelGap(); setIsPlaying(false); onPlayingChange?.(false); } };

  // ถ้าเลยขอบ out ของช่วงที่เลือก → วนกลับไปเล่นที่ in ใหม่ (แกนรวม)
  const enforceRange = () => {
    const r = rangeRef.current;
    const v = videoRef.current;
    if (!r || !v || v.paused) return;
    const g = globalNow();
    if (g >= r.end || g < r.start - 0.25) seekTo(r.start);
  };

  const togglePlay = () => {
    if (maskToolActive) return;
    if (gapRef.current) {
      // กด pause กลางช่องว่าง → หยุดตรงนั้น
      cancelGap();
      return;
    }
    const v = videoRef.current;
    // ไม่มี V1 คุมเวลาอยู่ (เลนว่าง หรือเวลาปัจจุบันเลยท้าย V1 ไปแล้ว) → เดินเวลาเองบนพื้นดำ
    if (!current || time > seqEnd + 0.001) {
      if (total <= 0) return;
      if (time >= total - 0.01) {
        // จบสุดทางแล้วกดเล่นซ้ำ — วนกลับจุดเริ่ม
        autoplayRef.current = sequence.length > 0;
        seekTo(0);
        if (!sequence.length) startGap(0, total, null);
        else videoRef.current?.play().catch(() => {}); // index เดิมไม่ remount — สั่งเล่นเองด้วย
      } else {
        startGap(time, total, null);
      }
      return;
    }
    if (!v) return;
    if (v.paused) {
      const r = rangeRef.current;
      const g = globalNow();
      if (r && (g < r.start || g >= r.end)) {
        autoplayRef.current = true;
        seekTo(r.start);
      }
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  };

  // โหมด Mask เป็นโหมดแก้เฟรมหยุดนิ่ง: เข้าโหมดเมื่อไรให้หยุดภาพและเสียงทุกชั้นทันที
  useEffect(() => {
    if (!maskToolActive) return;
    autoplayRef.current = false;
    videoRef.current?.pause();
    bgVideoRef.current?.pause();
    if (gapRef.current) cancelGap();
    setIsPlaying(false);
    onPlayingChange?.(false);
  }, [maskToolActive]);

  // ระหว่างเล่น: อัปเดตเวลาแบบ rAF ให้ playhead บน timeline วิ่งลื่น
  useEffect(() => {
    if (!isPlaying) return;
    let raf;
    const tick = () => {
      const v = videoRef.current;
      if (v) advanceIfClipEnded(v);
      enforceRange();
      const g = globalNow();
      updateAudioParams(g); // fade เสียงต้องอัปเดตตามเวลาจริงทุกเฟรม
      setTime(g);
      onPlayback?.(g, total);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, index, total]);

  const onScrub = (e) => {
    e.preventDefault();
    const rect = scrubberRef.current.getBoundingClientRect();
    const seekAt = (clientX) => {
      const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
      seekTo(ratio * total);
    };
    seekAt(e.clientX);
    document.body.classList.add("scrubbing");
    const onMove = (ev) => seekAt(ev.clientX);
    const onUp = () => {
      document.body.classList.remove("scrubbing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const progress = total > 0 ? time / total : 0;

  return (
    <>
      <div
        className="monitor-viewport"
        ref={viewportElRef}
        onDragOver={(e) => {
          if (onDropClip && e.dataTransfer.types.includes("application/x-clip-path")) e.preventDefault();
        }}
        onDrop={(e) => {
          const path = e.dataTransfer.getData("application/x-clip-path");
          if (onDropClip && path) {
            e.preventDefault();
            onDropClip(path);
          }
        }}
      >
        <div className={`monitor-stage ${aspect.v ? "cropped" : ""}`} style={stageStyle}>
        {/* กล่องเนื้อวิดีโอ: ทุกเลเยอร์อยู่ข้างใน + overflow hidden — อะไรเกินกรอบวิดีโอถูกตัดทิ้ง (เหมือนผล export) */}
        <div
          className="monitor-content"
          style={contentW ? { width: contentW, height: contentH } : { width: "100%", height: "100%" }}
        >
        {current && tf.videoFx === "blur-bg" && (
          // ฉากหลังเบลอ: วิดีโอตัวเดิมเต็มจอ+เบลอ อยู่ใต้ตัวหลัก (sync เวลาใน onTimeUpdate)
          <video
            key={`bg-${current.id}`}
            ref={bgVideoRef}
            className="monitor-video-bg"
            src={current.url}
            muted
            style={{ visibility: inGap || time > seqEnd + 0.02 ? "hidden" : undefined }}
          />
        )}
        {current ? (
          <video
            key={current.id} /* remount ต่อคลิป — ให้ loadedmetadata ยิงแม้ไฟล์เดิมซ้ำ */
            ref={videoRef}
            className="monitor-video"
            style={(() => {
              // fade เข้า-ออกหัวท้ายก้อน (Time): คูณ opacity ตามระยะห่างจากขอบคลิป
              let fadeMul = 1;
              const fade = tf.fade || 0;
              if (fade > 0 && current) {
                const tl = time - current.offset;
                const rem = current.duration - tl;
                fadeMul = Math.max(0, Math.min(1, Math.min(tl, rem) / fade));
              }
              const tv = tvOnStyle(current, time);
              return {
                // จอดำระหว่างช่องว่าง และช่วงท้ายที่เลยคลิป V1 สุดท้ายไปแล้ว (เลนอื่นยังเล่นต่อ)
                visibility: inGap || time > seqEnd + 0.02 ? "hidden" : undefined,
                // Effect Video: Letterbox/พื้นหลังเบลอ — เห็นเต็มตัวไม่ครอป (ที่เหลือเป็นขอบดำ/ภาพเบลอ)
                objectFit: tf.videoFx === "fit" || tf.videoFx === "blur-bg" ? "contain" : undefined,
                clipPath: videoTransitionClip(current, time) ?? (cinemaInset(current, time) != null ? `inset(${cinemaInset(current, time)}% 0)` : (fxMainClip ?? SHAPE_CLIP[tf.shape])) /* แบ่งฉาก/ม่านหนัง/Iris */,
                ...(tf.videoFx === "crt-screen" ? { WebkitMaskImage: CRT_SOFT_MASK, maskImage: CRT_SOFT_MASK, WebkitMaskSize: "100% 100%", maskSize: "100% 100%", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat" } : {}),
                transform:
                  `translate(${((tf.x || 0) + tv.x) * overlayScale}px, ${((tf.y || 0) + tv.y) * overlayScale}px) ` +
                  `skewX(${tv.skew}deg) ` +
                  `scale(${((tf.scale ?? 100) / 100) * (tf.flipH ? -1 : 1) * tv.scaleX}, ${((tf.scale ?? 100) / 100) * (tf.flipV ? -1 : 1) * tv.scaleY}) ` +
                  `rotate(${tf.rotation || 0}deg)`,
                opacity: ((tf.opacity ?? 100) / 100) * fadeMul * tv.opacity * videoTransitionOpacity(current, time),
                filter:
                  [
                    lookFilter(tf.look), // โทนภาพ (กลางคืน/ฟิล์มเก่า ฯลฯ)
                    colorGradeFilter(tf.colorGrade, tf.colorGradeStrength),
                    tf.blur ? `blur(${tf.blur}px)` : "",
                    tf.sharpen > 0 ? "url(#vid-sharpen)" : "", // SVG filter ด้านล่าง (CSS ไม่มี sharpen)
                    tf.videoFx === "crt-screen" ? "contrast(1.1) saturate(.88) brightness(.94)" : "",
                    tv.filter,
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined,
                mixBlendMode: tf.blend && tf.blend !== "normal" ? tf.blend : undefined,
              };
            })()}
            src={current.url}
            crossOrigin="anonymous" /* จำเป็นสำหรับ Web Audio — ไม่มีแล้ว graph จะเงียบ */
            muted={muted || current.audioDetached}
            onPlay={(e) => {
              if (maskToolActive) { e.target.pause(); return; }
              const a = ensureAudioGraph(e.target);
              a.ctx.resume().catch(() => {}); // autoplay policy อาจ suspend context ไว้
              bgVideoRef.current?.play().catch(() => {});
              setIsPlaying(true);
              onPlayingChange?.(true);
            }}
            onPause={() => {
              bgVideoRef.current?.pause();
              setIsPlaying(false);
              onPlayingChange?.(false);
            }}
            onTimeUpdate={(e) => {
              advanceIfClipEnded(e.target); // ท่อนที่ถูกตัดจบก่อนท้ายไฟล์
              enforceRange(); // กันกรณี rAF ไม่ทำงาน (เช่นสลับไปแท็บอื่น)
              updateAudioParams(globalNow());
              // ฉากหลังเบลอ: ตามเวลาตัวหลัก แก้เฉพาะตอนเพี้ยนเกิน 0.3s (seek บ่อยจะกระตุก)
              const bg = bgVideoRef.current;
              if (bg) {
                if (Math.abs(bg.currentTime - e.target.currentTime) > 0.3)
                  bg.currentTime = e.target.currentTime;
                bg.playbackRate = e.target.playbackRate;
                if (e.target.paused !== bg.paused) (e.target.paused ? bg.pause() : bg.play().catch(() => {}));
              }
              setTime(globalNow());
              onPlayback?.(globalNow(), total);
            }}
            onLoadedMetadata={(e) => {
              const v = e.target;
              // สัดส่วนจริงของวิดีโอ → ใช้คำนวณกล่องเนื้อวิดีโอ (content box)
              if (v.videoWidth && v.videoHeight) setVidAR(v.videoWidth / v.videoHeight);
              ensureAudioGraph(v); // ต่อ audio graph ทันทีที่ element ใหม่พร้อม (remount ต่อคลิป)
              updateAudioParams(globalNow());
              // ไม่มีคำสั่ง seek ค้าง → เริ่มที่จุด in ของท่อนนี้ (ท่อนหลังของคลิปที่ถูกแบ่ง)
              v.currentTime = pendingSeekRef.current ?? inPt(current);
              pendingSeekRef.current = null;
              if (autoplayRef.current && !maskToolActive) {
                autoplayRef.current = false;
                v.play().catch(() => {});
              }
              onPlayback?.(globalNow(), total);
            }}
            onEnded={() => {
              if (maskToolActive) return;
              // จบไฟล์คลิปนี้ → ไปคลิปถัดไป (ผ่านช่องว่างถ้ามี)
              if (gapRef.current) return;
              if (index < sequence.length - 1) {
                advanceToNext(true);
              } else {
                setIsPlaying(false);
                // เลนอื่นยาวกว่า V1 → เล่นต่อบนพื้นดำจนสุด
                if (total - seqEnd > 0.05) startGap(seqEnd, total, null);
              }
            }}
            onClick={togglePlay}
            onContextMenu={e => { if (maskToolActive) e.preventDefault(); }}
          />
        ) : total > 0 ? null : ( /* มีคลิปเลนอื่นอยู่ → พื้นดำ ไม่ใช่ข้อความ placeholder */
          placeholder
        )}
        {current && <MaskSurface sourceRef={videoRef} clip={current} time={time}
          selected={current.id === selectedId} active={maskDrawMode && current.id === selectedId && !current.locked}
          redraw={maskRedraw} onCommit={onDrawMask} onDelete={onDeleteMask} onExit={onExitMask} />}
        {current && tvOnStyle(current, time).scan > 0 && (
          <div className="tv-on-scanlines" style={{ opacity: tvOnStyle(current, time).scan, transform: `translateY(${Math.sin(time * 90) * 2}px)` }} />
        )}
        {current && tf.videoFx === "crt-screen" && <div className="crt-screen-overlay" />}
        {current && tvOnStyle(current, time).wave > 0 && (
          <svg width="0" height="0" className="tv-wave-filter" aria-hidden="true">
            <filter id="tv-wave" x="-20%" y="-20%" width="140%" height="140%">
              <feTurbulence type="turbulence" baseFrequency={`0.008 ${0.045 + Math.abs(Math.sin(time * 31)) * .025}`} numOctaves="2" seed={Math.floor(time * 24) % 97} result="noise" />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale={tvOnStyle(current, time).wave} xChannelSelector="R" yChannelSelector="G" />
            </filter>
          </svg>
        )}
        {/* ฟิลเตอร์ sharpen (unsharp kernel) — ความแรงตาม slider Sharpen ของก้อนปัจจุบัน */}
        {tf.sharpen > 0 && (
          <svg width="0" height="0" style={{ position: "absolute" }}>
            <filter id="vid-sharpen">
              <feConvolveMatrix
                order="3"
                preserveAlpha="true"
                kernelMatrix={(() => {
                  const k = (tf.sharpen / 100) * 1.2; // 0–1.2 กำลังพอดี ไม่แตกเป็นเม็ด
                  return `0 ${-k} 0 ${-k} ${1 + 4 * k} ${-k} 0 ${-k} 0`;
                })()}
              />
            </filter>
          </svg>
        )}
        {overlay.length > 0 && (
          <OverlayVideo
            clips={overlay}
            time={time}
            playing={!maskToolActive && (isPlaying || inGap)}
            muted={muted}
            maskProps={maskProps}
            fxClip={fxOverlayClip}
            fxBox={fxOverlayBox}
            scale={overlayScale}
          />
        )}
        {overlay2.length > 0 && (
          <OverlayVideo
            clips={overlay2}
            time={time}
            playing={!maskToolActive && (isPlaying || inGap)}
            muted={muted}
            maskProps={maskProps}
            fxBox={fxOverlay2Box}
            scale={overlayScale}
          />
        )}
        {audio.map((clip) => (
          <DetachedAudioLayer
            key={clip.id}
            clip={clip}
            time={time}
            playing={!maskToolActive && (isPlaying || inGap)}
            muted={muted || clip.hidden}
          />
        ))}
        {/* กล่องเซ็นเซอร์ (เบลอ/โมเสก) — โชว์ทุกก้อนที่คร่อมเวลานี้ ทับบนวิดีโอทุกชั้น */}
        {fxCensors.map((c) => (
          <CensorBox
            key={c.id}
            fx={c}
            editable={!!onUpdateClip && c.id === selectedId}
            onUpdate={onUpdateClip}
          />
        ))}
        {/* เส้นแบ่งจริง (ถ้าเปิดไว้ในก้อน) — เห็นตลอดช่วงเอฟเฟกต์เหมือนผลลัพธ์จริง */}
        {fxSplit?.line && <FxDividerLine fx={fxSplit} />}
        {/* จุดจับปรับแบ่งฉาก — โชว์เฉพาะตอนก้อน FX นั้น "ถูกคลิกเลือก" บน timeline (ไม่โผล่ระหว่างเล่นเฉยๆ) */}
        {onUpdateClip &&
          fxActives
            .filter((c) => c.id === selectedId && c.kind !== "censor")
            .map((c) => <FxEditor key={c.id} fx={c} onUpdate={onUpdateClip} />)}
        {drawMode && <DrawRectOverlay onDone={onDrawRect} hint={drawHint} videoRef={videoRef} />}
        {sceneMedia.length > 0 && (
          // ใช้เฟรมอ้างอิงเดียวกับข้อความ: ย่อ/ขยาย Monitor แล้วตำแหน่งกับขนาดยังเกาะวิดีโอ
          <div
            className="scene-media-layer"
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              width: layerW,
              height: layerH,
              transform: `translate(-50%, -50%) scale(${overlayScale})`,
              transformOrigin: "center center",
              pointerEvents: "none",
              zIndex: 40,
            }}
          >
            <SceneMediaLayer clips={sceneMedia} time={time} selectedId={selectedId} onSelect={onSelect} onUpdate={onUpdateClip} screenScale={overlayScale} layerW={layerW} layerH={layerH} />
          </div>
        )}
        {texts.length > 0 && (
          // เลเยอร์ข้อความ: ขนาดคงที่ (baseW×baseH) แล้วสเกลทั้งก้อนพร้อมกัน
          // → ฟอนต์/ตำแหน่ง/การห่อบรรทัด สเกลเท่ากันเป๊ะ ข้อความเกาะวิดีโอไม่หลุด ไม่เปลี่ยนจำนวนบรรทัด
          <div
            className="text-layer"
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              width: layerW,
              height: layerH,
              transform: `translate(-50%, -50%) scale(${overlayScale})`,
              transformOrigin: "center center",
              pointerEvents: "none",
              zIndex: 45, // อยู่เหนือวิดีโอทุกเลน + เซ็นเซอร์ (เหมือนเดิม)
            }}
          >
            <TextOverlay
              clips={texts}
              time={time}
              selectedId={selectedId}
              onSelect={onSelect}
              onUpdate={onUpdateClip}
              scale={1}
              screenScale={overlayScale}
            />
          </div>
        )}
        </div>
        </div>
      </div>

      <div className="monitor-scrubber">
        <div className="scrubber-track" ref={scrubberRef} onMouseDown={total > 0 ? onScrub : undefined}>
          <div className="scrubber-playhead" style={{ left: `${progress * 100}%` }} />
        </div>
      </div>

      <div className="monitor-controls">
        <span className="tc tc-current">{formatTC(time)}</span>
        <div className="transport">
          <button className="icon-btn" title="Go to start" onClick={() => seekTo(0)}>
            <SkipBack size={14} />
          </button>
          <button className="icon-btn" title="Step back 1 frame" onClick={() => seekTo(time - 1 / FPS)}>
            <StepBack size={14} />
          </button>
          <button className="icon-btn primary" title={maskToolActive ? 'ออกจาก Mask เพื่อเล่นวิดีโอ' : 'Play/Pause'} disabled={maskToolActive} onClick={togglePlay}>
            {isPlaying || inGap ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button className="icon-btn" title="Step forward 1 frame" onClick={() => seekTo(time + 1 / FPS)}>
            <StepForward size={14} />
          </button>
          <button className="icon-btn" title="Go to end" onClick={() => seekTo(total)}>
            <SkipForward size={14} />
          </button>
          <button className="icon-btn" title="Export frame">
            <Camera size={14} />
          </button>
        </div>
        {sequence.length > 0 && (
          <div className="ratio-wrap" onMouseDown={(e) => e.stopPropagation()}>
            <button
              className={`icon-btn ratio-btn ${aspect.v ? "active" : ""}`}
              title="สัดส่วนภาพ (ครอปให้เต็มเฟรม)"
              onClick={() => setRatioMenu((v) => !v)}
            >
              {aspect.v ? aspect.label : "Ratio"}
            </button>
            {ratioMenu && (
              <div className="ratio-menu">
                {RATIOS.map((r) => (
                  <button
                    key={r.label}
                    className={`ratio-item ${aspect.label === r.label ? "selected" : ""}`}
                    onClick={() => {
                      setAspect(r);
                      setRatioMenu(false);
                    }}
                  >
                    <span>{r.label}</span>
                    <RatioShape v={r.v} />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <span className="tc">{formatTC(total)}</span>
      </div>
    </>
  );
}
