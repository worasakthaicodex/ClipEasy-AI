import React from "react";
import { MousePointer2, BoxSelect, Hand, Paintbrush, ListChecks, PenTool } from "lucide-react";

// เฉพาะ "โหมดเครื่องมือ" (เลือกแล้วค้าง) — ปุ่มสั่งงานทันที (แบ่งฉาก/ข้อความ)
// ย้ายไปอยู่ฝั่งขวาของ toolbar บน timeline เพราะทำงานคนละแบบกัน
const TOOLS = [
  { icon: MousePointer2, name: "Selection (V)", key: "select" },
  {
    icon: ListChecks,
    name: "เลือกหลายท่อน (M) — คลิกทีละก้อนเพื่อติดเลือกสะสม (คลิกซ้ำ = ปลด) แล้วคลิกขวาเพื่อรวมท่อน",
    key: "multi",
  },
  { icon: BoxSelect, name: "เลือกโซน (C) — ลากคลุมช่วง แล้วคลิกขวาเพื่อตัด/ลบ", key: "razor" },
  { icon: Hand, name: "Hand (H)", key: "hand" },
  {
    icon: Paintbrush,
    name: "ก็อปสไตล์ข้อความ — คลิกก้อน text ที่จะดูดสไตล์ แล้วคลิกก้อนอื่นเพื่อทับ (คลิกขวา = ดูดแบบใหม่)",
    key: "copystyle",
  },
  {
    icon: PenTool,
    name: "วาด Mask (G) — เลือกคลิปวิดีโอ แล้วลากครอบตัวคนหรือวัตถุบนจอ Program",
    key: "mask",
  },
];

/** แถบเครื่องมือแนวตั้งข้าง timeline — เครื่องมือที่เลือกส่งขึ้นไปให้ App */
export default function ToolsPanel({ tool = "select", onSelectTool }) {
  return (
    <div className="tools-panel">
      {TOOLS.map(({ icon: Icon, name, key }) => (
        <button
          key={key}
          className={`icon-btn tool-btn ${tool === key ? "active" : ""}`}
          title={name}
          onClick={() => onSelectTool?.(tool === key && key !== "select" ? "select" : key)}
        >
          <Icon size={15} />
        </button>
      ))}
    </div>
  );
}
