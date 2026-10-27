import React, { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Film,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Trash2,
  Loader2,
  Sparkles,
  FlipHorizontal,
  FlipVertical,
  Gauge,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Ban,
  SlidersHorizontal,
  GripVertical,
  X,
} from "lucide-react";
import { BUBBLES, BubbleSvg } from "./TextBubbles";
import { TEXT_EFFECTS, effectStyle } from "./TextEffects";
import { TEXT_EASINGS, ANIM_BY, ANIM_ORDER, KINETIC_ANIMS, LETTER_ANIMS } from "./TextAnimations";
import MaskFxControls from "./MaskFxControls";

// ค่าเริ่มต้นของ "ใส่เอฟเฟกต์แบบ" ตามชนิดเอฟเฟกต์ (กลุ่มทีละตัวอักษร → letters)
const defaultAnimBy = (anim) => (LETTER_ANIMS.has(anim) ? "letters" : "words");
import { LOOKS } from "./looks";

// Preset style ของข้อความ: สีตัว + ขอบตัวอักษร (stroke) + กล่องพื้นหลัง (bg)
const TEXT_PRESETS = [
  { none: true }, // ล้างกลับค่าตั้งต้น
  // หัวข้อคลิปไทย: เหลืองขอบเข้ม+วงขาว บนกล่องดำ (เข้มไว้ก่อน — ปรับความทึบ/ขนาดกล่องแยกได้)
  { color: "#ffcf3f", bg: "#000000", bgOpacity: 80, effect: "thai-title", bold: true },
  // เหลืองส้มขอบเข้ม ไม่มีกล่อง (สไตล์ Hit to the Point)
  { color: "#ffb625", effect: "orange-pop", bold: true },
  { color: "#ffffff" },
  { color: "#ffffff", stroke: "#000000" },
  { color: "#ffffff", outline: true },
  { color: "#ffe600" },
  { color: "#ff3b30", stroke: "#ffffff" },
  { color: "#ff9500" },
  { color: "#3b82f6", stroke: "#ffffff" },
  { color: "#22c55e" },
  { color: "#ffffff", bg: "#8e8e93" },
  { color: "#000000", bg: "#c7c7cc" },
  { color: "#000000", bg: "#ffd60a" },
  { color: "#ffffff", bg: "#7c3aed" },
  { color: "#7c3aed", bg: "#ffffff" },
  { color: "#000000", bg: "#ffffff" },
  { color: "#ffffff", bg: "#000000" },
  { color: "#22c55e", bg: "#000000" },
  { color: "#ff3b30", bg: "#000000" },
];

// ค่าตั้งต้นของ transform ต่อคลิป — ใช้เทียบว่าค่าไหนถูกแก้แล้ว (โชว์ปุ่ม reset เข้ม)
export const DEFAULT_TRANSFORM = {
  x: 0,
  y: 0,
  scale: 100,
  rotation: 0,
  opacity: 100,
  volume: 100,
  blur: 0,
  sharpen: 0,
  look: "none",
  blend: "normal",
  flipH: false,
  flipV: false,
  fade: 0,
  audioFadeIn: 0,
  audioFadeOut: 0,
  pan: 0,
  shape: "none",
};

// ฟอนต์ที่มีในเครื่อง Windows ทั่วไป (รวมฟอนต์ไทย Leelawadee UI)
const FONTS = [
  "System",
  "Segoe UI",
  "Arial Rounded MT Bold",
  "Noto Sans Thai",
  "Microsoft Sans Serif",
  "Leelawadee UI",
  "Tahoma",
  "Arial",
  "Georgia",
  "Times New Roman",
  "Courier New",
  "Impact",
];

// ทรงของเลเยอร์วิดีโอ: กล่องลอย (วงกลม/สี่เหลี่ยม/หัวใจ/ดาว) หรือแบ่งฉากเต็มจอ (ครึ่ง/คอลัมน์)
const PIP_SHAPES = [
  { value: "none", label: "ปกติ (เต็มจอ)" },
  { value: "circle", label: "วงกลม" },
  { value: "square", label: "สี่เหลี่ยม" },
  { value: "phone", label: "แนวตั้ง (9:16)" },
  { value: "heart", label: "หัวใจ" },
  { value: "star", label: "ดาว" },
  { value: "half-l", label: "แบ่งฉาก: ครึ่งซ้าย" },
  { value: "half-r", label: "แบ่งฉาก: ครึ่งขวา" },
  { value: "half-t", label: "แบ่งฉาก: ครึ่งบน" },
  { value: "half-b", label: "แบ่งฉาก: ครึ่งล่าง" },
  { value: "col-l", label: "แบ่งฉาก: คอลัมน์ซ้าย" },
  { value: "col-c", label: "แบ่งฉาก: คอลัมน์กลาง" },
  { value: "col-r", label: "แบ่งฉาก: คอลัมน์ขวา" },
];

const BLEND_MODES = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "difference", "hard-light", "soft-light"];

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

/** ตัวเลขสีฟ้าแบบ Premiere: ลากซ้าย-ขวาเพื่อปรับค่า / ดับเบิลคลิกเพื่อพิมพ์ */
function DragValue({ value, onChange, step = 1, min = -1e9, max = 1e9, decimals = 1 }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");

  const startDrag = (e) => {
    if (editing) return;
    e.preventDefault();
    const startX = e.clientX;
    const startV = value;
    document.body.classList.add("scrubbing-value");
    const move = (ev) => {
      if (ev.buttons === 0) return up();
      onChange(clamp(startV + (ev.clientX - startX) * step, min, max));
    };
    const up = () => {
      document.body.classList.remove("scrubbing-value");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  if (editing) {
    return (
      <input
        className="drag-value-input"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = parseFloat(text);
          if (!Number.isNaN(n)) onChange(clamp(n, min, max));
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.target.blur();
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }

  return (
    <span
      className="drag-value"
      onMouseDown={startDrag}
      onDoubleClick={() => {
        setText(String(Math.round(value * 10) / 10));
        setEditing(true);
      }}
      title="ลากซ้าย-ขวาเพื่อปรับ · ดับเบิลคลิกเพื่อพิมพ์"
    >
      {value.toFixed(decimals)}
    </span>
  );
}

/** กล่องเลือกสี + ช่องพิมพ์รหัส hex ตรงๆ (เช่น #ff8800 หรือ f80) */
function ColorField({ value, onChange }) {
  const [text, setText] = useState(null); // null = ยังไม่ได้แก้ ใช้ค่า value

  const commit = (raw) => {
    let s = raw.trim().replace(/^#/, "").toLowerCase();
    if (/^[0-9a-f]{3}$/.test(s)) s = s.split("").map((c) => c + c).join(""); // f80 → ff8800
    if (/^[0-9a-f]{6}$/.test(s)) onChange(`#${s}`);
    setText(null);
  };

  return (
    <>
      <input
        type="color"
        className="prop-color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        className="hex-input"
        value={text ?? value}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.target.blur();
          if (e.key === "Escape") setText(null);
        }}
        title="พิมพ์รหัสสี เช่น #ff8800 แล้วกด Enter"
      />
    </>
  );
}

/** แถว property: ชื่อซ้าย ค่าขวา + ปุ่มหมุนกลับค่าเดิม */
function PropRow({ label, changed, onReset, children }) {
  return (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      <div className="prop-control">{children}</div>
      <button
        className={`icon-btn tiny prop-reset ${changed ? "" : "idle"}`}
        title="กลับค่าตั้งต้น"
        onClick={onReset}
      >
        <RotateCcw size={11} />
      </button>
    </div>
  );
}

/** หมวดพับได้แบบ Effect Controls (มีป้าย fx) */
function Section({ title, fx = false, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="prop-section">
      <div className="prop-section-head" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {fx && <span className="fx-badge">fx</span>}
        <span>{title}</span>
      </div>
      {open && <div className="prop-section-body">{children}</div>}
    </div>
  );
}

/** กลุ่มใหญ่ (Video / Audio / AI Tools) — คลิกหัวเพื่อพับทั้งกลุ่ม */
function Group({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <div className="prop-group-head clickable" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{title}</span>
      </div>
      {open && children}
    </>
  );
}

/** ปุ่มเครื่องมือ AI + ปุ่มเฟืองเล็กท้ายปุ่มไว้กางตัวเลือกของมันเอง
 *  main = ปุ่มหลัก, badge = มีค่าตั้งไว้ไม่ใช่ค่าเริ่ม (ขึ้นจุดเขียวบนเฟือง) */
function ToolOptions({ main, badge = null, children }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="tool-row">
        {main}
        <button
          className={`icon-btn tool-gear ${open ? "active" : ""}`}
          title={badge ? `ตัวเลือก (${badge})` : "ตัวเลือก"}
          onClick={() => setOpen((o) => !o)}
        >
          <SlidersHorizontal size={13} />
          {badge && !open && <span className="gear-dot" />}
        </button>
      </div>
      {open && <div className="tool-options-body">{children}</div>}
    </>
  );
}

// เลือกเฟรมตัวอย่างกระจายทั่วคลิป (สูงสุด 8 ภาพ) จากผลลัพธ์ extract-frames
function sampleFrames({ frame_count, frames_dir }, max = 8) {
  const count = Math.min(max, frame_count);
  return Array.from({ length: count }, (_, i) => {
    const n = Math.max(1, Math.round(((i + 0.5) / count) * frame_count));
    const file = `${frames_dir}\\frame_${String(n).padStart(6, "0")}.png`;
    return { n, url: `media://${encodeURIComponent(file)}` };
  });
}

/** ชื่อคลิปหัวพาเนล — ดับเบิลคลิกเพื่อเปลี่ยนชื่อก้อน (เฉพาะก้อนบน timeline) */
function ClipTitle({ clip, editable, onRename }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");

  if (editing) {
    return (
      <div className="clip-title">
        <Film size={14} />
        <input
          className="clip-name-input"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (text.trim()) onRename(text.trim());
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.target.blur();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={`clip-title ${editable ? "renamable" : ""}`}
      title={editable ? "ดับเบิลคลิกเพื่อเปลี่ยนชื่อก้อน" : undefined}
      onDoubleClick={() => {
        if (!editable) return;
        setText(clip.name);
        setEditing(true);
      }}
    >
      <Film size={14} />
      <span>{clip.name}</span>
    </div>
  );
}

/** ช่องลากเทมเพลตมากำหนดสไตล์ซับ — ตอนถอดเสียง ซับทุกก้อนจะใช้สไตล์+ตำแหน่งนี้ทันที */
function SubtitleStyleDrop({ tpl, onSet }) {
  const [over, setOver] = React.useState(false);
  const st = tpl?.style || {};
  return (
    <div
      className={`sub-style-drop ${over ? "drag-over" : ""} ${tpl ? "has-tpl" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-text-template")) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const data = e.dataTransfer.getData("application/x-text-template");
        setOver(false);
        if (data) {
          e.preventDefault();
          try {
            onSet?.(JSON.parse(data));
          } catch {}
        }
      }}
    >
      {tpl ? (
        <>
          <span
            className="sub-style-preview"
            style={{
              color: st.color || "#fff",
              fontWeight: st.bold ? 800 : 500,
              WebkitTextStroke: st.stroke ? `0.6px ${st.stroke}` : undefined,
              ...(st.effect ? effectStyle(st.effect, 15) : {}),
            }}
          >
            {(tpl.text || "ซับตัวอย่าง").slice(0, 12)}
          </span>
          <button className="sub-style-clear" title="ล้างสไตล์ซับ (กลับไปใช้ค่าเริ่มต้น)" onClick={() => onSet?.(null)}>
            ✕
          </button>
        </>
      ) : (
        <span className="sub-style-empty">ลากเทมเพลตจากแท็บ Templates มาที่นี่ → ซับจะใช้สไตล์นี้ทุกก้อน</span>
      )}
    </div>
  );
}

function SceneObjectTimeBar({ scene, child, onUpdate }) {
  const start = Math.max(0, child.offset || 0);
  const duration = Math.max(0.1, Math.min(child.duration || scene.duration, scene.duration - start));
  const drag = (e, edge) => {
    e.preventDefault(); e.stopPropagation();
    const rect = e.currentTarget.closest(".scene-popup-time-track").getBoundingClientRect();
    const sx = e.clientX, s0 = start, d0 = duration;
    const move = (ev) => {
      const dt = ((ev.clientX - sx) / rect.width) * scene.duration;
      if (edge === "start") {
        const next = Math.max(0, Math.min(s0 + d0 - 0.1, s0 + dt));
        onUpdate(child.id, { offset: next, duration: d0 + s0 - next });
      } else onUpdate(child.id, { duration: Math.max(0.1, Math.min(scene.duration - s0, d0 + dt)) });
    };
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  return (
    <div className="scene-popup-time-wrap">
      <div className="scene-popup-time-values"><span>{start.toFixed(1)}s</span><span>{(start + duration).toFixed(1)}s</span></div>
      <div className="scene-popup-time-track">
        <div className="scene-popup-time-bar" style={{ left: `${start / scene.duration * 100}%`, width: `${duration / scene.duration * 100}%` }}>
          <i className="start" onMouseDown={(e) => drag(e, "start")} /><span>{child.type === "text" ? child.text || "Text" : child.name || "Image"}</span><i className="end" onMouseDown={(e) => drag(e, "end")} />
        </div>
      </div>
    </div>
  );
}

/** พาเนล Properties ทั้งอัน — คุมคุณสมบัติก้อนที่เลือกบน timeline + งานแตกเฟรม */
export default function PropertiesPanel({
  selectedClip,
  programClip,
  onUpdate,
  onSelectClipId,
  onRemove,
  onSetSpeed,
  extract,
  onExtract,
  audioJob,
  onAudioFx,
  bgEngineReady = false,
  bgEngines = [],
  bgEngineId = null,
  onSelectBgEngine,
  bgJob = null,
  onRemoveBg,
  upEngines = [],
  upEngineId = null,
  onSelectUpEngine,
  upJob = null,
  onUpscale,
  sttEngines = [],
  sttEngineId = null,
  onSelectSttEngine,
  sttLang = "auto",
  onSelectSttLang,
  sttJob = null,
  onTranscribe,
  subtitleTpl = null,
  onSetSubtitleTpl,
  stabJob = null,
  onStabilize,
  inpEngines = [],
  inpEngineId = null,
  onSelectInpEngine,
  inpJob = null,
  inpDrawing = false,
  onInpaintStart,
  censorJob = null,
  onBakeCensor,
  swapReady = false,
  swapEngines = [],
  swapEngineId = null,
  onSelectSwapEngine,
  swapImages = [],
  swapMaps = [{ source: null, ref: null }],
  swapPickIndex = null,
  onAddSwapMap,
  onRemoveSwapMap,
  onSetSwapMapSource,
  onPickSwapTarget,
  onClearSwapMapRef,
  swapEnhance = true,
  onToggleSwapEnhance,
  swapJob = null,
  onFaceSwap,
  trkEngines = [],
  trkEngineId = null,
  onSelectTrkEngine,
  trkStyle = "circle",
  onSelectTrkStyle,
  trkJob = null,
  trkDrawing = false,
  onTrackStart,
  fcEngines = [],
  censorReady = false,
  fcEngineId = null,
  onSelectFcEngine,
  fcTarget = "face",
  onSelectFcTarget,
  fcStyle = "blur",
  onSelectFcStyle,
  fcJob = null,
  onFaceCensor,
  keepRefs = [],
  keepInvert = false,
  keepPicking = false,
  onPickKeep,
  onClearKeep,
  onToggleKeepInvert,
  onCancelJob,
  onOpenEngines,
  onOpenFrames,
  onEditMask,
  onRedrawMask,
  onDeleteMask,
  onTrackMask,
  onCancelMaskTrack,
  maskTrackJob = null,
  maskToolActive = false,
  section = "props", // "props" = คุณสมบัติก้อน | "ai" = แท็บเครื่องมือ AI (แยกให้ไม่รก)
}) {
  // ความแรงลดสั่นที่เลือกไว้ (ใช้ตอนกดปุ่ม Stabilize) — hook ต้องอยู่ก่อน early return เสมอ
  const [stabStrength, setStabStrength] = useState("medium");
  const [sceneObjectsOpen, setSceneObjectsOpen] = useState(false);
  const [dragObjectIndex, setDragObjectIndex] = useState(null);
  const [sceneObjectsView, setSceneObjectsView] = useState("order");

  if (!programClip && !selectedClip) {
    return (
      <div className="properties-hint">
        <Sparkles size={16} />
        <p>Import วิดีโอเข้ามาก่อน แล้วเครื่องมือจะโผล่ตรงนี้</p>
        <p className="dim">(แตกเฟรม / Face Swap / Background Replace / Auto Subtitle)</p>
      </div>
    );
  }

  const clip = selectedClip;
  const isText = clip?.type === "text"; // ก้อนข้อความ (V3): โชว์หมวด Text ซ่อนหมวดที่ใช้กับวิดีโอเท่านั้น
  const isImage = clip?.type === "image";
  const supportsMask = clip && (!clip.type || clip.type === "video") && [1, 2, 3].includes(clip.track);
  const isLayout = clip?.type === "layout"; // ก้อนแบ่งฉาก (เลน FX): โชว์เฉพาะหมวดแบ่งฉาก
  const t = clip ? { ...DEFAULT_TRANSFORM, ...clip.transform } : null;
  const set = (key, val) => onUpdate(clip.id, { transform: { ...t, [key]: val } });
  const reset = (keys) => {
    const next = { ...t };
    keys.forEach((k) => (next[k] = DEFAULT_TRANSFORM[k]));
    onUpdate(clip.id, { transform: next });
  };
  const changed = (k) => t[k] !== DEFAULT_TRANSFORM[k];

  return (
    <div className="properties-clip">
      {/* แท็บ AI ไม่ต้องมีหัวชื่อคลิป — มีอยู่แล้วในแท็บ Properties */}
      {section === "props" && (
        <ClipTitle
          clip={clip ?? programClip}
          editable={!!clip}
          onRename={(name) => onUpdate(clip.id, { name })}
        />
      )}

      {section === "props" && clip && (
        <>
          <div className="clip-meta">
            เริ่ม {clip.offset.toFixed(1)}s · ยาว {clip.duration.toFixed(1)}s ·{" "}
            {clip.fps ? "" : "~"}
            {Math.round(clip.duration * (clip.fps || 30) * (clip.speed || 1)).toLocaleString()} เฟรม
            {clip.fps ? ` (${Math.round(clip.fps * 100) / 100} fps)` : ""}
            {(clip.speed || 1) !== 1 && ` · สปีด ${clip.speed}x`}
          </div>

          <div className="clip-actions">
            <button
              className={`btn-secondary sm ${clip.hidden ? "warn" : ""}`}
              title="ซ่อน = ช่วงนี้เป็นจอดำ ไม่เล่นภาพ/เสียง"
              onClick={() => onUpdate(clip.id, { hidden: !clip.hidden })}
            >
              {clip.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
              {clip.hidden ? "ซ่อนอยู่" : "แสดงอยู่"}
            </button>
            <button
              className={`btn-secondary sm ${clip.locked ? "warn" : ""}`}
              title="ล็อค = ลากย้ายตำแหน่งไม่ได้"
              onClick={() => onUpdate(clip.id, { locked: !clip.locked })}
            >
              {clip.locked ? <Lock size={13} /> : <LockOpen size={13} />}
              {clip.locked ? "ล็อคอยู่" : "ไม่ล็อค"}
            </button>
            <button
              className="btn-secondary sm danger"
              title="เอาก้อนนี้ออกจาก timeline (ไฟล์ยังอยู่ใน Project)"
              onClick={() => onRemove(clip.id)}
            >
              <Trash2 size={13} />
              เอาออก
            </button>
          </div>

          {clip.type === "scene" && (
            <Group title="Scene Objects" defaultOpen>
              <Section title="ลำดับ Object" fx>
                <div className="scene-object-summary">
                  <span>{clip.children?.length || 0} object</span>
                  <button className="btn-secondary sm" onClick={() => setSceneObjectsOpen(true)}>เปิด Scene Objects</button>
                </div>
                <div className="prop-hint">กำหนดลำดับ 0–{Math.max(0, (clip.children?.length || 1) - 1)} สำหรับ Auto Animate</div>
              </Section>
            </Group>
          )}

          {isText && (
            <Group title="Text" defaultOpen>
              <Section title="Content" fx>
                <textarea
                  className="text-content-input"
                  rows={2}
                  value={clip.text}
                  onChange={(e) => onUpdate(clip.id, { text: e.target.value })}
                  placeholder="พิมพ์ข้อความ…"
                />
                <div className="prop-hint">พิมพ์ *คำ* เพื่อเน้นคำนั้นเป็นสี Highlight เช่น ลด *50%* วันนี้</div>
                <PropRow
                  label="Font"
                  changed={(clip.style?.font ?? "System") !== "System"}
                  onReset={() => onUpdate(clip.id, { style: { ...clip.style, font: "System" } })}
                >
                  <select
                    className="prop-select"
                    value={clip.style?.font ?? "System"}
                    onChange={(e) => onUpdate(clip.id, { style: { ...clip.style, font: e.target.value } })}
                  >
                    {FONTS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </PropRow>
                <PropRow
                  label="Size"
                  changed={(clip.style?.size ?? 48) !== 48}
                  onReset={() => onUpdate(clip.id, { style: { ...clip.style, size: 48 } })}
                >
                  <DragValue
                    value={clip.style?.size ?? 48}
                    onChange={(v) => onUpdate(clip.id, { style: { ...clip.style, size: v } })}
                    step={1}
                    min={8}
                    max={300}
                    decimals={0}
                  />
                  <span className="prop-suffix">px</span>
                </PropRow>
                <PropRow
                  label="Color"
                  changed={(clip.style?.color ?? "#ffffff") !== "#ffffff"}
                  onReset={() => onUpdate(clip.id, { style: { ...clip.style, color: "#ffffff" } })}
                >
                  <ColorField
                    value={clip.style?.color ?? "#ffffff"}
                    onChange={(color) => onUpdate(clip.id, { style: { ...clip.style, color } })}
                  />
                </PropRow>
                <PropRow
                  label="Highlight"
                  changed={(clip.style?.highlight ?? "#ff4d4d") !== "#ff4d4d"}
                  onReset={() => onUpdate(clip.id, { style: { ...clip.style, highlight: "#ff4d4d" } })}
                >
                  <ColorField
                    value={clip.style?.highlight ?? "#ff4d4d"}
                    onChange={(highlight) => onUpdate(clip.id, { style: { ...clip.style, highlight } })}
                  />
                </PropRow>
                {clip.style?.bg && (
                  <>
                    <PropRow
                      label="BG Opacity"
                      changed={(clip.style?.bgOpacity ?? 100) !== 100}
                      onReset={() => onUpdate(clip.id, { style: { ...clip.style, bgOpacity: 100 } })}
                    >
                      <DragValue
                        value={clip.style?.bgOpacity ?? 100}
                        onChange={(v) => onUpdate(clip.id, { style: { ...clip.style, bgOpacity: v } })}
                        step={1}
                        min={0}
                        max={100}
                        decimals={0}
                      />
                      <span className="prop-suffix">%</span>
                    </PropRow>
                    <PropRow
                      label="BG Position"
                      changed={(clip.style?.bgX ?? 0) !== 0 || (clip.style?.bgY ?? 0) !== 0}
                      onReset={() => onUpdate(clip.id, { style: { ...clip.style, bgX: 0, bgY: 0 } })}
                    >
                      <DragValue
                        value={clip.style?.bgX ?? 0}
                        onChange={(v) => onUpdate(clip.id, { style: { ...clip.style, bgX: v } })}
                        step={1}
                        min={-500}
                        max={500}
                        decimals={0}
                      />
                      <DragValue
                        value={clip.style?.bgY ?? 0}
                        onChange={(v) => onUpdate(clip.id, { style: { ...clip.style, bgY: v } })}
                        step={1}
                        min={-500}
                        max={500}
                        decimals={0}
                      />
                    </PropRow>
                    <PropRow
                      label="BG Size"
                      changed={(clip.style?.bgPad ?? 100) !== 100}
                      onReset={() => onUpdate(clip.id, { style: { ...clip.style, bgPad: 100 } })}
                    >
                      <DragValue
                        value={clip.style?.bgPad ?? 100}
                        onChange={(v) => onUpdate(clip.id, { style: { ...clip.style, bgPad: v } })}
                        step={2}
                        min={0}
                        max={400}
                        decimals={0}
                      />
                      <span className="prop-suffix">%</span>
                    </PropRow>
                  </>
                )}
                <PropRow
                  label="Pattern"
                  changed={!!clip.style?.bold || !!clip.style?.underline || !!clip.style?.italic}
                  onReset={() =>
                    onUpdate(clip.id, {
                      style: { ...clip.style, bold: false, underline: false, italic: false },
                    })
                  }
                >
                  <button
                    className={`icon-btn tiny text-style-btn ${clip.style?.bold ? "active" : ""}`}
                    title="ตัวหนา"
                    style={{ fontWeight: 700 }}
                    onClick={() => onUpdate(clip.id, { style: { ...clip.style, bold: !clip.style?.bold } })}
                  >
                    B
                  </button>
                  <button
                    className={`icon-btn tiny text-style-btn ${clip.style?.underline ? "active" : ""}`}
                    title="ขีดเส้นใต้"
                    style={{ textDecoration: "underline" }}
                    onClick={() =>
                      onUpdate(clip.id, { style: { ...clip.style, underline: !clip.style?.underline } })
                    }
                  >
                    U
                  </button>
                  <button
                    className={`icon-btn tiny text-style-btn ${clip.style?.italic ? "active" : ""}`}
                    title="ตัวเอียง"
                    style={{ fontStyle: "italic" }}
                    onClick={() =>
                      onUpdate(clip.id, { style: { ...clip.style, italic: !clip.style?.italic } })
                    }
                  >
                    I
                  </button>
                </PropRow>
                <PropRow
                  label="Case"
                  changed={(clip.style?.textCase ?? "none") !== "none"}
                  onReset={() => onUpdate(clip.id, { style: { ...clip.style, textCase: "none" } })}
                >
                  {[
                    ["upper", "TT", "ตัวพิมพ์ใหญ่ทั้งหมด"],
                    ["lower", "tt", "ตัวพิมพ์เล็กทั้งหมด"],
                    ["title", "Tt", "ขึ้นต้นคำด้วยตัวใหญ่"],
                  ].map(([val, label, tip]) => (
                    <button
                      key={val}
                      className={`icon-btn tiny text-style-btn ${clip.style?.textCase === val ? "active" : ""}`}
                      title={tip}
                      onClick={() =>
                        onUpdate(clip.id, {
                          style: { ...clip.style, textCase: clip.style?.textCase === val ? "none" : val },
                        })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </PropRow>
                <PropRow
                  label="Character"
                  changed={(clip.style?.letterSpacing ?? 0) !== 0}
                  onReset={() => onUpdate(clip.id, { style: { ...clip.style, letterSpacing: 0 } })}
                >
                  <DragValue
                    value={clip.style?.letterSpacing ?? 0}
                    onChange={(v) => onUpdate(clip.id, { style: { ...clip.style, letterSpacing: v } })}
                    step={0.5}
                    min={-20}
                    max={100}
                    decimals={0}
                  />
                  <span className="prop-suffix">px</span>
                </PropRow>
                <PropRow
                  label="Line"
                  changed={(clip.style?.lineSpacing ?? 0) !== 0}
                  onReset={() => onUpdate(clip.id, { style: { ...clip.style, lineSpacing: 0 } })}
                >
                  <DragValue
                    value={clip.style?.lineSpacing ?? 0}
                    onChange={(v) => onUpdate(clip.id, { style: { ...clip.style, lineSpacing: v } })}
                    step={0.5}
                    min={-60}
                    max={200}
                    decimals={0}
                  />
                  <span className="prop-suffix">px</span>
                </PropRow>
                <PropRow
                  label="Alignment"
                  changed={(clip.style?.align ?? "center") !== "center"}
                  onReset={() => onUpdate(clip.id, { style: { ...clip.style, align: "center" } })}
                >
                  {[
                    ["left", AlignLeft, "ชิดซ้าย"],
                    ["center", AlignCenter, "กึ่งกลาง"],
                    ["right", AlignRight, "ชิดขวา"],
                  ].map(([val, Icon, tip]) => (
                    <button
                      key={val}
                      className={`icon-btn tiny text-style-btn ${(clip.style?.align ?? "center") === val ? "active" : ""}`}
                      title={tip}
                      onClick={() => onUpdate(clip.id, { style: { ...clip.style, align: val } })}
                    >
                      <Icon size={12} />
                    </button>
                  ))}
                </PropRow>
                <PropRow
                  label="เงาขอบตัวอักษร"
                  changed={!!clip.style?.outline}
                  onReset={() => onUpdate(clip.id, { style: { ...clip.style, outline: false } })}
                >
                  <input
                    type="checkbox"
                    title="อ่านง่ายบนภาพ"
                    checked={!!clip.style?.outline}
                    onChange={(e) => onUpdate(clip.id, { style: { ...clip.style, outline: e.target.checked } })}
                  />
                </PropRow>
                <PropRow label="Duration" changed={clip.duration !== 4} onReset={() => onUpdate(clip.id, { duration: 4 })}>
                  <DragValue
                    value={clip.duration}
                    onChange={(v) => onUpdate(clip.id, { duration: Math.max(0.5, v) })}
                    step={0.1}
                    min={0.5}
                    max={600}
                  />
                  <span className="prop-suffix">s</span>
                </PropRow>
              </Section>
            </Group>
          )}

          {isText && (
            <Group title="ข้อความพิเศษ" defaultOpen>
              <Section title="Preset style" fx>
                <div className="preset-grid">
                  {TEXT_PRESETS.map((p, i) => {
                    const st = clip.style || {};
                    const selected = p.none
                      ? !st.stroke && !st.bg && (st.color ?? "#ffffff") === "#ffffff" && !st.outline && !st.effect
                      : (st.color ?? "#ffffff") === (p.color ?? "#ffffff") &&
                        (st.stroke || null) === (p.stroke || null) &&
                        (st.bg || null) === (p.bg || null) &&
                        (st.effect || null) === (p.effect || null) &&
                        !!st.outline === !!p.outline;
                    return (
                      <button
                        key={i}
                        className={`preset-btn ${selected ? "selected" : ""}`}
                        title={p.none ? "ล้างสไตล์" : "ใช้สไตล์นี้"}
                        onClick={() =>
                          onUpdate(clip.id, {
                            style: {
                              ...clip.style,
                              color: p.color ?? "#ffffff",
                              stroke: p.stroke ?? null,
                              bg: p.bg ?? null,
                              outline: !!p.outline,
                              effect: p.effect ?? null, // preset คุมลุคทั้งชุด — ไม่มี effect = ล้างทิ้ง
                              bgOpacity: p.bgOpacity ?? 100,
                              ...(p.bold ? { bold: true } : {}),
                            },
                          })
                        }
                        style={
                          p.none
                            ? undefined
                            : {
                                color: p.color,
                                WebkitTextStroke: p.stroke ? `0.8px ${p.stroke}` : undefined,
                                textShadow: p.outline ? "0 1px 3px rgba(0,0,0,0.9)" : undefined,
                                background: p.bg || undefined,
                                opacity: undefined,
                                ...(p.effect ? effectStyle(p.effect, 11) : {}),
                              }
                        }
                      >
                        {p.none ? <Ban size={14} /> : "Aa"}
                      </button>
                    );
                  })}
                </div>
              </Section>
              <Section title="Bubble" fx>
                <div className="preset-grid">
                  <button
                    className={`preset-btn ${!clip.style?.bubble ? "selected" : ""}`}
                    title="ไม่ใช้กรอบ"
                    onClick={() => onUpdate(clip.id, { style: { ...clip.style, bubble: null } })}
                  >
                    <Ban size={14} />
                  </button>
                  {BUBBLES.map((b) => (
                    <button
                      key={b.id}
                      className={`preset-btn bubble ${clip.style?.bubble === b.id ? "selected" : ""}`}
                      title={b.label}
                      onClick={() =>
                        onUpdate(clip.id, {
                          style: { ...clip.style, bubble: b.id, color: b.textColor, font: b.font || clip.style?.font, bg: null },
                        })
                      }
                    >
                      <BubbleSvg id={b.id} />
                      <span style={{ position: "relative", color: b.textColor, fontSize: 11 }}>Aa</span>
                    </button>
                  ))}
                </div>
              </Section>
              <Section title="Effects" fx>
                <div className="preset-grid effects">
                  <button
                    className={`preset-btn ${!clip.style?.effect ? "selected" : ""}`}
                    title="ไม่ใช้เอฟเฟกต์"
                    onClick={() => onUpdate(clip.id, { style: { ...clip.style, effect: null } })}
                  >
                    <Ban size={14} />
                  </button>
                  {TEXT_EFFECTS.map((fx) => (
                    <button
                      key={fx.id}
                      className={`preset-btn ${clip.style?.effect === fx.id ? "selected" : ""}`}
                      title={fx.label}
                      onClick={() =>
                        onUpdate(clip.id, {
                          style: { ...clip.style, effect: fx.id, ...(fx.also || {}) },
                        })
                      }
                    >
                      <span style={{ fontWeight: 800, fontSize: 12, ...effectStyle(fx.id, 12) }}>ART</span>
                    </button>
                  ))}
                </div>
              </Section>
            </Group>
          )}

          {isLayout && clip.kind === "censor" && (
            <Group title="เซ็นเซอร์" defaultOpen>
              <Section title={clip.name} fx>
                <PropRow label="Position" changed={clip.cx !== 50 || clip.cy !== 50} onReset={() => onUpdate(clip.id, { cx: 50, cy: 50 })}>
                  <DragValue value={clip.cx} onChange={(v) => onUpdate(clip.id, { cx: v })} step={0.5} min={0} max={100} decimals={0} />
                  <DragValue value={clip.cy} onChange={(v) => onUpdate(clip.id, { cy: v })} step={0.5} min={0} max={100} decimals={0} />
                  <span className="prop-suffix">%</span>
                </PropRow>
                <PropRow label="Size (กว้าง×สูง)" changed={clip.boxW !== 24 || clip.boxH !== 18} onReset={() => onUpdate(clip.id, { boxW: 24, boxH: 18 })}>
                  <DragValue value={clip.boxW} onChange={(v) => onUpdate(clip.id, { boxW: v })} step={0.5} min={4} max={100} decimals={0} />
                  <DragValue value={clip.boxH} onChange={(v) => onUpdate(clip.id, { boxH: v })} step={0.5} min={4} max={100} decimals={0} />
                  <span className="prop-suffix">%</span>
                </PropRow>
                <PropRow label="แบบ" changed={clip.censorStyle !== "blur"} onReset={() => onUpdate(clip.id, { censorStyle: "blur" })}>
                  <select
                    className="prop-select"
                    value={clip.censorStyle || "blur"}
                    onChange={(e) => onUpdate(clip.id, { censorStyle: e.target.value })}
                  >
                    <option value="blur">เบลอ (Blur)</option>
                    <option value="mosaic">โมเสก (Mosaic)</option>
                  </select>
                </PropRow>
                <PropRow label="ความแรง" changed={clip.strength !== 12} onReset={() => onUpdate(clip.id, { strength: 12 })}>
                  <DragValue value={clip.strength} onChange={(v) => onUpdate(clip.id, { strength: Math.max(1, v) })} step={1} min={1} max={60} decimals={0} />
                  <span className="prop-suffix">px</span>
                </PropRow>
                <PropRow label="Duration" changed={clip.duration !== 4} onReset={() => onUpdate(clip.id, { duration: 4 })}>
                  <DragValue value={clip.duration} onChange={(v) => onUpdate(clip.id, { duration: Math.max(0.5, v) })} step={0.1} min={0.5} max={600} />
                  <span className="prop-suffix">s</span>
                </PropRow>
                <div className="prop-note dim">
                  ลากกล่องบนจอ Program เพื่อย้าย · ลากจุดน้ำเงินมุมล่างขวาเพื่อปรับขนาด · กด "เอาออก" ด้านบนเพื่อลบเซ็นเซอร์ทิ้ง (ไฟล์ไม่ถูกแตะ)
                </div>
                {/* เบิร์นถาวรลงไฟล์: เร็ว (ffmpeg ล้วน ไม่ใช้ AI) — พอฝังแล้วก้อนเซ็นเซอร์จะหาย เพราะติดในภาพจริงแล้ว */}
                {(() => {
                  const running = censorJob?.status === "working" && censorJob.clipId === clip.id;
                  const err = censorJob?.status === "error" && censorJob.clipId === clip.id;
                  return (
                    <>
                      <button
                        className="btn-secondary"
                        disabled={running}
                        title="เบลอ/โมเสกลงไฟล์วิดีโอจริง (ต้นฉบับใน Project ยังอยู่) — ใช้ตอนจะส่งงาน"
                        onClick={() => {
                          if (window.confirm("ฝังเซ็นเซอร์ลงคลิปบน V1 ถาวร?\n(ต้นฉบับในโปรเจกต์ไม่ถูกแตะ — แต่ก้อนเซ็นเซอร์จะหายเพราะติดในภาพแล้ว)")) {
                            onBakeCensor(clip);
                          }
                        }}
                      >
                        {running ? (
                          <>
                            <Loader2 size={13} className="spin" /> กำลังฝังเซ็นเซอร์…
                          </>
                        ) : (
                          "ฝังถาวรลงวิดีโอ (ffmpeg)"
                        )}
                      </button>
                      {err && <div className="extract-result err">ฝังไม่สำเร็จ: {censorJob.error}</div>}
                    </>
                  );
                })()}
              </Section>
            </Group>
          )}

          {isLayout && clip.kind !== "censor" && (
            <Group title="แบ่งฉาก" defaultOpen>
              <Section title={clip.name} fx>
                <PropRow label="Position" changed={clip.cx !== 50 || clip.cy !== 50} onReset={() => onUpdate(clip.id, { cx: 50, cy: 50 })}>
                  <DragValue value={clip.cx} onChange={(v) => onUpdate(clip.id, { cx: v })} step={0.5} min={0} max={100} decimals={0} />
                  <DragValue value={clip.cy} onChange={(v) => onUpdate(clip.id, { cy: v })} step={0.5} min={0} max={100} decimals={0} />
                  <span className="prop-suffix">%</span>
                </PropRow>
                {clip.kind === "split" && (
                  <>
                    <PropRow label="Angle" changed={false} onReset={() => onUpdate(clip.id, { angle: 90 })}>
                      <DragValue value={clip.angle} onChange={(v) => onUpdate(clip.id, { angle: v })} step={0.5} min={-180} max={180} />
                      <span className="prop-suffix">°</span>
                    </PropRow>
                    {/* เส้นแบ่งจริงบนภาพ: ปิด = เนียนไร้รอยต่อ (ภาพซ้อน) / เปิด = เส้นสีชัดเจน */}
                    <label className="check-row" title="ปิดไว้ = สองฝั่งชนกันเนียนๆ ไม่รู้ว่าแบ่ง / เปิด = มีเส้นสีคั่นชัดเจน">
                      <input
                        type="checkbox"
                        checked={!!clip.line}
                        onChange={(e) => onUpdate(clip.id, { line: e.target.checked })}
                      />
                      โชว์เส้นแบ่งบนภาพ
                    </label>
                    {clip.line && (
                      <>
                        <PropRow
                          label="Line Color"
                          changed={(clip.lineColor ?? "#ffffff") !== "#ffffff"}
                          onReset={() => onUpdate(clip.id, { lineColor: "#ffffff" })}
                        >
                          <ColorField
                            value={clip.lineColor ?? "#ffffff"}
                            onChange={(lineColor) => onUpdate(clip.id, { lineColor })}
                          />
                        </PropRow>
                        <PropRow
                          label="Line Width"
                          changed={(clip.lineWidth ?? 3) !== 3}
                          onReset={() => onUpdate(clip.id, { lineWidth: 3 })}
                        >
                          <DragValue
                            value={clip.lineWidth ?? 3}
                            onChange={(v) => onUpdate(clip.id, { lineWidth: v })}
                            step={0.5}
                            min={1}
                            max={30}
                            decimals={0}
                          />
                          <span className="prop-suffix">px</span>
                        </PropRow>
                      </>
                    )}
                  </>
                )}
                {clip.kind === "shape" && (
                  <PropRow label="Size" changed={clip.size !== 34} onReset={() => onUpdate(clip.id, { size: 34 })}>
                    <DragValue value={clip.size} onChange={(v) => onUpdate(clip.id, { size: v })} step={0.5} min={6} max={100} decimals={0} />
                    <span className="prop-suffix">%</span>
                  </PropRow>
                )}
                <PropRow label="Duration" changed={clip.duration !== 4} onReset={() => onUpdate(clip.id, { duration: 4 })}>
                  <DragValue value={clip.duration} onChange={(v) => onUpdate(clip.id, { duration: Math.max(0.5, v) })} step={0.1} min={0.5} max={600} />
                  <span className="prop-suffix">s</span>
                </PropRow>
                <div className="prop-note dim">
                  ลากจุดจับบนจอ Program ได้เลย: วงกลมใหญ่ = ย้าย · ปุ่มน้ำเงิน = {clip.kind === "split" ? "เอียงมุม" : "ปรับขนาด"}
                </div>
              </Section>
            </Group>
          )}

          {!isText && !isLayout && (
          <Group title="Video">
          {/* ทุกเลนมีทรงได้ — V1 ใช้ทรงแบ่งฉากคู่กับ V2/V3 เป็น split screen */}
          {(
            <Section title="Shape / แบ่งฉาก" fx>
              <PropRow label="Shape" changed={changed("shape")} onReset={() => reset(["shape"])}>
                <select
                  className="prop-select"
                  value={t.shape}
                  onChange={(e) => set("shape", e.target.value)}
                >
                  {PIP_SHAPES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </PropRow>
            </Section>
          )}
          <Section title="Motion" fx>
            <PropRow
              label="Position"
              changed={changed("x") || changed("y")}
              onReset={() => reset(["x", "y"])}
            >
              <DragValue value={t.x} onChange={(v) => set("x", v)} step={1} decimals={0} />
              <DragValue value={t.y} onChange={(v) => set("y", v)} step={1} decimals={0} />
            </PropRow>
            <PropRow label="Scale" changed={changed("scale")} onReset={() => reset(["scale"])}>
              <DragValue
                value={t.scale}
                onChange={(v) => set("scale", v)}
                step={0.5}
                min={1}
                max={1000}
              />
            </PropRow>
            <PropRow
              label="Rotation"
              changed={changed("rotation")}
              onReset={() => reset(["rotation"])}
            >
              <DragValue
                value={t.rotation}
                onChange={(v) => set("rotation", v)}
                step={0.5}
                min={-360}
                max={360}
              />
            </PropRow>
          </Section>
          <Section title="Opacity" fx>
            <PropRow label="Opacity" changed={changed("opacity")} onReset={() => reset(["opacity"])}>
              <DragValue
                value={t.opacity}
                onChange={(v) => set("opacity", v)}
                step={0.5}
                min={0}
                max={100}
              />
              <span className="prop-suffix">%</span>
            </PropRow>
          </Section>
          <Section title="Speed" fx>
            <PropRow
              label={
                <>
                  <Gauge size={11} style={{ verticalAlign: -2, marginRight: 4 }} />
                  Speed
                </>
              }
              changed={(clip.speed || 1) !== 1}
              onReset={() => onSetSpeed(clip.id, 1)}
            >
              <DragValue
                value={clip.speed || 1}
                onChange={(v) => onSetSpeed(clip.id, v)}
                step={0.01}
                min={0.1}
                max={4}
                decimals={2}
              />
              <span className="prop-suffix">x</span>
            </PropRow>
          </Section>
          <Section title="Effects" fx>
            <PropRow label="Blur" changed={changed("blur")} onReset={() => reset(["blur"])}>
              <DragValue value={t.blur} onChange={(v) => set("blur", v)} step={0.2} min={0} max={50} />
              <span className="prop-suffix">px</span>
            </PropRow>
            <PropRow label="Look" changed={changed("look")} onReset={() => reset(["look"])}>
              <select
                className="prop-select"
                value={t.look}
                onChange={(e) => set("look", e.target.value)}
              >
                {LOOKS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </PropRow>
            <PropRow label="Sharpen" changed={changed("sharpen")} onReset={() => reset(["sharpen"])}>
              <DragValue
                value={t.sharpen}
                onChange={(v) => set("sharpen", v)}
                step={1}
                min={0}
                max={100}
                decimals={0}
              />
              <span className="prop-suffix">%</span>
            </PropRow>
            <PropRow label="Blend" changed={changed("blend")} onReset={() => reset(["blend"])}>
              <select
                className="prop-select"
                value={t.blend}
                onChange={(e) => set("blend", e.target.value)}
              >
                {BLEND_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </PropRow>
            <PropRow
              label="Direction"
              changed={changed("flipH") || changed("flipV")}
              onReset={() => reset(["flipH", "flipV"])}
            >
              <button
                className={`icon-btn tiny ${t.flipH ? "active" : ""}`}
                title="พลิกซ้าย-ขวา"
                onClick={() => set("flipH", !t.flipH)}
              >
                <FlipHorizontal size={13} />
              </button>
              <button
                className={`icon-btn tiny ${t.flipV ? "active" : ""}`}
                title="พลิกบน-ล่าง"
                onClick={() => set("flipV", !t.flipV)}
              >
                <FlipVertical size={13} />
              </button>
            </PropRow>
            <PropRow label="Time" changed={changed("fade")} onReset={() => reset(["fade"])}>
              <DragValue value={t.fade} onChange={(v) => set("fade", v)} step={0.05} min={0} max={5} />
              <span className="prop-suffix">s fade</span>
            </PropRow>
            {(() => {
              const fx = { reverse: false, ...clip.audioFx };
              const busy = audioJob?.status === "working" && audioJob.clipId === clip.id;
              return (
                <label
                  className="check-row"
                  title="เล่นก้อนนี้ถอยหลังทั้งภาพและเสียง (ประมวลผลครั้งแรกอาจใช้เวลาตามความยาวคลิป)"
                >
                  <input
                    type="checkbox"
                    checked={fx.reverse}
                    disabled={busy}
                    onChange={(e) => onAudioFx(clip.id, { reverse: e.target.checked })}
                  />
                  ย้อนภาพกลับ (Reverse)
                  {busy && <Loader2 size={11} className="spin" />}
                </label>
              );
            })()}
          </Section>
          </Group>
          )}

          {!isText && !isLayout && (
          <Group title="Audio">
          <Section title="Volume" fx>
            <PropRow label="Level" changed={changed("volume")} onReset={() => reset(["volume"])}>
              <DragValue
                value={t.volume}
                onChange={(v) => set("volume", v)}
                step={1}
                min={0}
                max={500}
                decimals={0}
              />
              <span className="prop-suffix">%</span>
            </PropRow>
            {t.volume > 100 && (
              <div className="prop-note dim">มี limiter กันเสียงแตกให้อัตโนมัติ</div>
            )}
            <PropRow
              label="Fade In"
              changed={changed("audioFadeIn")}
              onReset={() => reset(["audioFadeIn"])}
            >
              <DragValue
                value={t.audioFadeIn}
                onChange={(v) => set("audioFadeIn", v)}
                step={0.05}
                min={0}
                max={10}
              />
              <span className="prop-suffix">s</span>
            </PropRow>
            <PropRow
              label="Fade Out"
              changed={changed("audioFadeOut")}
              onReset={() => reset(["audioFadeOut"])}
            >
              <DragValue
                value={t.audioFadeOut}
                onChange={(v) => set("audioFadeOut", v)}
                step={0.05}
                min={0}
                max={10}
              />
              <span className="prop-suffix">s</span>
            </PropRow>
            <PropRow label="Pan" changed={changed("pan")} onReset={() => reset(["pan"])}>
              <span className="prop-suffix">L</span>
              <DragValue
                value={t.pan}
                onChange={(v) => set("pan", v)}
                step={1}
                min={-100}
                max={100}
                decimals={0}
              />
              <span className="prop-suffix">R</span>
            </PropRow>
          </Section>
          <Section title="Cleanup" fx>
            {(() => {
              const fx = { denoise: false, enhance: false, ...clip.audioFx };
              const busy = audioJob?.status === "working" && audioJob.clipId === clip.id;
              return (
                <>
                  <label className="check-row" title="ลดเสียงรบกวนพื้นหลัง (ลม/ฮัม/ซ่า) เฉพาะก้อนนี้">
                    <input
                      type="checkbox"
                      checked={fx.denoise}
                      disabled={busy}
                      onChange={(e) => onAudioFx(clip.id, { denoise: e.target.checked })}
                    />
                    ลดนอยซ์ (Reduce Noise)
                  </label>
                  <label className="check-row" title="ปรับความดังให้สม่ำเสมอ + ตัดความถี่ต่ำกวนๆ เฉพาะก้อนนี้">
                    <input
                      type="checkbox"
                      checked={fx.enhance}
                      disabled={busy}
                      onChange={(e) => onAudioFx(clip.id, { enhance: e.target.checked })}
                    />
                    เสียงพูดชัด (Enhance)
                  </label>
                  {busy && (
                    <div className="prop-note dim">
                      <Loader2 size={11} className="spin" style={{ verticalAlign: -2 }} />{" "}
                      กำลังประมวลผลเสียง…
                    </div>
                  )}
                  {audioJob?.status === "error" && audioJob.clipId === clip.id && (
                    <div className="extract-result err">ไม่สำเร็จ: {audioJob.error}</div>
                  )}
                </>
              );
            })()}
          </Section>
          </Group>
          )}
        </>
      )}

      {/* ---------- แท็บ Effect & Animate — เอฟเฟกต์และแอนิเมชันข้อความ ---------- */}
      {section === "text-anim" && supportsMask && (
        <Group title="Mask / Object FX" defaultOpen>
          <MaskFxControls clip={clip} onUpdate={onUpdate} onEditMask={onEditMask} onRedrawMask={onRedrawMask}
            onDeleteMask={onDeleteMask} onTrackMask={onTrackMask} onCancelMaskTrack={onCancelMaskTrack}
            maskTrackJob={maskTrackJob} maskToolActive={maskToolActive} />
        </Group>
      )}
      {section === "text-anim" && !isText && !isImage && !isLayout && clip && (t.colorGrade && t.colorGrade !== "none" || t.videoFxIn || t.videoFxOut) && (
        <Group title="Effect & Animate" defaultOpen>
          {t.colorGrade && t.colorGrade !== "none" && (
            <Section title="ปรับสี" fx>
              <div className="prop-hint">Preset: {{ "cinema-gold": "Cinema Gold", "la-la-blue": "La La Land Blue", "twilight-teal": "Twilight Teal", "black-white": "Black & White" }[t.colorGrade] || t.colorGrade}</div>
              <PropRow label="ความแรง" changed={(t.colorGradeStrength ?? 100) !== 100} onReset={() => set("colorGradeStrength", 100)}>
                <DragValue value={t.colorGradeStrength ?? 100} onChange={(v) => set("colorGradeStrength", Math.min(100, Math.max(0, v)))} step={1} min={0} max={100} decimals={0} />
                <span className="prop-suffix">%</span>
              </PropRow>
            </Section>
          )}
          {t.videoFxIn && (
            <Section title="เอฟเฟกต์เปิด (In)" fx>
              <div className="prop-hint">เอฟเฟกต์: {t.videoFxIn}</div>
              <PropRow label="ระยะเวลา" changed={(t.videoFxInDuration ?? 1) !== 1} onReset={() => set("videoFxInDuration", 1)}>
                <DragValue value={t.videoFxInDuration ?? 1} onChange={(v) => set("videoFxInDuration", Math.min(10, Math.max(.1, v)))} step={.1} min={.1} max={10} />
                <span className="prop-suffix">s</span>
              </PropRow>
            </Section>
          )}
          {t.videoFxOut && (
            <Section title="เอฟเฟกต์ปิด (Out)" fx>
              <div className="prop-hint">เอฟเฟกต์: {t.videoFxOut}</div>
              <PropRow label="ระยะเวลา" changed={(t.videoFxOutDuration ?? 1) !== 1} onReset={() => set("videoFxOutDuration", 1)}>
                <DragValue value={t.videoFxOutDuration ?? 1} onChange={(v) => set("videoFxOutDuration", Math.min(10, Math.max(.1, v)))} step={.1} min={.1} max={10} />
                <span className="prop-suffix">s</span>
              </PropRow>
            </Section>
          )}
        </Group>
      )}
      {section === "text-anim" && !supportsMask && !isText && !isImage && !isLayout && (!clip || !((t.colorGrade && t.colorGrade !== "none") || t.videoFxIn || t.videoFxOut)) && (
        <div className="properties-hint">
          <Sparkles size={16} />
          <p>เลือกก้อนข้อความบน timeline เพื่อปรับแอนิเมชัน</p>
          <p className="dim">(เลือกชนิดเอฟเฟกต์ที่จอ Program → แท็บ Effect Controls แล้วมาปรับความเร็ว/ความหน่วง/ช่วงเวลาที่นี่)</p>
        </div>
      )}
      {section === "text-anim" && clip?.sceneId && (
        <Group title="เวลาใน Scene" defaultOpen>
          <Section title="ช่วงเวลาแสดง" fx>
            <PropRow label="เวลาเริ่ม" changed={(clip.sceneLocalOffset ?? 0) !== 0} onReset={() => onUpdate(clip.id, { offset: 0 })}>
              <DragValue value={clip.sceneLocalOffset ?? 0} onChange={(v) => {
                const start = Math.max(0, Math.min(v, clip.sceneDuration - 0.1));
                onUpdate(clip.id, { offset: start, duration: Math.min(clip.duration, clip.sceneDuration - start) });
              }} step={0.1} min={0} max={clip.sceneDuration - 0.1} />
              <span className="prop-suffix">s</span>
            </PropRow>
            <PropRow label="เวลาสิ้นสุด" changed={(clip.sceneLocalOffset ?? 0) + clip.duration < clip.sceneDuration - 0.001} onReset={() => onUpdate(clip.id, { duration: clip.sceneDuration - (clip.sceneLocalOffset ?? 0) })}>
              <DragValue value={(clip.sceneLocalOffset ?? 0) + clip.duration} onChange={(v) => onUpdate(clip.id, { duration: Math.max(0.1, Math.min(clip.sceneDuration, v) - (clip.sceneLocalOffset ?? 0)) })} step={0.1} min={(clip.sceneLocalOffset ?? 0) + 0.1} max={clip.sceneDuration} />
              <span className="prop-suffix">s</span>
            </PropRow>
            <div className="prop-hint">ช่วงเวลานี้อ้างอิงจากต้น Scene และจะไม่เกินความยาวของ Scene แม่</div>
          </Section>
        </Group>
      )}
      {section === "text-anim" && isImage && (
        <Group title="Effect & Animate" defaultOpen>
          <Section title="รูปภาพ" fx>
            <div className="prop-hint">
              เอฟเฟกต์ปัจจุบัน: {clip.transform?.shape === "circle" ? "วงกลม" : "รูปปกติ"}
            </div>
            {clip.transform?.shape === "circle" && (
              <>
                <PropRow label="ตำแหน่งแนวนอน" changed={(clip.transform?.cropX ?? 50) !== 50} onReset={() => onUpdate(clip.id, { transform: { ...clip.transform, cropX: 50 } })}>
                  <DragValue value={clip.transform?.cropX ?? 50} onChange={(v) => onUpdate(clip.id, { transform: { ...clip.transform, cropX: Math.min(100, Math.max(0, v)) } })} step={1} min={0} max={100} decimals={0} /><span className="prop-suffix">%</span>
                </PropRow>
                <PropRow label="ตำแหน่งแนวตั้ง" changed={(clip.transform?.cropY ?? 50) !== 50} onReset={() => onUpdate(clip.id, { transform: { ...clip.transform, cropY: 50 } })}>
                  <DragValue value={clip.transform?.cropY ?? 50} onChange={(v) => onUpdate(clip.id, { transform: { ...clip.transform, cropY: Math.min(100, Math.max(0, v)) } })} step={1} min={0} max={100} decimals={0} /><span className="prop-suffix">%</span>
                </PropRow>
                <PropRow label="ขยายภาพด้านใน" changed={(clip.transform?.cropZoom ?? 100) !== 100} onReset={() => onUpdate(clip.id, { transform: { ...clip.transform, cropZoom: 100 } })}>
                  <DragValue value={clip.transform?.cropZoom ?? 100} onChange={(v) => onUpdate(clip.id, { transform: { ...clip.transform, cropZoom: Math.min(300, Math.max(25, v)) } })} step={1} min={25} max={300} decimals={0} /><span className="prop-suffix">%</span>
                </PropRow>
              </>
            )}
          </Section>
          {clip.transform?.imageIn && (
          <Section title="อนิเมะเข้า" fx>
            <div className="prop-hint">เอฟเฟกต์: {clip.transform.imageIn}</div>
            <PropRow label="ระยะเวลา" changed={(clip.transform?.imageInDur ?? 0.6) !== 0.6} onReset={() => onUpdate(clip.id, { transform: { ...clip.transform, imageInDur: 0.6 } })}>
              <DragValue value={clip.transform?.imageInDur ?? 0.6} onChange={(v) => onUpdate(clip.id, { transform: { ...clip.transform, imageInDur: Math.min(5, Math.max(0.1, v)) } })} step={0.1} min={0.1} max={5} /><span className="prop-suffix">s</span>
            </PropRow>
            {clip.transform?.imageIn?.startsWith("slide") && (
              <PropRow label="จุดเริ่มตอนเข้า" changed={(clip.transform?.imageInPath ?? "auto") !== "auto"} onReset={() => onUpdate(clip.id, { transform: { ...clip.transform, imageInPath: "auto" } })}>
                <select className="prop-select" value={clip.transform?.imageInPath ?? "auto"} onChange={(e) => onUpdate(clip.id, { transform: { ...clip.transform, imageInPath: e.target.value } })}>
                  <option value="auto">ตามเอฟเฟกต์</option><option value="same">ตำแหน่งเดิม</option><option value="center">กลางจอ</option><option value="bottom">พื้นล่างจอ</option><option value="top">ด้านบนจอ</option><option value="left">ซ้ายจอ</option><option value="right">ขวาจอ</option>
                </select>
              </PropRow>
            )}
          </Section>
          )}
          {clip.transform?.imageOut && (
          <Section title="อนิเมะออก" fx>
            <div className="prop-hint">เอฟเฟกต์: {clip.transform.imageOut}</div>
            <PropRow label="ระยะเวลา" changed={(clip.transform?.imageOutDur ?? 0.6) !== 0.6} onReset={() => onUpdate(clip.id, { transform: { ...clip.transform, imageOutDur: 0.6 } })}>
              <DragValue value={clip.transform?.imageOutDur ?? 0.6} onChange={(v) => onUpdate(clip.id, { transform: { ...clip.transform, imageOutDur: Math.min(5, Math.max(0.1, v)) } })} step={0.1} min={0.1} max={5} /><span className="prop-suffix">s</span>
            </PropRow>
            {clip.transform?.imageOut?.startsWith("slide") && (
              <PropRow label="จุดปลายตอนออก" changed={(clip.transform?.imageOutPath ?? "auto") !== "auto"} onReset={() => onUpdate(clip.id, { transform: { ...clip.transform, imageOutPath: "auto" } })}>
                <select className="prop-select" value={clip.transform?.imageOutPath ?? "auto"} onChange={(e) => onUpdate(clip.id, { transform: { ...clip.transform, imageOutPath: e.target.value } })}>
                  <option value="auto">ตามเอฟเฟกต์</option><option value="same">ตำแหน่งเดิม</option><option value="center">กลางจอ</option><option value="bottom">พื้นล่างจอ</option><option value="top">ด้านบนจอ</option><option value="left">ซ้ายจอ</option><option value="right">ขวาจอ</option>
                </select>
              </PropRow>
            )}
          </Section>
          )}
        </Group>
      )}
      {section === "text-anim" && isText && (
        <Group title="Effect & Animate" defaultOpen>
          <Section title="เอฟเฟกต์ที่ใช้" fx>
            {(clip.style?.animIn || clip.style?.animOut || clip.style?.anim) ? (
              <>
                <PropRow
                  label="Anim Speed"
                  changed={(clip.style?.animDur ?? 0.6) !== 0.6}
                  onReset={() => onUpdate(clip.id, { style: { ...clip.style, animDur: 0.6 } })}
                >
                  <DragValue
                    value={clip.style?.animDur ?? 0.6}
                    onChange={(v) => onUpdate(clip.id, { style: { ...clip.style, animDur: Math.min(3, Math.max(0.1, v)) } })}
                    step={0.1}
                    min={0.1}
                    max={3}
                  />
                  <span className="prop-suffix">s</span>
                </PropRow>
                {/* เส้นความหน่วง — เลือกให้เอฟเฟกต์นุ่ม/เบรก/เร่ง (เหมือน Smoothing ใน CapCut/Canva) */}
                <PropRow
                  label="Smoothing"
                  changed={(clip.style?.animEase ?? "spring") !== "spring"}
                  onReset={() => onUpdate(clip.id, { style: { ...clip.style, animEase: "spring" } })}
                >
                  <select
                    className="prop-select"
                    value={clip.style?.animEase ?? "spring"}
                    onChange={(e) => onUpdate(clip.id, { style: { ...clip.style, animEase: e.target.value } })}
                  >
                    {TEXT_EASINGS.map((es) => (
                      <option key={es.id} value={es.id}>
                        {es.label}
                      </option>
                    ))}
                  </select>
                </PropRow>
                {/* กระจายรายตัว — หัวใจของลุค jitter: ทีละคำ/ตัวอักษรเหลื่อมเวลากัน */}
                {KINETIC_ANIMS.has(clip.style.animIn || clip.style.animOut || clip.style.anim) && (
                  <>
                    <PropRow
                      label="ใส่เอฟเฟกต์แบบ"
                      changed={(clip.style?.animBy ?? defaultAnimBy(clip.style.anim)) !== defaultAnimBy(clip.style.anim)}
                      onReset={() => onUpdate(clip.id, { style: { ...clip.style, animBy: defaultAnimBy(clip.style.anim) } })}
                    >
                      <select
                        className="prop-select"
                        value={clip.style?.animBy ?? defaultAnimBy(clip.style.anim)}
                        onChange={(e) => onUpdate(clip.id, { style: { ...clip.style, animBy: e.target.value } })}
                      >
                        {ANIM_BY.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </PropRow>
                    {(clip.style?.animBy ?? defaultAnimBy(clip.style.anim)) !== "all" && (
                      <>
                        <PropRow
                          label="ลำดับ"
                          changed={(clip.style?.animOrder ?? "forward") !== "forward"}
                          onReset={() => onUpdate(clip.id, { style: { ...clip.style, animOrder: "forward" } })}
                        >
                          <select
                            className="prop-select"
                            value={clip.style?.animOrder ?? "forward"}
                            onChange={(e) => onUpdate(clip.id, { style: { ...clip.style, animOrder: e.target.value } })}
                          >
                            {ANIM_ORDER.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </PropRow>
                        <PropRow
                          label="Delay"
                          changed={clip.style?.animStagger != null}
                          onReset={() => {
                            const s = { ...clip.style };
                            delete s.animStagger;
                            onUpdate(clip.id, { style: s });
                          }}
                        >
                          <DragValue
                            value={Math.round(
                              (clip.style?.animStagger ?? ((clip.style?.animBy ?? defaultAnimBy(clip.style.anim)) === "letters" ? 0.035 : 0.08)) * 1000
                            )}
                            onChange={(v) => onUpdate(clip.id, { style: { ...clip.style, animStagger: Math.max(0, Math.min(500, v)) / 1000 } })}
                            step={5}
                            min={0}
                            max={500}
                            decimals={0}
                          />
                          <span className="prop-suffix">ms</span>
                        </PropRow>
                      </>
                    )}
                  </>
                )}
              </>
            ) : (
              <div className="prop-hint">
                ยังไม่ได้เลือกเอฟเฟกต์ — เลือกที่จอ Program → แท็บ Effect Controls ก่อน แล้วความเร็ว/ความหน่วงจะมาปรับตรงนี้
              </div>
            )}
          </Section>
          <Section title="ช่วงเวลาเอฟเฟกต์" fx>
            {/* จุดเริ่ม–จุดจบเอฟเฟกต์: ข้อความมีผลจริงเฉพาะช่วงนี้ภายในก้อน
                เช่น ก้อนวางไว้ยาว แต่ให้ข้อความโผล่แค่ช่วงกลาง */}
            <PropRow
              label="เริ่มเอฟเฟกต์"
              changed={(clip.style?.inAt ?? 0) !== 0}
              onReset={() => onUpdate(clip.id, { style: { ...clip.style, inAt: 0 } })}
            >
              <DragValue
                value={clip.style?.inAt ?? 0}
                onChange={(v) =>
                  onUpdate(clip.id, {
                    style: { ...clip.style, inAt: Math.max(0, Math.min(v, (clip.style?.outAt ?? clip.duration) - 0.1)) },
                  })
                }
                step={0.1}
                min={0}
                max={clip.duration}
              />
              <span className="prop-suffix">s</span>
            </PropRow>
            <PropRow
              label="จบเอฟเฟกต์"
              changed={(clip.style?.outAt ?? clip.duration) !== clip.duration}
              onReset={() => onUpdate(clip.id, { style: { ...clip.style, outAt: clip.duration } })}
            >
              <DragValue
                value={clip.style?.outAt ?? clip.duration}
                onChange={(v) =>
                  onUpdate(clip.id, {
                    style: { ...clip.style, outAt: Math.min(clip.duration, Math.max(v, (clip.style?.inAt ?? 0) + 0.1)) },
                  })
                }
                step={0.1}
                min={0}
                max={clip.duration}
              />
              <span className="prop-suffix">s</span>
            </PropRow>
            <div className="prop-hint">
              ก้อนนี้ยาว {clip.duration.toFixed(1)}s — ตั้งให้ข้อความโผล่เฉพาะช่วงที่ต้องการได้ (นอกช่วงจะซ่อน)
            </div>
          </Section>
        </Group>
      )}

      {sceneObjectsOpen && clip?.type === "scene" && (
        <div className="modal-overlay scene-objects-overlay" onMouseDown={(e) => e.target === e.currentTarget && setSceneObjectsOpen(false)}>
          <div className="scene-objects-modal">
            <div className="scene-objects-titlebar">
              <div><strong>Scene Objects</strong><span>{clip.name} · {clip.children?.length || 0} object</span></div>
              <div className="scene-objects-actions">
                <button className={`btn-secondary sm ${sceneObjectsView === "order" ? "active" : ""}`} onClick={() => setSceneObjectsView("order")}>จัดลำดับ</button>
                <button className={`btn-secondary sm ${sceneObjectsView === "time" ? "active" : ""}`} onClick={() => setSceneObjectsView("time")}>แก้เวลา</button>
                <button className="icon-btn" onClick={() => setSceneObjectsOpen(false)}><X size={15} /></button>
              </div>
            </div>
            <div className="scene-objects-head"><span>ลำดับ</span><span>ตัวอย่าง Object ใน Scene</span><span>ช่วงเวลา</span></div>
            <div className="scene-objects-list">
              {(clip.children || []).map((child, index) => (
                <div
                  key={child.id}
                  className={`scene-object-row ${sceneObjectsView === "time" ? "time-mode" : ""} ${dragObjectIndex === index ? "dragging" : ""}`}
                  draggable={sceneObjectsView === "order"}
                  onDragStart={(e) => { setDragObjectIndex(index); e.dataTransfer.effectAllowed = "move"; }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragObjectIndex == null || dragObjectIndex === index) return setDragObjectIndex(null);
                    const children = [...(clip.children || [])];
                    const [moved] = children.splice(dragObjectIndex, 1);
                    children.splice(index, 0, moved);
                    onUpdate(clip.id, { children });
                    setDragObjectIndex(null);
                  }}
                  onDragEnd={() => setDragObjectIndex(null)}
                  onClick={() => onSelectClipId?.(child.id)}
                >
                  <div className="scene-object-main">
                    <span className="scene-object-order">{String(index).padStart(2, "0")}</span>
                    <span className="scene-object-name">
                      {sceneObjectsView === "order" && <GripVertical size={14} />}
                      {child.type === "image" ? <img src={child.url} alt="" /> : <b className="scene-text-thumb">{(child.text || "Text").slice(0, 18)}</b>}
                      <span>{child.type === "text" ? child.text || child.name || "Text" : child.name || "Image"}</span>
                    </span>
                    <span className="scene-object-time">{(child.offset || 0).toFixed(1)}–{Math.min(clip.duration, (child.offset || 0) + (child.duration || clip.duration)).toFixed(1)}s</span>
                  </div>
                  {sceneObjectsView === "time" && <SceneObjectTimeBar scene={clip} child={child} onUpdate={onUpdate} />}
                </div>
              ))}
              {!clip.children?.length && <div className="scene-objects-empty">ยังไม่มีรูปหรือข้อความใน Scene</div>}
            </div>
            <div className="scene-objects-footer">{sceneObjectsView === "order" ? "ลากแถวขึ้น–ลงเพื่อเปลี่ยนลำดับ · ลำดับนี้จะใช้กับ Auto Animate" : "ลากขอบซ้าย/ขวาเพื่อกำหนดจุดเกิดและจุดสิ้นสุด · เวลาไม่เกิน Scene แม่"}</div>
          </div>
        </div>
      )}

      {/* ---------- แท็บ AI เสียง ---------- */}
      {section === "ai-audio" && (
        <>
          {/* ถอดเสียงเป็นซับ (Whisper) — โชว์เฉพาะเมื่อติดตั้ง engine แล้ว */}
          {sttEngines.length > 0 ? (
            <div className="stt-tool">
                {(() => {
                  const target = clip && !isText && !isLayout ? clip : null;
                  const running = sttJob?.status === "working";
                  const mine = sttJob && target && sttJob.clipId === target.id;
                  const handleClick = () => {
                    if (!target) {
                      window.alert("คลิกเลือกก้อนวิดีโอ/เสียงบน timeline ก่อน");
                      return;
                    }
                    onTranscribe(target);
                  };
                  return (
                    <>
                      <ToolOptions
                        badge={sttEngines.length > 1 && sttEngineId !== sttEngines[0].id ? "โมเดล" : null}
                        main={
                          <button className="btn-secondary" disabled={running} onClick={handleClick}>
                            {running && mine ? (
                              <>
                                <Loader2 size={13} className="spin" /> กำลังถอดเสียง…
                              </>
                            ) : (
                              "ถอดเสียงเป็นซับ (AI)"
                            )}
                          </button>
                        }
                      >
                        <PropRow label="ภาษา">
                          <select
                            className="prop-select"
                            value={sttLang}
                            disabled={running}
                            onChange={(e) => onSelectSttLang(e.target.value)}
                          >
                            <option value="auto">ตรวจอัตโนมัติ</option>
                            <option value="th">ไทย</option>
                            <option value="en">อังกฤษ</option>
                            <option value="ja">ญี่ปุ่น</option>
                            <option value="zh">จีน</option>
                            <option value="ko">เกาหลี</option>
                          </select>
                        </PropRow>
                        {sttEngines.length > 1 && (
                          <PropRow label="Model">
                            <select
                              className="prop-select"
                              value={sttEngineId ?? ""}
                              disabled={running}
                              onChange={(e) => onSelectSttEngine(e.target.value)}
                            >
                              {sttEngines.map((e) => (
                                <option key={e.id} value={e.id}>
                                  {e.name}
                                </option>
                              ))}
                            </select>
                          </PropRow>
                        )}
                        <div className="prop-label">สไตล์ซับ</div>
                        <SubtitleStyleDrop tpl={subtitleTpl} onSet={onSetSubtitleTpl} />
                      </ToolOptions>
                      {running && mine && (
                        <div className="extract-progress">
                          <div className="progress-track">
                            <div
                              className="progress-fill"
                              style={{
                                width: sttJob.total
                                  ? `${Math.min(100, (sttJob.done / sttJob.total) * 100)}%`
                                  : "0%",
                              }}
                            />
                          </div>
                          <span className="dim">
                            {Math.round((sttJob.done || 0) / 1000)} / {Math.round((sttJob.total || 0) / 1000)} วิ
                          </span>
                        </div>
                      )}
                      {sttJob?.status === "done" && mine && (
                        <div className="extract-result ok">
                          ✓ ถอดเสียงเสร็จ — เพิ่มซับ {sttJob.count} ก้อนบน timeline แล้ว
                        </div>
                      )}
                      {sttJob?.status === "empty" && mine && (
                        <div className="extract-result err">ไม่พบเสียงพูดในก้อนนี้</div>
                      )}
                      {sttJob?.status === "error" && mine && (
                        <div className="extract-result err">ถอดเสียงไม่สำเร็จ: {sttJob.error}</div>
                      )}
                    </>
                  );
                })()}
            </div>
          ) : (
            <div className="properties-hint">
              <Sparkles size={16} />
              <p>เครื่องมือ AI เสียง</p>
              <p className="dim">
                ยังไม่ได้ติดตั้งเครื่องมือถอดเสียง — เปิด ⚙ (ตั้งค่า AI Engines) แล้วติดตั้ง “Whisper” เพื่อถอดเสียงเป็นซับอัตโนมัติ
              </p>
              <p className="dim">ระหว่างนี้ ลดนอยซ์/เสียงพูดชัดแบบพื้นฐานใช้ได้จากแท็บ Properties → หมวด Audio</p>
            </div>
          )}
        </>
      )}

      {section === "ai" && (isText || isLayout) && (
        <div className="properties-hint">
          <Sparkles size={16} />
          <p>เลือกก้อนวิดีโอบน timeline เพื่อใช้เครื่องมือ AI</p>
        </div>
      )}

      {section === "ai" && !isText && !isLayout && (
      <>
      {/* ตัดฉากหลัง — โชว์เฉพาะเมื่อติดตั้ง engine แล้ว (ยังไม่ลง = ซ่อน ไม่รก) */}
      {bgEngineReady && (() => {
        const target = clip; // ทำงานกับก้อนที่เลือกบน timeline
        const running = bgJob?.status === "working";
        const mine = bgJob && target && bgJob.clipId === target.id;
        const already = !!target?.bgRemoved; // ก้อนนี้ผ่านการลบพื้นหลังมาแล้ว
        // ไม่โชว์คำเตือนรกๆ ไว้ก่อน — เตือนตอนกดเท่านั้น
        const handleClick = () => {
          if (!bgEngineReady) {
            if (window.confirm("ยังไม่ได้ติดตั้ง AI Engine สำหรับลบพื้นหลัง\nเปิดหน้าตั้งค่าเพื่อติดตั้งเลยไหม?")) {
              onOpenEngines();
            }
            return;
          }
          if (!target) {
            window.alert("คลิกเลือกก้อนวิดีโอบน timeline ก่อน");
            return;
          }
          if (window.confirm("ลบพื้นหลังทั้งก้อนนี้?\nงานนี้ใช้เวลานาน (วิดีโอ 1 นาที ≈ 4–10 นาที) ระหว่างรอตัดต่อต่อได้")) {
            onRemoveBg(target);
          }
        };
        return (
          <>
            <ToolOptions
              badge={bgEngines.length > 1 && bgEngineId !== bgEngines[0].id ? "โมเดล" : null}
              main={
                <button
                  className="btn-secondary"
                  disabled={running || already}
                  title={already ? "ก้อนนี้ลบพื้นหลังไปแล้ว — ผลลัพธ์อยู่ในก้อนนี้เลย" : undefined}
                  onClick={handleClick}
                >
                  {running && mine ? (
                    <>
                      <Loader2 size={13} className="spin" /> กำลังลบพื้นหลัง…
                    </>
                  ) : already ? (
                    "✓ ลบพื้นหลังแล้ว"
                  ) : (
                    "ลบพื้นหลัง (AI)"
                  )}
                </button>
              }
            >
              <PropRow
                label="Model"
                changed={bgEngines.length > 1 && bgEngineId !== bgEngines[0].id}
                onReset={() => onSelectBgEngine(bgEngines[0]?.id)}
              >
                <select
                  className="prop-select"
                  value={bgEngineId ?? ""}
                  disabled={running || bgEngines.length < 2}
                  onChange={(e) => onSelectBgEngine(e.target.value)}
                >
                  {bgEngines.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </PropRow>
            </ToolOptions>
            {running && mine && (
              <div className="extract-progress">
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{
                      width: bgJob.total ? `${Math.min(100, (bgJob.done / bgJob.total) * 100)}%` : "0%",
                    }}
                  />
                </div>
                <span className="dim">
                  {bgJob.done} / {bgJob.total || "?"} เฟรม
                </span>
                <button
                  className="btn-secondary sm danger"
                  title="หยุดงานนี้ทันที (ก้อนเดิมไม่ถูกแก้)"
                  disabled={bgJob.cancel}
                  onClick={() => onCancelJob(bgJob)}
                >
                  <Ban size={12} /> {bgJob.cancel ? "กำลังหยุด…" : "ยกเลิก"}
                </button>
              </div>
            )}
            {bgJob?.status === "done" && mine && (
              <div className="extract-result ok">✓ ลบพื้นหลังเสร็จแล้ว — ก้อนนี้ใช้ไฟล์ใหม่ (ชื่อลงท้าย _nobg)</div>
            )}
            {bgJob?.status === "error" && mine && (
              <div className="extract-result err">ลบพื้นหลังไม่สำเร็จ: {bgJob.error}</div>
            )}
          </>
        );
      })()}
      {/* ปรับภาพชัด (AI Upscale) — โชว์เฉพาะเมื่อติดตั้ง engine แล้ว */}
      {upEngines.length > 0 && (() => {
        const target = clip;
        const running = upJob?.status === "working";
        const mine = upJob && target && upJob.clipId === target.id;
        const already = !!target?.upscaled; // ก้อนนี้ผ่านการอัปสเกลมาแล้ว
        const handleClick = () => {
          if (upEngines.length === 0) {
            if (window.confirm("ยังไม่ได้ติดตั้ง AI Engine สำหรับปรับภาพชัด\nเปิดหน้าตั้งค่าเพื่อติดตั้งเลยไหม?")) {
              onOpenEngines();
            }
            return;
          }
          if (!target) {
            window.alert("คลิกเลือกก้อนวิดีโอบน timeline ก่อน");
            return;
          }
          if (window.confirm("ปรับภาพชัดก้อนนี้?\nงานนี้ช้ามาก (ทำทีละเฟรม) แนะนำใช้กับก้อนสั้นๆ\nแค่อยากคมขึ้นนิดเดียว ใช้ Sharpen ในหมวด Effects ฟรีและเร็วกว่า")) {
            onUpscale(target);
          }
        };
        return (
          <>
            <ToolOptions
              badge={upEngines.length > 1 && upEngineId !== upEngines[0].id ? "โมเดล" : null}
              main={
                <button
                  className="btn-secondary"
                  disabled={running || already}
                  title={already ? "ก้อนนี้ปรับภาพชัดไปแล้ว (×2) — อัปซ้ำไม่ช่วยให้ชัดขึ้น" : undefined}
                  onClick={handleClick}
                >
                  {running && mine ? (
                    <>
                      <Loader2 size={13} className="spin" /> กำลังปรับภาพชัด…
                    </>
                  ) : already ? (
                    "✓ ปรับภาพชัดแล้ว (×2)"
                  ) : (
                    "ปรับภาพชัด (AI Upscale)"
                  )}
                </button>
              }
            >
              <PropRow
                label="Model"
                changed={upEngines.length > 1 && upEngineId !== upEngines[0].id}
                onReset={() => onSelectUpEngine(upEngines[0]?.id)}
              >
                <select
                  className="prop-select"
                  value={upEngineId ?? ""}
                  disabled={running || upEngines.length < 2}
                  onChange={(e) => onSelectUpEngine(e.target.value)}
                >
                  {upEngines.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </PropRow>
            </ToolOptions>
            {running && mine && (
              <div className="extract-progress">
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{
                      width: upJob.total ? `${Math.min(100, (upJob.done / upJob.total) * 100)}%` : "0%",
                    }}
                  />
                </div>
                <span className="dim">
                  {upJob.done} / {upJob.total || "?"} เฟรม
                </span>
                <button
                  className="btn-secondary sm danger"
                  title="หยุดงานนี้ทันที (ก้อนเดิมไม่ถูกแก้)"
                  disabled={upJob.cancel}
                  onClick={() => onCancelJob(upJob)}
                >
                  <Ban size={12} /> {upJob.cancel ? "กำลังหยุด…" : "ยกเลิก"}
                </button>
              </div>
            )}
            {upJob?.status === "done" && mine && (
              <div className="extract-result ok">
                ✓ ปรับภาพชัดเสร็จแล้ว — ก้อนนี้ใช้ไฟล์ใหม่ความละเอียด ×2 (ชื่อลงท้าย _up)
                <br />
                <span className="dim">บนจอ preview อาจดูไม่ต่างมาก เพราะภาพถูกย่อลงมาแสดง — ความต่างเห็นตอน export/ซูม</span>
              </div>
            )}
            {upJob?.status === "error" && mine && (
              <div className="extract-result err">ปรับภาพชัดไม่สำเร็จ: {upJob.error}</div>
            )}
          </>
        );
      })()}
      {/* ลดสั่น (vid.stab 2-pass) — ไม่ใช่ AI ใช้ ffmpeg ในเครื่อง ไม่ต้องติดตั้ง engine */}
      {(() => {
        const target = clip;
        const running = stabJob?.status === "working";
        const mine = stabJob && target && stabJob.clipId === target.id;
        const already = !!target?.stabilized;
        const handleClick = () => {
          if (!target) {
            window.alert("คลิกเลือกก้อนวิดีโอบน timeline ก่อน");
            return;
          }
          onStabilize(target, stabStrength);
        };
        return (
          <>
            <ToolOptions
              badge={stabStrength !== "medium" ? (stabStrength === "high" ? "มาก" : "น้อย") : null}
              main={
                <button
                  className="btn-secondary"
                  disabled={running || already}
                  title={already ? "ก้อนนี้ผ่านการลดสั่นแล้ว" : "วิเคราะห์ 2 รอบด้วย ffmpeg — เร็วกว่างาน AI มาก"}
                  onClick={handleClick}
                >
                  {running && mine ? (
                    <>
                      <Loader2 size={13} className="spin" /> กำลังลดสั่น…
                    </>
                  ) : already ? (
                    "✓ ลดสั่นแล้ว"
                  ) : (
                    "ลดสั่น (Stabilize)"
                  )}
                </button>
              }
            >
              <PropRow
                label="Strength"
                changed={stabStrength !== "medium"}
                onReset={() => setStabStrength("medium")}
              >
                <select
                  className="prop-select"
                  value={stabStrength}
                  disabled={running}
                  onChange={(e) => setStabStrength(e.target.value)}
                  title="ยิ่งแรงภาพยิ่งนิ่ง แต่ขอบภาพถูกครอป/ซูมชดเชยมากขึ้น"
                >
                  <option value="low">น้อย (ครอปขอบน้อย)</option>
                  <option value="medium">กลาง</option>
                  <option value="high">มาก (นิ่งสุด ครอปเยอะ)</option>
                </select>
              </PropRow>
            </ToolOptions>
            {running && mine && (
              <div className="extract-progress">
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${Math.min(100, stabJob.done || 0)}%` }}
                  />
                </div>
                <span className="dim">{stabJob.done || 0}%</span>
                <button
                  className="btn-secondary sm danger"
                  title="หยุดงานนี้ทันที (ก้อนเดิมไม่ถูกแก้)"
                  disabled={stabJob.cancel}
                  onClick={() => onCancelJob(stabJob)}
                >
                  <Ban size={12} /> {stabJob.cancel ? "กำลังหยุด…" : "ยกเลิก"}
                </button>
              </div>
            )}
            {stabJob?.status === "done" && mine && (
              <div className="extract-result ok">✓ ลดสั่นเสร็จแล้ว — ก้อนนี้ใช้ไฟล์ใหม่ (ชื่อลงท้าย _stab)</div>
            )}
            {stabJob?.status === "error" && mine && (
              <div className="extract-result err">ลดสั่นไม่สำเร็จ: {stabJob.error}</div>
            )}
          </>
        );
      })()}
      {/* เซ็นเซอร์ใบหน้าอัตโนมัติ — โชว์เฉพาะเมื่อติดตั้ง engine เซ็นเซอร์สักตัวแล้ว */}
      {censorReady && (() => {
        const target = clip;
        const running = fcJob?.status === "working";
        const mine = fcJob && target && fcJob.clipId === target.id;
        return (
          <>
            {/* ปุ่มหลัก + เฟืองตัวเลือกท้ายปุ่ม (ตัวเลือกเป็นของเครื่องมือนี้เท่านั้น) */}
            <ToolOptions
              badge={
                (fcStyle !== "blur" ? "โมเสก" : "") +
                (keepRefs.length > 0 ? `${fcStyle !== "blur" ? " · " : ""}เก็บ ${keepRefs.length} หน้า` : "") || null
              }
              main={
                <button
                  className="btn-secondary"
                  disabled={running}
                  title="AI ตรวจจับใบหน้าทุกคนในก้อนนี้แล้วเบลอ/โมเสกตามให้เอง — ไม่ต้องลากกล่อง"
                  onClick={() => (target ? onFaceCensor(target) : window.alert("คลิกเลือกก้อนวิดีโอบน timeline ก่อน"))}
                >
                  {running && mine ? (
                    <>
                      <Loader2 size={13} className="spin" /> กำลังเซ็นเซอร์…
                    </>
                  ) : fcTarget === "plate" ? (
                    "เบลอป้ายทะเบียนรถ (AI)"
                  ) : fcTarget === "text" ? (
                    "ปิดข้อความในภาพ/เอกสาร (AI)"
                  ) : keepRefs.length > 0 ? (
                    keepInvert ? "เบลอเฉพาะคนที่เลือก (AI)" : "เบลอทุกคนยกเว้นที่เลือก (AI)"
                  ) : (
                    "เซ็นเซอร์ใบหน้าอัตโนมัติ (AI)"
                  )}
                </button>
              }
            >
              <PropRow
                label="เป้าหมาย"
                changed={fcTarget !== "face"}
                onReset={() => onSelectFcTarget("face")}
              >
                <select
                  className="prop-select"
                  value={fcTarget}
                  disabled={running}
                  onChange={(e) => onSelectFcTarget(e.target.value)}
                >
                  <option value="face">ใบหน้าบุคคล</option>
                  <option value="plate">ป้ายทะเบียนรถ</option>
                  <option value="text">ข้อความในภาพ/เอกสาร</option>
                </select>
              </PropRow>
              {fcTarget === "face" && fcEngines.length > 1 && (
                <PropRow
                  label="Model"
                  changed={fcEngineId !== fcEngines[0].id}
                  onReset={() => onSelectFcEngine(fcEngines[0].id)}
                >
                  <select
                    className="prop-select"
                    value={fcEngineId ?? ""}
                    disabled={running}
                    onChange={(e) => onSelectFcEngine(e.target.value)}
                  >
                    {fcEngines.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </PropRow>
              )}
              <PropRow label="แบบ" changed={fcStyle !== "blur"} onReset={() => onSelectFcStyle("blur")}>
                <select
                  className="prop-select"
                  value={fcStyle}
                  disabled={running}
                  onChange={(e) => onSelectFcStyle(e.target.value)}
                >
                  <option value="blur">เบลอ (Blur)</option>
                  <option value="mosaic">โมเสก (Mosaic)</option>
                </select>
              </PropRow>
              {/* เลือกคน: เก็บ "คนหลัก" ไว้ไม่เบลอ — เฉพาะเป้าหมายใบหน้า */}
              {fcTarget === "face" && (
              <PropRow
                label="ระบุใบหน้าบุคคล"
                changed={keepRefs.length > 0}
                onReset={onClearKeep}
              >
                {keepPicking ? (
                  <span className="dim">ลากครอบหน้าบนจอ…</span>
                ) : (
                  keepRefs.length > 0 && <span className="dim">เก็บไว้ {keepRefs.length} หน้า</span>
                )}
                <button
                  className={`icon-btn tiny text-style-btn ${keepPicking ? "active" : ""}`}
                  disabled={running}
                  title="เลื่อน playhead ไปเฟรมที่เห็นหน้าคนหลักชัดๆ แล้วกดปุ่มนี้ → ลากครอบหน้าคนที่จะเก็บไว้"
                  onClick={() => onPickKeep?.(target)}
                >
                  +
                </button>
              </PropRow>
              )}
              {fcTarget === "face" && keepRefs.length > 0 && (
                <label className="check-row" title="ปกติ = เบลอทุกคน 'ยกเว้น' คนที่เลือก / เปิด = เบลอ 'เฉพาะ' คนที่เลือก">
                  <input type="checkbox" checked={keepInvert} onChange={onToggleKeepInvert} />
                  กลับด้าน: เบลอเฉพาะคนที่เลือก
                </label>
              )}
            </ToolOptions>
            {running && mine && (
              <div className="extract-progress">
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: fcJob.total ? `${Math.min(100, (fcJob.done / fcJob.total) * 100)}%` : "0%" }}
                  />
                </div>
                <span className="dim">{fcJob.done} / {fcJob.total || "?"} เฟรม</span>
                <button className="btn-secondary sm danger" title="หยุดงานนี้ทันที" onClick={() => onCancelJob(fcJob)}>
                  <Ban size={12} /> ยกเลิก
                </button>
              </div>
            )}
            {fcJob?.status === "done" && mine && (
              <div className="extract-result ok">✓ เซ็นเซอร์ใบหน้าเสร็จแล้ว — ก้อนนี้ใช้ไฟล์ใหม่ (ชื่อลงท้าย _facecensor)</div>
            )}
            {fcJob?.status === "error" && mine && (
              <div className="extract-result err">เซ็นเซอร์ใบหน้าไม่สำเร็จ: {fcJob.error}</div>
            )}
          </>
        );
      })()}
      {/* ลบ Censor / วัตถุ (AI Inpaint) — โชว์เฉพาะเมื่อติดตั้ง engine แล้ว */}
      {inpEngines.length > 0 && (() => {
        const target = clip;
        const running = inpJob?.status === "working";
        const mine = inpJob && target && inpJob.clipId === target.id;
        const handleClick = () => {
          if (inpEngines.length === 0) {
            if (window.confirm("ยังไม่ได้ติดตั้ง AI Engine สำหรับลบวัตถุ/เซ็นเซอร์\nเปิดหน้าตั้งค่าเพื่อติดตั้งเลยไหม?")) {
              onOpenEngines();
            }
            return;
          }
          if (!target) {
            window.alert("คลิกเลือกก้อนวิดีโอบน timeline ก่อน");
            return;
          }
          onInpaintStart(target); // เข้าโหมดวาดกรอบบนจอ Program — ปล่อยเมาส์แล้วเริ่มงานทันที
        };
        return (
          <>
            <ToolOptions
              badge={inpEngines.length > 1 && inpEngineId !== inpEngines[0].id ? "โมเดล" : null}
              main={
                <button className="btn-secondary" disabled={running || inpDrawing} onClick={handleClick}>
                  {running && mine ? (
                    <>
                      <Loader2 size={13} className="spin" /> กำลังลบ + เติมพื้นหลัง…
                    </>
                  ) : inpDrawing ? (
                    "ลากกรอบบนจอ Program…"
                  ) : (
                    "ลบวัตถุออกจากวิดีโอ (AI)"
                  )}
                </button>
              }
            >
              <PropRow
                label="Model"
                changed={inpEngines.length > 1 && inpEngineId !== inpEngines[0].id}
                onReset={() => onSelectInpEngine(inpEngines[0]?.id)}
              >
                <select
                  className="prop-select"
                  value={inpEngineId ?? ""}
                  disabled={running || inpEngines.length < 2}
                  onChange={(e) => onSelectInpEngine(e.target.value)}
                >
                  {inpEngines.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </PropRow>
            </ToolOptions>
            {inpDrawing && (
              <div className="prop-note dim">ลากกรอบครอบสิ่งที่ต้องการลบบนจอ Program — Esc ยกเลิก</div>
            )}
            {running && mine && (
              <div className="extract-progress">
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{
                      width: inpJob.total ? `${Math.min(100, (inpJob.done / inpJob.total) * 100)}%` : "0%",
                    }}
                  />
                </div>
                <span className="dim">
                  {inpJob.done} / {inpJob.total || "?"} เฟรม
                </span>
                <button
                  className="btn-secondary sm danger"
                  title="หยุดงานนี้ทันที (ก้อนเดิมไม่ถูกแก้)"
                  onClick={() => onCancelJob(inpJob)}
                >
                  <Ban size={12} /> ยกเลิก
                </button>
              </div>
            )}
            {inpJob?.status === "done" && mine && (
              <div className="extract-result ok">✓ ลบวัตถุเสร็จแล้ว — ก้อนนี้ใช้ไฟล์ใหม่ (ชื่อลงท้าย _clean) ลบจุดอื่นต่อได้เลย</div>
            )}
            {inpJob?.status === "error" && mine && (
              <div className="extract-result err">ลบวัตถุไม่สำเร็จ: {inpJob.error}</div>
            )}
          </>
        );
      })()}
      {/* สลับหน้า (Face Swap) — โชว์เฉพาะเมื่อติดตั้ง engine แล้ว */}
      {swapReady && (() => {
        const target = clip;
        const running = swapJob?.status === "working";
        const mine = swapJob && target && swapJob.clipId === target.id;
        const rows = swapMaps.filter((m) => m.source);
        const multi = rows.length > 1; // หลายหน้า = ต้องชี้ว่ารูปไหนไปคนไหน
        const imgOf = (path) => swapImages.find((m) => m.path === path) || null;
        const handleClick = () => {
          if (!target) {
            window.alert("คลิกเลือกก้อนวิดีโอบน timeline ก่อน");
            return;
          }
          if (rows.length === 0) {
            window.alert(
              "ยังไม่ได้เลือกรูปหน้าต้นแบบ\n1) เอารูปหน้าตรงชัดๆ เข้าแท็บ Media Browser (มุมซ้ายล่าง)\n2) เปิดตัวเลือก (เฟือง) ของปุ่มนี้ แล้วเลือกรูป"
            );
            return;
          }
          // หลายหน้าแต่ยังไม่ได้ชี้คน → เตือน (ไม่งั้นจะสลับมั่ว)
          if (multi && rows.some((m) => !m.ref)) {
            if (!window.confirm(
              "มีหลายรูปแต่บางรูปยังไม่ได้ชี้ว่าไปคนไหน\nรูปที่ไม่ได้ชี้จะถูกใช้กับ 'คนที่เหลือ' ทั้งหมด — ทำต่อไหม?"
            )) return;
          }
          if (window.confirm(`สลับหน้าในก้อนนี้ (${rows.length} หน้า)?\nใช้กับงานของตัวเอง/มีมส่วนตัวเท่านั้น (ต้นฉบับไม่ถูกแตะ)`)) {
            onFaceSwap(target);
          }
        };
        return (
          <>
            <ToolOptions
              badge={rows.length ? `${rows.length} หน้า` + (!swapEnhance ? " · ไม่เก็บคม" : "") : null}
              main={
                <button className="btn-secondary" disabled={running} onClick={handleClick}>
                  {running && mine ? (
                    <>
                      <Loader2 size={13} className="spin" /> กำลังสลับหน้า…
                    </>
                  ) : (
                    "สลับหน้า (Face Swap)"
                  )}
                </button>
              }
            >
              {swapEngines.length > 1 && (
                <PropRow
                  label="Model"
                  changed={swapEngineId !== swapEngines[0].id}
                  onReset={() => onSelectSwapEngine(swapEngines[0].id)}
                >
                  <select
                    className="prop-select"
                    value={swapEngineId ?? ""}
                    disabled={running}
                    onChange={(e) => onSelectSwapEngine(e.target.value)}
                  >
                    {swapEngines.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </PropRow>
              )}
              {swapEngineId === "face-swap-facefusion" && swapMaps.filter((m) => m.source).length > 1 && (
                <div className="prop-note dim">FaceFusion ใช้รูปแรกสลับทุกคน — โหมดหลายคนแยกใช้ Model “InsightFace”</div>
              )}
              {swapImages.length === 0 ? (
                <span className="dim">เอารูปหน้าเข้า Media Browser ก่อน (มุมซ้ายล่าง)</span>
              ) : (
                <>
                  <div className="swap-map-list">
                    {swapMaps.map((m, i) => {
                      const img = imgOf(m.source);
                      const picking = swapPickIndex === i;
                      return (
                        <div className="swap-map-row" key={i}>
                          {img ? (
                            <img className="swap-map-thumb" src={img.url} alt="" />
                          ) : (
                            <div className="swap-map-thumb empty" />
                          )}
                          <div className="swap-map-mid">
                            <select
                              className="prop-select"
                              value={m.source ?? ""}
                              disabled={running}
                              onChange={(e) => onSetSwapMapSource(i, e.target.value || null)}
                            >
                              <option value="">— เลือกรูปหน้า —</option>
                              {swapImages.map((im) => (
                                <option key={im.path} value={im.path}>
                                  {im.name}
                                </option>
                              ))}
                            </select>
                            {/* ชี้คนบนจอ — จำเป็นเมื่อมีหลายหน้า, ตัวเดียวเว้นไว้ = ทุกคน */}
                            <button
                              className={`btn-secondary sm ${picking ? "warn" : ""}`}
                              disabled={running || !m.source}
                              title="เลื่อน playhead ไปเฟรมที่เห็นคนนั้นชัดๆ แล้วกด → ลากครอบหน้าคนที่จะสลับเป็นรูปนี้"
                              onClick={() => (m.ref ? onClearSwapMapRef(i) : onPickSwapTarget(i))}
                            >
                              {picking ? "ลากบนจอ…" : m.ref ? "✓ ชี้คนแล้ว (ล้าง)" : "→ ชี้คนบนจอ"}
                            </button>
                          </div>
                          {swapMaps.length > 1 && (
                            <button
                              className="icon-btn tiny"
                              disabled={running}
                              title="ลบแถวนี้"
                              onClick={() => onRemoveSwapMap(i)}
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button className="btn-secondary sm" disabled={running} onClick={onAddSwapMap}>
                    + เพิ่มหน้า (สำหรับมีมหลายคน)
                  </button>
                </>
              )}
              <label className="check-row" title="GFPGAN เก็บรายละเอียดหน้าให้คม — ปิดแล้วเร็วขึ้นมากแต่หน้าเบลอกว่า">
                <input type="checkbox" checked={swapEnhance} onChange={onToggleSwapEnhance} />
                เก็บหน้าคม (GFPGAN) — ช้าขึ้นแต่ชัดกว่า
              </label>
            </ToolOptions>
            {running && mine && (
              <div className="extract-progress">
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{
                      width: swapJob.total ? `${Math.min(100, (swapJob.done / swapJob.total) * 100)}%` : "0%",
                    }}
                  />
                </div>
                <span className="dim">
                  {swapJob.done} / {swapJob.total || "?"} เฟรม
                </span>
                <button
                  className="btn-secondary sm danger"
                  title="หยุดงานนี้ทันที (ก้อนเดิมไม่ถูกแก้)"
                  onClick={() => onCancelJob(swapJob)}
                >
                  <Ban size={12} /> ยกเลิก
                </button>
              </div>
            )}
            {swapJob?.status === "done" && mine && (
              <div className="extract-result ok">✓ สลับหน้าเสร็จแล้ว — ก้อนนี้ใช้ไฟล์ใหม่ (ชื่อลงท้าย _swap)</div>
            )}
            {swapJob?.status === "error" && mine && (
              <div className="extract-result err">สลับหน้าไม่สำเร็จ: {swapJob.error}</div>
            )}
          </>
        );
      })()}
      {/* ชี้เป้า / ตามวัตถุ (Object Tracking) — โชว์เฉพาะเมื่อติดตั้ง engine แล้ว */}
      {trkEngines.length > 0 && (() => {
        const target = clip;
        const running = trkJob?.status === "working";
        const mine = trkJob && target && trkJob.clipId === target.id;
        const handleClick = () => {
          if (trkEngines.length === 0) {
            if (window.confirm("ยังไม่ได้ติดตั้ง AI ชี้เป้า/ตามวัตถุ\nเปิดหน้าตั้งค่าเพื่อติดตั้งเลยไหม?")) {
              onOpenEngines();
            }
            return;
          }
          if (!target) {
            window.alert("คลิกเลือกก้อนวิดีโอบน timeline ก่อน");
            return;
          }
          onTrackStart?.(target); // เข้าโหมดตีกรอบเป้าบนจอ Program — ปล่อยเมาส์แล้วเริ่มงานทันที
        };
        return (
          <>
            <ToolOptions
              badge={
                trkStyle !== "circle"
                  ? trkStyle === "arrow"
                    ? "ลูกศร"
                    : "กรอบ"
                  : null
              }
              main={
                <button className="btn-secondary" disabled={running || trkDrawing} onClick={handleClick}>
                  {running && mine ? (
                    <>
                      <Loader2 size={13} className="spin" /> กำลังตามเป้า…
                    </>
                  ) : trkDrawing ? (
                    "ตีกรอบเป้าบนจอ Program…"
                  ) : (
                    "ชี้เป้า / ตามวัตถุ (Track)"
                  )}
                </button>
              }
            >
              <PropRow
                label="Model"
                changed={trkEngines.length > 1 && trkEngineId !== trkEngines[0].id}
                onReset={() => onSelectTrkEngine(trkEngines[0]?.id)}
              >
                <select
                  className="prop-select"
                  value={trkEngineId ?? ""}
                  disabled={running || trkEngines.length < 2}
                  onChange={(e) => onSelectTrkEngine(e.target.value)}
                >
                  {trkEngines.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </PropRow>
              <PropRow
                label="สัญลักษณ์"
                changed={trkStyle !== "circle"}
                onReset={() => onSelectTrkStyle("circle")}
              >
                <select
                  className="prop-select"
                  value={trkStyle}
                  disabled={running}
                  onChange={(e) => onSelectTrkStyle(e.target.value)}
                >
                  <option value="circle">วงกลมใต้เป้า (กีฬา)</option>
                  <option value="arrow">ลูกศรชี้เหนือหัว</option>
                  <option value="box">กรอบล็อคเป้า</option>
                </select>
              </PropRow>
            </ToolOptions>
            {trkDrawing && (
              <div className="prop-note dim">
                เลื่อน playhead ไปเฟรมที่เห็นเป้าชัด แล้วตีกรอบครอบเป้าบนจอ Program — Esc ยกเลิก
              </div>
            )}
            {running && mine && (
              <div className="extract-progress">
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{
                      width: trkJob.total ? `${Math.min(100, (trkJob.done / trkJob.total) * 100)}%` : "0%",
                    }}
                  />
                </div>
                <span className="dim">
                  {trkJob.done} / {trkJob.total || "?"} เฟรม
                </span>
                <button
                  className="btn-secondary sm danger"
                  title="หยุดงานนี้ทันที (ก้อนเดิมไม่ถูกแก้)"
                  onClick={() => onCancelJob(trkJob)}
                >
                  <Ban size={12} /> ยกเลิก
                </button>
              </div>
            )}
            {trkJob?.status === "done" && mine && (
              <div className="extract-result ok">✓ ชี้เป้าเสร็จแล้ว — ก้อนนี้ใช้ไฟล์ใหม่ (ชื่อลงท้าย _track)</div>
            )}
            {trkJob?.status === "error" && mine && (
              <div className="extract-result err">ชี้เป้าไม่สำเร็จ: {trkJob.error}</div>
            )}
          </>
        );
      })()}
      <button className="btn-secondary" onClick={onExtract} disabled={extract?.status === "working"}>
        {extract?.status === "working" ? (
          <>
            <Loader2 size={13} className="spin" /> กำลังแตกเฟรม…
          </>
        ) : (
          "แตกเฟรม (Extract Frames)"
        )}
      </button>

      {extract?.status === "working" && (
        <div className="extract-progress">
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{
                width: extract.total
                  ? `${Math.min(100, (extract.done / extract.total) * 100)}%`
                  : "0%",
              }}
            />
          </div>
          <span className="dim">
            {extract.total
              ? `${extract.done.toLocaleString()} / ${extract.total.toLocaleString()} เฟรม (${Math.min(100, Math.round((extract.done / extract.total) * 100))}%)`
              : `${(extract.done ?? 0).toLocaleString()} เฟรม…`}
          </span>
          <button
            className="btn-secondary sm danger"
            title="หยุดแตกเฟรมทันที"
            disabled={extract.cancel}
            onClick={() => onCancelJob(extract)}
          >
            <Ban size={12} /> {extract.cancel ? "กำลังหยุด…" : "ยกเลิก"}
          </button>
        </div>
      )}

      {extract?.status === "done" && (
        <>
          <div className="extract-result ok">✓ ได้ {extract.frame_count} เฟรม</div>
          <div className="frame-grid">
            {sampleFrames(extract).map(({ n, url }) => (
              <div className="frame-thumb" key={n} title={`frame ${n}`}>
                <img src={url} alt={`frame ${n}`} loading="lazy" />
                <span>#{n}</span>
              </div>
            ))}
          </div>
          <button className="btn-secondary" onClick={onOpenFrames}>
            ดู/แก้เฟรม (แทนที่ด้วยรูปได้)
          </button>
          <button
            className="btn-secondary"
            onClick={() => window.aiclip?.openFolder?.(extract.frames_dir)}
          >
            เปิดโฟลเดอร์เฟรมทั้งหมด
          </button>
        </>
      )}
      {extract?.status === "error" && (
        <div className="extract-result err">
          แตกเฟรมไม่สำเร็จ: {extract.error}
          <br />
          <span className="dim">เช็คว่า backend รันอยู่ (uvicorn) และติดตั้ง ffmpeg แล้ว</span>
        </div>
      )}
      </>
      )}
    </div>
  );
}
