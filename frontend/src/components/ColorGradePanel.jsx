import React from "react";
import { COLOR_GRADES, colorGradeFilter } from "./looks";
import gradePreview from "../assets/color-grade-neutral-v1.png";

export default function ColorGradePanel({ clip, onUpdate, embedded = false }) {
  const isVideo = clip && !["text", "layout", "audio", "scene", "image"].includes(clip.type);
  const tf = (isVideo && clip.transform) || {};
  const selected = tf.colorGrade || "none";
  const update = (patch) => isVideo && onUpdate(clip.id, { transform: { ...tf, ...patch } });
  return <div className={`color-grade-panel ${embedded ? "embedded" : ""}`}>
    {!embedded && <header><b>ปรับสี</b><span>{isVideo ? "Color Grading Presets" : "เลือกวิดีโอบน Timeline ก่อน"}</span></header>}
    <div className="color-grade-grid">
      {COLOR_GRADES.map((grade) => <button key={grade.id} className={`color-grade-card ${selected === grade.id ? "selected" : ""}`} disabled={!isVideo} onClick={() => update({ colorGrade: selected === grade.id ? "none" : grade.id })}>
        <i><img src={gradePreview} alt="" style={{ filter: colorGradeFilter(grade.id, 100) }} /><span /></i>
        <small>{grade.label}</small>{selected === grade.id && <strong>✓</strong>}
      </button>)}
    </div>
  </div>;
}
