import React from "react";
import { Trash2, Bookmark } from "lucide-react";
import { effectStyle } from "./TextEffects";

/** แท็บ Templates — คลังสไตล์ข้อความที่บันทึกไว้
 *  • ลากก้อน text (ที่จับ ★) จาก timeline มาปล่อยที่นี่ = บันทึกสไตล์+ตำแหน่ง+ขนาดเป็นเทมเพลต
 *  • ลากการ์ดเทมเพลตออกไปที่ timeline = สร้างก้อนใหม่ / ปล่อยทับก้อน text เดิม = เปลี่ยนสไตล์ก้อนนั้น */
export default function TemplatesPanel({ templates = [], onSave, onDelete }) {
  const [over, setOver] = React.useState(false);

  // การ์ดที่ลากจากแผงนี้เองติดป้าย x-from-templates ไว้ — ปล่อยกลับลงแผงต้องไม่บันทึกซ้ำ
  const fromSelf = (e) => e.dataTransfer.types.includes("application/x-from-templates");

  const handleDrop = (e) => {
    setOver(false);
    if (fromSelf(e)) return; // ลากการ์ดตัวเองมาวางที่เดิม = ไม่ทำอะไร
    const tpl = e.dataTransfer.getData("application/x-text-template");
    if (tpl) {
      e.preventDefault();
      try {
        onSave?.(JSON.parse(tpl));
      } catch {}
    }
  };

  return (
    <div
      className={`templates-panel ${over ? "drag-over" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-text-template") && !fromSelf(e)) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
    >
      <div className="tpl-hint">
        <Bookmark size={13} /> ลากก้อนข้อความ (ที่จับ ★) มาวางที่นี่เพื่อบันทึกเป็นเทมเพลต
      </div>

      {templates.length === 0 ? (
        <div className="tpl-empty">ยังไม่มีเทมเพลต — แต่งข้อความให้สวยแล้วลากมาเก็บไว้ใช้ซ้ำได้</div>
      ) : (
        <div className="tpl-grid">
          {templates.map((t) => {
            const st = t.style || {};
            return (
              <div
                key={t.id}
                className="tpl-card"
                draggable
                title="ลากไปวางบน timeline = สร้างก้อนใหม่ / วางทับก้อนข้อความเดิม = เปลี่ยนสไตล์ก้อนนั้น"
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "copy";
                  e.dataTransfer.setData("application/x-text-template", JSON.stringify(t));
                  // ป้ายบอกว่ามาจากแผงเทมเพลตเอง — กันปล่อยกลับลงแผงแล้วบันทึกซ้ำ
                  e.dataTransfer.setData("application/x-from-templates", "1");
                }}
              >
                <div className="tpl-preview">
                  <span
                    style={{
                      color: st.color || "#fff",
                      fontWeight: st.bold ? 800 : 500,
                      fontStyle: st.italic ? "italic" : undefined,
                      WebkitTextStroke: st.stroke ? `0.6px ${st.stroke}` : undefined,
                      ...(st.effect ? effectStyle(st.effect, 16) : {}),
                    }}
                  >
                    {(t.text || "ข้อความ").slice(0, 10)}
                  </span>
                </div>
                <div className="tpl-name" title={t.text}>
                  {t.name || t.text || "เทมเพลต"}
                </div>
                <button
                  className="tpl-del"
                  title="ลบเทมเพลตนี้"
                  onClick={() => onDelete?.(t.id)}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
