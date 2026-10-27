import React, { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, PenTool, RotateCcw, ScanLine, Trash2, X } from "lucide-react";
import "./mask-controls.css";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

// Short clips retain all three animation phases instead of silently cutting off the return.
export function maskControlSettings(transform = {}, duration = 0) {
  const saved = transform.maskFx || {};
  const length = Math.max(0, finite(duration, 0));
  const start = clamp(finite(saved.start, 0), 0, length);
  let enter = Math.max(0, finite(saved.enter, .4));
  let hold = Math.max(0, finite(saved.hold, .8));
  let exit = Math.max(0, finite(saved.exit, .4));
  const total = enter + hold + exit;
  if (total > length - start && total > 0) {
    const ratio = (length - start) / total;
    enter *= ratio;
    hold *= ratio;
    exit *= ratio;
  }
  return {
    ...saved,
    enabled: saved.enabled !== false,
    scale: clamp(finite(saved.scale, 160), 100, 400),
    feather: clamp(finite(saved.feather, 0), 0, .05),
    start, enter, hold, exit,
    bounce: clamp(finite(saved.bounce, .2), 0, 1),
    trackingEnabled: saved.trackingEnabled !== false,
  };
}

function NumberField({ label, value, min = 0, max = 100, step = 1, unit, onChange, disabled = false, slider = false }) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(3))));
  const discardOnBlur = useRef(false);
  useEffect(() => setDraft(String(Number(value.toFixed(3)))), [value]);
  const commit = () => {
    if (discardOnBlur.current) { discardOnBlur.current = false; return; }
    const parsed = Number(draft);
    if (draft.trim() && Number.isFinite(parsed)) {
      const next = clamp(parsed, min, max);
      setDraft(String(Number(next.toFixed(3))));
      onChange(next);
    }
    else setDraft(String(Number(value.toFixed(3))));
  };
  return (
    <label className={`mask-fx-field${slider ? " has-slider" : ""}`}>
      <span>{label}</span>
      <span className="mask-fx-number">
        <input type="number" value={draft} min={min} max={max} step={step} disabled={disabled}
          onChange={(event) => setDraft(event.target.value)} onBlur={commit}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") { discardOnBlur.current = true; setDraft(String(Number(value.toFixed(3)))); event.currentTarget.blur(); }
          }} />
        {unit && <small>{unit}</small>}
      </span>
      {slider && <input type="range" aria-label={label} value={value} min={min} max={max} step={step}
        disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />}
    </label>
  );
}

export default function MaskFxControls({ clip, onUpdate, onEditMask, onRedrawMask, onDeleteMask, onTrackMask,
  onCancelMaskTrack, maskTrackJob, maskToolActive = false }) {
  const transform = clip.transform || {};
  const points = (transform.fxMaskPath || []).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  const hasMask = points.length >= 3;
  const fx = maskControlSettings(transform, clip.duration);
  const job = maskTrackJob?.clipId === clip.id ? maskTrackJob : null;
  const busy = job?.status === "working" || job?.status === "running";
  const disabled = !!clip.locked || busy;
  const setTransform = (values) => onUpdate(clip.id, { transform: { ...transform, ...values } });
  const setFx = (values) => setTransform({ maskFx: { ...fx, ...values } });
  const bounds = hasMask ? {
    x: (Math.min(...points.map((point) => point.x)) + Math.max(...points.map((point) => point.x))) / 2,
    y: (Math.min(...points.map((point) => point.y)) + Math.max(...points.map((point) => point.y))) / 2,
  } : { x: .5, y: .5 };
  const center = fx.center || bounds;
  const duration = Math.max(0, finite(clip.duration, 0));
  const phaseTotal = fx.enter + fx.hold + fx.exit;
  const timeMax = (key) => Math.max(0, duration - fx.start - phaseTotal + fx[key]);
  const end = fx.start + phaseTotal;
  const progress = job?.total > 0 ? clamp(job.done / job.total * 100, 0, 100) : null;
  const trackedCount = Array.isArray(transform.fxMaskTrack) ? transform.fxMaskTrack.length : 0;
  const showGuide = transform.fxMaskShowGuide !== false;

  if (!hasMask) return (
    <div className="mask-fx-controls mask-fx-empty">
      <p>วาดเส้นครอบหัว คน หรือวัตถุ แล้วขยายเฉพาะพื้นที่ที่เลือก</p>
      <button type="button" className="mask-fx-button primary" disabled={disabled || !onRedrawMask}
        onClick={() => onRedrawMask(clip)}><PenTool size={13} /> {maskToolActive ? "กำลังวาดบน Program" : "วาด Mask บน Program"}</button>
      {maskToolActive && <p className="mask-fx-note">ลากเส้นให้ล้อมพื้นที่แล้วปล่อยเมาส์ · เปลี่ยนเครื่องมือหรือกด Esc เพื่อออก</p>}
    </div>
  );

  return (
    <div className="mask-fx-controls">
      <div className="mask-fx-actions">
        <button type="button" className={`mask-fx-button${maskToolActive ? " active" : ""}`} disabled={disabled || !onEditMask}
          onClick={() => onEditMask(clip)}><PenTool size={12} /> แก้เส้น</button>
        <button type="button" className="mask-fx-button" disabled={disabled || !onRedrawMask}
          onClick={() => onRedrawMask(clip)}><RotateCcw size={12} /> วาดใหม่</button>
        <button type="button" className="mask-fx-button icon" aria-label={showGuide ? "ซ่อนเส้น Mask" : "แสดงเส้น Mask"}
          title={showGuide ? "ซ่อนเส้น Mask" : "แสดงเส้น Mask"} disabled={!!clip.locked}
          onClick={() => setTransform({ fxMaskShowGuide: !showGuide })}>{showGuide ? <Eye size={13} /> : <EyeOff size={13} />}</button>
        <button type="button" className="mask-fx-button icon danger" aria-label="ลบ Mask และเอฟเฟกต์ขยาย"
          title="ลบ Mask และเอฟเฟกต์ขยาย" disabled={disabled || !onDeleteMask} onClick={() => onDeleteMask(clip)}><Trash2 size={13} /></button>
      </div>
      {maskToolActive && <p className="mask-fx-note active-note">ลากจุดเพื่อแก้เส้น · ดับเบิลคลิกเส้นเพื่อเพิ่มจุด · เลือกจุดแล้วกด Delete เพื่อลบจุด</p>}
      <div className="mask-fx-subhead">
        <span>ขยายเฉพาะพื้นที่</span>
        <label className="mask-fx-toggle"><input type="checkbox" checked={fx.enabled} disabled={disabled}
          onChange={(event) => setFx({ enabled: event.target.checked })} /> เปิดเอฟเฟกต์</label>
      </div>
      <NumberField label="ขนาดสูงสุด" value={fx.scale} min={100} max={400} unit="%" slider disabled={disabled}
        onChange={(scale) => setFx({ scale })} />
      <div className="mask-fx-center">
        <NumberField label="ศูนย์กลาง X" value={clamp(finite(center.x, bounds.x), 0, 1) * 100} step={.1} unit="%" disabled={disabled}
          onChange={(x) => setFx({ center: { ...center, x: x / 100 } })} />
        <NumberField label="ศูนย์กลาง Y" value={clamp(finite(center.y, bounds.y), 0, 1) * 100} step={.1} unit="%" disabled={disabled}
          onChange={(y) => setFx({ center: { ...center, y: y / 100 } })} />
      </div>
      <button type="button" className="mask-fx-text-button" disabled={disabled || !fx.center}
        onClick={() => setFx({ center: null })}><RotateCcw size={11} /> ใช้กึ่งกลาง Mask</button>
      <NumberField label="ขอบนุ่ม" value={fx.feather * 100} max={5} step={.1} unit="%" slider disabled={disabled}
        onChange={(feather) => setFx({ feather: feather / 100 })} />
      <div className="mask-fx-subhead"><span>จังหวะขยาย</span><small>เวลาจากต้นคลิป</small></div>
      <div className="mask-fx-timing-strip" aria-label={`เริ่ม ${fx.start.toFixed(2)} วินาที จบ ${end.toFixed(2)} วินาที`}>
        <span className="wait" style={{ flexGrow: fx.start }} />
        <span className="enter" style={{ flexGrow: fx.enter }} title="ขยาย" />
        <span className="hold" style={{ flexGrow: fx.hold }} title="ค้าง" />
        <span className="exit" style={{ flexGrow: fx.exit }} title="หดกลับ" />
        <span className="wait" style={{ flexGrow: Math.max(0, duration - end) }} />
      </div>
      <NumberField label="เวลาเริ่ม" value={fx.start} max={Math.max(0, duration - phaseTotal)} step={.05} unit="s" disabled={disabled}
        onChange={(start) => setFx({ start })} />
      <NumberField label="ขยายเข้า" value={fx.enter} max={timeMax("enter")} step={.05} unit="s" disabled={disabled}
        onChange={(enter) => setFx({ enter })} />
      <NumberField label="ค้าง" value={fx.hold} max={timeMax("hold")} step={.05} unit="s" disabled={disabled}
        onChange={(hold) => setFx({ hold })} />
      <NumberField label="หดกลับ" value={fx.exit} max={timeMax("exit")} step={.05} unit="s" disabled={disabled}
        onChange={(exit) => setFx({ exit })} />
      <NumberField label="ความเด้ง" value={fx.bounce * 100} unit="%" slider disabled={disabled}
        onChange={(bounce) => setFx({ bounce: bounce / 100 })} />
      <p className="mask-fx-note">สิ้นสุด {end.toFixed(2)} / {duration.toFixed(2)} s · ขอบเขตเวลาอยู่ภายในคลิป</p>
      {clip.type !== "image" && <>
        <div className="mask-fx-subhead">
          <span>ติดตามการเคลื่อนไหว</span>
          <label className="mask-fx-toggle"><input type="checkbox" checked={fx.trackingEnabled} disabled={disabled}
            onChange={(event) => setFx({ trackingEnabled: event.target.checked })} /> ใช้ Tracking</label>
        </div>
        <p className="mask-fx-note">ติดตามตำแหน่งและขนาดของ Mask แบบคร่าว ๆ หากหลุดให้หยุดที่เฟรมนั้น แก้เส้นแล้วติดตามใหม่</p>
        <button type="button" className="mask-fx-button mask-fx-track" disabled={disabled || !onTrackMask}
          onClick={() => onTrackMask(clip)}><ScanLine size={13} /> {trackedCount ? "ติดตามใหม่ทั้งคลิป" : "ติดตามทั้งคลิป"}</button>
        <p className="mask-fx-note">คำนวณไปหน้าและย้อนกลับจากเฟรมที่วาด{trackedCount > 0 ? ` · บันทึกแล้ว ${trackedCount} จุดเวลา` : ""}</p>
        {busy && <div className="mask-fx-job" role="status">
          <span>กำลังติดตาม{progress !== null ? ` ${Math.round(progress)}%` : "…"}</span>
          <progress max="100" {...(progress === null ? {} : { value: progress })} />
          <button type="button" className="mask-fx-button" onClick={() => onCancelMaskTrack?.(clip)} disabled={!onCancelMaskTrack}><X size={12} /> ยกเลิก</button>
        </div>}
        {job?.status === "error" && <p role="alert" className="mask-fx-error">ติดตามไม่สำเร็จ: {job.error || "อ่านเฟรมวิดีโอไม่ได้ ลองใหม่อีกครั้ง"}</p>}
        {job?.status === "cancelled" && <p className="mask-fx-note" role="status">ยกเลิกการติดตามแล้ว</p>}
        {job?.status === "done" && <p className={job.lostFrames > 0 ? "mask-fx-warning" : "mask-fx-success"} role="status">
          {job.lostFrames > 0
            ? `ติดตามเสร็จแล้ว · ${job.lostFrames} เฟรมต้องตรวจแก้ เพราะตามวัตถุไม่ชัดเจน`
            : "ติดตามเสร็จแล้ว · ลองเล่นเพื่อตรวจเส้น Mask"}
        </p>}
      </>}
      {clip.locked && <p className="mask-fx-note">ปลดล็อกคลิปเพื่อแก้ Mask และเอฟเฟกต์</p>}
    </div>
  );
}
