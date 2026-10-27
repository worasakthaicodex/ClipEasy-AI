import React, { useEffect, useState } from "react";
import { Search, FilePlus2, Music, Image as ImageIcon } from "lucide-react";

/** Media Browser: รูปภาพ + ไฟล์เสียงจากข้างนอก — ลากลง timeline ไปใช้ได้เลย
 *  (รูปวางบน V2/V3 เป็นภาพซ้อน, เสียงวางเป็นก้อนเสียงบนเลนนั้น) */
export default function MediaBrowser({ items, onImport, onDelete }) {
  // เมนูคลิกขวา: {x, y, item} | null
  const [menu, setMenu] = useState(null);

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
          <input placeholder="รูปภาพ / เสียง…" />
        </div>
        <button className="btn-import" onClick={onImport}>
          <FilePlus2 size={13} />
          Import
        </button>
      </div>

      <div className="bin-columns">
        <span className="col-name">Name</span>
        <span>{items.length} items</span>
      </div>

      <div className="bin-list">
        {items.length === 0 && (
          <div className="bin-empty">ยังไม่มีไฟล์ — กด Import เพื่อเลือกรูปหรือเสียง</div>
        )}
        {items.map((item) => (
          <div
            className="bin-item"
            key={item.path}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/x-media-path", item.path);
              e.dataTransfer.effectAllowed = "copy";
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, item });
            }}
            title="ลากไปวางบน Timeline เพื่อใช้งาน"
          >
            {item.kind === "image" ? (
              <img className="media-thumb" src={item.url} alt="" loading="lazy" />
            ) : (
              <Music size={14} />
            )}
            <span className="bin-item-name">{item.name}</span>
            <span className="media-kind dim">{item.kind === "image" ? "รูป" : "เสียง"}</span>
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
              onDelete(menu.item);
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
