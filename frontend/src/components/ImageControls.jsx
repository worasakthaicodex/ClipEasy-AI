import React from "react";
import avatarPreview from "../assets/image-controls-avatar.png";

const SHAPES = [
  { id: "none", label: "รูปปกติ" },
  { id: "circle", label: "วงกลม" },
];

export default function ImageControls({ clip, onUpdate }) {
  const [query, setQuery] = React.useState("");
  const isImage = clip?.type === "image";
  const tf = (isImage && clip.transform) || {};
  const current = tf.shape || "none";

  const shown = SHAPES.filter((shape) => shape.label.includes(query.trim()));
  return (
    <div className="anim-panel split image-controls-panel">
      <div className="anim-sidebar">
        <button className="anim-side-item active">Basic<span className="anim-side-dot" /></button>
      </div>
      <div className="anim-content">
        <input className="anim-search" type="search" placeholder="ค้นหาเอฟเฟค..." value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="anim-group-title">BASIC</div>
        <div className="anim-grid image-controls-grid">
          {shown.map((shape) => (
            <button
              key={shape.id}
              className={`anim-card ${isImage && current === shape.id ? "selected" : ""}`}
              disabled={!isImage}
              onClick={() => onUpdate?.(clip.id, { transform: { ...tf, shape: shape.id } })}
            >
              <span className="anim-thumb image-shape-thumb">
                <img
                  src={avatarPreview}
                  alt=""
                  className={shape.id === "circle" ? "avatar-preview circle" : "avatar-preview"}
                />
                {isImage && current === shape.id && <span className="anim-check">✓</span>}
              </span>
              <span className="anim-card-label">{shape.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
