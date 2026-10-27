import React, { useEffect, useState } from "react";
import { Search, Video, FilePlus2 } from "lucide-react";

/** เนื้อหาแท็บ Project: ปุ่ม import + รายการคลิปที่นำเข้ามาแล้ว
 *  ดับเบิลคลิกเปิด, ลากไปวางบน Timeline/จอ Program, คลิกขวา → นำออก */
export default function ProjectPanel({ clips, activeClip, onImport, onOpenClip, onDeleteClip }) {
  // เมนูคลิกขวา: {x, y, clip} | null
  const [menu, setMenu] = useState(null);

  // คลิกที่อื่น / กด Esc → ปิดเมนู
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e) => e.key === "Escape" && close();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  return (
    <div className="project-body">
      <div className="project-searchbar">
        <div className="search-input">
          <Search size={13} />
          <input placeholder="ค้นหาไฟล์ในโปรเจกต์…" />
        </div>
        <button className="btn-import" onClick={onImport}>
          <FilePlus2 size={13} />
          Import
        </button>
      </div>

      <div className="bin-columns">
        <span className="col-name">Name</span>
        <span>{clips.length} items</span>
      </div>

      <div className="bin-list">
        {clips.length === 0 && (
          <div className="bin-empty">ยังไม่มีไฟล์ — กด Import เพื่อเลือกวิดีโอ</div>
        )}
        {clips.map((clip) => (
          <div
            className={`bin-item ${activeClip?.path === clip.path ? "selected" : ""}`}
            key={clip.path}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/x-clip-path", clip.path);
              e.dataTransfer.effectAllowed = "copy";
            }}
            onDoubleClick={() => onOpenClip(clip)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, clip });
            }}
            title="ดับเบิลคลิกเพื่อเปิด หรือลากไปวางบน Timeline"
          >
            <Video size={14} />
            <span className="bin-item-name">{clip.name}</span>
          </div>
        ))}
      </div>

      {menu && (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="context-menu-item"
            onClick={() => {
              onDeleteClip(menu.clip);
              setMenu(null);
            }}
          >
            นำออก
          </button>
        </div>
      )}
    </div>
  );
}
