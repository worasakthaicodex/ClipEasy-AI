import React from "react";
import avatarPreview from "../assets/image-controls-avatar.png";

/** อนิเมชั่นข้อความ — เก็บใน clip.style.anim (id) + style.animDur (วินาที)
 *  ทุกตัวเล่น "ตอนเข้า" ยกเว้น out:true เล่นช่วงท้ายก้อน (เช่น Disappear) */
export const TEXT_ANIMS = [
  {
    group: "Basic",
    items: [
      { id: "disappear", label: "Disappear", out: true },
      { id: "fade", label: "Fade" },
    ],
  },
  {
    group: "Slide",
    items: [
      { id: "slide-up", label: "Slide ↑" },
      { id: "slide-down", label: "Slide ↓" },
      { id: "slide-left", label: "Slide ←" },
      { id: "slide-right", label: "Slide →" },
    ],
  },
  {
    group: "Reveal",
    items: [
      { id: "typewriter", label: "ทีละตัวอักษร →" }, // เผยจากซ้ายไปขวา (พิมพ์ดีด)
      { id: "reveal-right", label: "ทีละตัวอักษร ←" }, // เผยจากขวาไปซ้าย
    ],
  },
  {
    group: "Mask",
    items: [
      { id: "mask-up", label: "Mask ↑" },
      { id: "mask-down", label: "Mask ↓" },
    ],
  },
  {
    group: "Scale",
    items: [
      { id: "grow", label: "Grow" },
      { id: "shrink", label: "Shrink" },
    ],
  },
  {
    group: "Blur",
    items: [
      { id: "blur", label: "Blur" },
      { id: "blur-slide-up", label: "Blur & Slide ↑" },
    ],
  },
];

export const isOutAnim = (id) => !!TEXT_ANIMS.flatMap((g) => g.items).find((a) => a.id === id)?.out;

/** เส้นความหน่วง (easing) ของอนิเมชั่นข้อความ — เก็บใน clip.style.animEase */
export const TEXT_EASINGS = [
  { id: "spring", label: "Spring (เด้ง)" }, // overshoot เด้งนิดๆ แบบ jitter — ค่าเริ่มต้น
  { id: "smooth", label: "Smooth" },      // นุ่มทั้งเข้า-ออก (smoothstep)
  { id: "natural", label: "Natural" },    // ออกตัวไว หน่วงปลายเบาๆ
  { id: "slow", label: "Slow down" },     // เบรกแรงตอนจบ (decelerate)
  { id: "accel", label: "Accelerate" },   // ออกตัวช้า เร่งตอนจบ (accelerate)
  { id: "linear", label: "None" },        // ตรงๆ ไม่หน่วง
];

/** วิธีกระจายเอฟเฟกต์: ทั้งข้อความ / ทีละคำ / ทีละตัวอักษร (เก็บใน style.animBy) */
export const ANIM_BY = [
  { id: "words", label: "ทีละคำ" },
  { id: "letters", label: "ทีละตัวอักษร" },
  { id: "all", label: "ทั้งข้อความ" },
];

/** ลำดับการไล่เอฟเฟกต์ (เก็บใน style.animOrder) */
export const ANIM_ORDER = [
  { id: "forward", label: "หน้า → หลัง" },
  { id: "backward", label: "หลัง → หน้า" },
  { id: "center", label: "จากกลางออก" },
  { id: "random", label: "สุ่ม" },
];

// อนิเมชั่นที่กระจายรายตัวอักษร/คำได้ (ตัวที่เป็น reveal ทั้งก้อนอย่าง mask ไม่เข้าพวกนี้)
export const KINETIC_ANIMS = new Set([
  "fade", "slide-up", "slide-down", "slide-left", "slide-right",
  "grow", "shrink", "blur", "blur-slide-up", "disappear",
  "typewriter", "reveal-right", // ป็อปเด้งทีละตัว (จริงๆ คือ kinetic รายตัวอักษร)
]);

// เอฟเฟกต์ที่เกิดมาเพื่อเล่น "ทีละตัวอักษร" — ตั้ง default animBy เป็น letters ให้เลย
export const LETTER_ANIMS = new Set(["typewriter", "reveal-right"]);

export const IMAGE_ANIMS = [
  { id: "fade", label: "Fade" },
  { id: "slide-left", label: "Slide ←" },
  { id: "slide-right", label: "Slide →" },
  { id: "slide-up", label: "Slide ↑" },
  { id: "zoom", label: "Zoom" },
  { id: "pop", label: "Pop" },
];

export function imageAnimStyle(id, p) {
  p = Math.max(0, Math.min(1, p));
  const inv = 1 - p;
  switch (id) {
    case "fade": return { opacity: p, transform: "" };
    case "slide-left": return { opacity: p, transform: `translateX(${inv * 120}px)` };
    case "slide-right": return { opacity: p, transform: `translateX(${-inv * 120}px)` };
    case "slide-up": return { opacity: p, transform: `translateY(${inv * 100}px)` };
    case "zoom": return { opacity: p, transform: `scale(${0.35 + p * 0.65})` };
    case "pop": return { opacity: p, transform: `scale(${0.7 + p * 0.3}) rotate(${inv * -8}deg)` };
    default: return { opacity: 1, transform: "" };
  }
}

function ImageAnimPanel({ clip, onUpdate }) {
  const [phase, setPhase] = React.useState("in");
  const [query, setQuery] = React.useState("");
  const tf = clip.transform || {};
  const field = phase === "in" ? "imageIn" : "imageOut";
  const selected = tf[field] || null;
  const shown = IMAGE_ANIMS.filter((a) => a.label.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="anim-panel split">
      <div className="anim-sidebar">
        <button className={`anim-side-item ${phase === "in" ? "active" : ""}`} onClick={() => setPhase("in")}>เข้า (In){tf.imageIn && <span className="anim-side-dot" />}</button>
        <button className={`anim-side-item ${phase === "out" ? "active" : ""}`} onClick={() => setPhase("out")}>ออก (Out){tf.imageOut && <span className="anim-side-dot" />}</button>
      </div>
      <div className="anim-content">
        <input className="anim-search" type="search" placeholder="ค้นหาเอฟเฟค..." value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="anim-group-title">BASIC · {phase === "in" ? "เข้า" : "ออก"}</div>
        <div className="anim-grid">
          {shown.map((a) => (
            <button key={a.id} className={`anim-card ${selected === a.id ? "selected" : ""}`} onClick={() => onUpdate(clip.id, { transform: { ...tf, [field]: selected === a.id ? null : a.id } })}>
              <span className="anim-thumb"><span className={`image-anim-demo image-${a.id} phase-${phase}`}><img src={avatarPreview} alt="" /></span>{selected === a.id && <span className="anim-check">✓</span>}</span>
              <span className="anim-card-label">{a.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** ปรับค่าความคืบหน้า t (0–1) ตามเส้น easing ที่เลือก */
export function ease(id, t) {
  t = Math.max(0, Math.min(1, t));
  switch (id) {
    case "spring": {
      // easeOutBack — พุ่งเลยเป้าเล็กน้อยแล้วดีดกลับเข้าที่ (ให้ความรู้สึก spring แบบ jitter)
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
    case "smooth":
      return t * t * (3 - 2 * t); // smoothstep — นุ่มหัวท้าย
    case "natural":
      return 1 - Math.pow(1 - t, 2.2); // ease-out นุ่มๆ
    case "slow":
      return 1 - Math.pow(1 - t, 3); // cubic-out เบรกแรงตอนจบ
    case "accel":
      return t * t * t; // cubic-in ออกตัวช้า
    default:
      return t; // linear / None
  }
}

/** คืน style ของตัวอักษรตาม progress p (0 = เริ่มอนิเมชั่น, 1 = จบ/นิ่ง)
 *  คืน { inner, mask } — inner ใส่ที่ span ตัวอักษร, mask=true ให้ครอบ clip-path ที่กล่องนอก */
export function animStyle(id, p, size = 48) {
  const inv = 1 - p; // ระยะที่เหลือ (1 → 0)
  const dist = Math.max(30, size * 1.2); // ระยะสไลด์ สเกลตามขนาดฟอนต์
  switch (id) {
    case "disappear":
      // แบบออก: โผล่ปกติทั้งก้อน แล้ว "หายวับ" ทันทีเมื่อเข้าช่วงท้าย (p < 1)
      return { inner: { opacity: p < 1 ? 0 : 1 } };
    case "fade":
      return { inner: { opacity: p } };
    case "slide-up":
      return { inner: { opacity: p, transform: `translateY(${inv * dist}px)` } };
    case "slide-down":
      return { inner: { opacity: p, transform: `translateY(${-inv * dist}px)` } };
    case "slide-left":
      return { inner: { opacity: p, transform: `translateX(${inv * dist}px)` } };
    case "slide-right":
      return { inner: { opacity: p, transform: `translateX(${-inv * dist}px)` } };
    case "typewriter":
      // ป็อปเด้งทีละตัว: จิ๋ว+จาง+ขยับจากล่าง → ดีดเข้าที่ (เด่นสุดตอนใช้ spring)
      return {
        inner: {
          opacity: Math.min(1, p * 1.6),
          transform: `translateY(${inv * size * 0.45}px) scale(${0.25 + 0.75 * p})`,
        },
      };
    case "reveal-right":
      // ป็อปเด้งทีละตัวแบบเลื่อนข้างเข้ามา
      return {
        inner: {
          opacity: Math.min(1, p * 1.6),
          transform: `translateX(${inv * size * 0.5}px) scale(${0.4 + 0.6 * p})`,
        },
      };
    case "mask-up":
      // ตัวอักษรดันขึ้นจากใต้เส้นบรรทัด โดยโดนกล่องนอก "บัง" ไว้ (clip-path)
      return { mask: true, inner: { transform: `translateY(${inv * 100}%)` } };
    case "mask-down":
      return { mask: true, inner: { transform: `translateY(${-inv * 100}%)` } };
    case "grow":
      return { inner: { opacity: p, transform: `scale(${0.2 + 0.8 * p})` } };
    case "shrink":
      return { inner: { opacity: p, transform: `scale(${2 - p})` } };
    case "blur":
      return { inner: { opacity: p, filter: `blur(${inv * 14}px)` } };
    case "blur-slide-up":
      return {
        inner: {
          opacity: p,
          filter: `blur(${inv * 14}px)`,
          transform: `translateY(${inv * dist}px)`,
        },
      };
    default:
      return { inner: null };
  }
}

/** พาเนลเลือกอนิเมชั่น (แท็บ Effect Controls) — ซ้ายเลือกหมวด ขวาเป็นการ์ดพรีวิว
 *  หน้านี้ทำหน้าที่ "ใส่" อย่างเดียว (ได้ 1 ตัว มีติ๊กถูกบนการ์ด) — ความเร็วไปปรับใน Properties */
export default function TextAnimPanel({ clip, onUpdate }) {
  const [phase, setPhase] = React.useState("in");
  const [query, setQuery] = React.useState("");
  if (clip?.type === "image") return <ImageAnimPanel clip={clip} onUpdate={onUpdate} />;
  if (!clip || clip.type !== "text")
    return (
      <div className="anim-panel empty">
        เลือกก้อนข้อความบน timeline ก่อน แล้วเลือกอนิเมชั่นที่นี่
      </div>
    );
  const st = clip.style || {};
  const set = (patch) => onUpdate(clip.id, { style: { ...st, ...patch } });
  const q = query.trim().toLowerCase();
  const field = phase === "in" ? "animIn" : "animOut";
  const items = TEXT_ANIMS.flatMap((g) => g.items).filter((a) => a.id !== "disappear" && (!q || a.label.toLowerCase().includes(q) || a.id.includes(q)));
  const renderCard = (a) => {
    const sel = st[field] === a.id;
    return (
      <button
        key={a.id}
        className={`anim-card ${sel ? "selected" : ""}`}
        title={phase === "in" ? "เล่นตอนข้อความเข้า" : "เล่นตอนข้อความออก"}
        onClick={() => set({ [field]: sel ? null : a.id, anim: null })}
      >
        <span className="anim-thumb">
          {/* ตัวอย่างเล่นวนซ้ำด้วย CSS keyframes (txa-<id> ใน styles.css) */}
          <span className={`anim-demo txa-${a.id}`}>วิเคราะห์ผลตอบแทนได้ทันที</span>
          {sel && <span className="anim-check">✓</span>}
        </span>
        <span className="anim-card-label">{a.label}</span>
      </button>
    );
  };
  return (
    <div className="anim-panel split">
      <div className="anim-sidebar">
        <button className={`anim-side-item ${phase === "in" ? "active" : ""}`} onClick={() => setPhase("in")}>เข้า (In){st.animIn && <span className="anim-side-dot" />}</button>
        <button className={`anim-side-item ${phase === "out" ? "active" : ""}`} onClick={() => setPhase("out")}>ออก (Out){st.animOut && <span className="anim-side-dot" />}</button>
      </div>
      <div className="anim-content">
        <input
          className="anim-search"
          type="search"
          placeholder="ค้นหาเอฟเฟค…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="anim-group-title">BASIC · {phase === "in" ? "เข้า" : "ออก"}</div>
        {items.length === 0 ? <div className="anim-group-title">ไม่พบ "{query}"</div> : <div className="anim-grid">{items.map(renderCard)}</div>}
      </div>
    </div>
  );
}
