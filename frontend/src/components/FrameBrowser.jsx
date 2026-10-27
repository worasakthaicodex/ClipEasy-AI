import React, { useState } from "react";
import { X, ImagePlus, Clapperboard, Loader2 } from "lucide-react";

/** ตารางเฟรมที่แตกออกมา — คลิกเลือกเฟรม → เอารูปจากเครื่องไปแทนเฟรมนั้น
 *  แล้วประกอบกลับเป็นวิดีโอ (ไปแทนก้อนบน timeline ให้เอง) */
export default function FrameBrowser({
  framesDir,
  count,
  onClose,
  onReplace, // (frameNo, refresh) — เปิด dialog เลือกรูปแล้วแทนที่
  onRebuild, // () — ประกอบกลับเป็นวิดีโอ
  rebuildJob, // null | {status}
  replacedSet = {}, // เฟรมที่ถูกแทนแล้ว (ไว้ติดป้าย)
}) {
  const [sel, setSel] = useState(null);
  const [ver, setVer] = useState({}); // cache-buster ต่อเฟรม หลังแทนรูปแล้วให้ภาพรีเฟรช

  const fileOf = (n) => `${framesDir}\\frame_${String(n).padStart(6, "0")}.png`;
  const urlOf = (n) =>
    `media://${encodeURIComponent(fileOf(n))}${ver[n] ? `?v=${ver[n]}` : ""}`;

  const busy = rebuildJob?.status === "working";

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="settings-modal wide frame-modal">
        <div className="settings-titlebar">
          <Clapperboard size={14} />
          <span>เฟรมทั้งหมด ({count.toLocaleString()} เฟรม)</span>
          {sel && <span className="dim frame-sel-label">เลือก: #{sel}</span>}
          <button
            className="btn-secondary sm"
            disabled={!sel || busy}
            title={sel ? `เอารูปจากเครื่องมาแทนเฟรม #${sel}` : "คลิกเลือกเฟรมก่อน"}
            onClick={() =>
              onReplace(sel, () => setVer((v) => ({ ...v, [sel]: (v[sel] || 0) + 1 })))
            }
          >
            <ImagePlus size={12} /> แทนที่ด้วยรูป…
          </button>
          <button className="btn-primary sm" disabled={busy} onClick={onRebuild}>
            {busy ? (
              <>
                <Loader2 size={12} className="spin" /> กำลังประกอบ…
              </>
            ) : (
              "ประกอบกลับเป็นวิดีโอ"
            )}
          </button>
          <button className="icon-btn" onClick={onClose} disabled={busy} title="ปิด">
            <X size={14} />
          </button>
        </div>

        <div className="frame-body">
          <div className="frame-grid-full">
            {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
              <div
                key={n}
                className={`frame-cell ${sel === n ? "selected" : ""}`}
                onClick={() => setSel(n)}
                onDoubleClick={() =>
                  onReplace(n, () => setVer((v) => ({ ...v, [n]: (v[n] || 0) + 1 })))
                }
                title="คลิกเลือก · ดับเบิลคลิกเพื่อแทนที่ด้วยรูปทันที"
              >
                <img src={urlOf(n)} alt="" loading="lazy" />
                <span>
                  #{n}
                  {(ver[n] || replacedSet[n]) && <em className="frame-edited">แก้แล้ว</em>}
                </span>
              </div>
            ))}
          </div>

          {/* พรีวิวใหญ่ของเฟรมที่เลือก */}
          <div className="frame-preview">
            {sel ? (
              <>
                <img src={urlOf(sel)} alt="" />
                <div className="frame-preview-info">
                  <span className="tc">เฟรม #{sel}</span>
                  {ver[sel] && <em className="frame-edited">แก้แล้ว</em>}
                </div>
                <button
                  className="btn-secondary sm"
                  disabled={busy}
                  onClick={() =>
                    onReplace(sel, () => setVer((v) => ({ ...v, [sel]: (v[sel] || 0) + 1 })))
                  }
                >
                  <ImagePlus size={12} /> แทนที่เฟรมนี้ด้วยรูป…
                </button>
              </>
            ) : (
              <div className="dim frame-preview-hint">คลิกเฟรมทางซ้าย
เพื่อดูภาพใหญ่ตรงนี้</div>
            )}
          </div>
        </div>

        {rebuildJob?.status === "error" && (
          <div className="extract-result err" style={{ margin: "0 14px 10px" }}>
            ประกอบไม่สำเร็จ: {rebuildJob.error}
          </div>
        )}
      </div>
    </div>
  );
}
