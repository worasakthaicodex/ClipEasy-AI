import React, { useEffect, useMemo, useState } from "react";
import {
  X,
  Cpu,
  Loader2,
  Settings,
  Palette,
  Keyboard,
  FolderCog,
  Sparkles,
  Search,
  Trash2,
  Check,
  ChevronDown,
  ChevronRight,
  HardDrive,
} from "lucide-react";

const BACKEND_URL = window.aiclip?.backendUrl ?? "http://127.0.0.1:8420";

const fmtSize = (mb) => (mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`);

/** ไอคอน engine: ใช้รูปจริง (avatar ของ repo) ถ้ามี/โหลดได้ ไม่งั้น fallback ตัวอักษร */
function EngineIcon({ engine, size = 30 }) {
  const [failed, setFailed] = useState(false);
  if (engine.icon && !failed) {
    return (
      <img
        className="plugin-icon img"
        style={{ width: size, height: size }}
        src={engine.icon}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className="plugin-icon" style={{ width: size, height: size }}>
      {engine.name.slice(0, 1)}
    </div>
  );
}

/** หน้าต่างตั้งค่าสไตล์ Plugins Manager ของ IDE:
 *  sidebar ซ้าย → รายการ engine (ค้นหา + แท็บ Marketplace/Installed) → รายละเอียดฝั่งขวา
 *  ติดตั้ง/ถอนจากปุ่มใน detail ได้เลย รองรับ engine จำนวนมากในอนาคต */
export default function EngineManager({ onClose, initialPage = "engines", saveMode = "auto", onSaveModeChange, onSaveNow, appPrefs = {}, onAppPrefsChange }) {
  const [settingsPage, setSettingsPage] = useState(initialPage);
  const [data, setData] = useState(null); // {specs, engines}
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("all"); // all | installed
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [job, setJob] = useState(null); // {engineId, phase, done_mb, total_mb}
  const [closedGroups, setClosedGroups] = useState({}); // กลุ่มงานที่พับอยู่
  const busy = !!job;

  const load = async () => {
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/engines`);
      if (!res.ok) throw new Error(`backend ตอบ ${res.status}`);
      const d = await res.json();
      setData(d);
      setSelectedId((id) => id ?? d.engines[0]?.id ?? null);
    } catch (err) {
      setError(String(err.message || err));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const engines = data?.engines ?? [];
  const installedCount = engines.filter((e) => e.installed).length;

  // กรองตามแท็บ + คำค้น แล้วจัดกลุ่มตาม category
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = engines.filter(
      (e) =>
        (tab === "all" || e.installed) &&
        (!q || `${e.name} ${e.vendor} ${e.desc}`.toLowerCase().includes(q))
    );
    const by = {};
    list.forEach((e) => (by[e.category] ??= []).push(e));
    return Object.entries(by);
  }, [engines, tab, query]);

  const selected = engines.find((e) => e.id === selectedId) ?? null;

  async function install(engine) {
    if (busy) return;
    setJob({ engineId: engine.id, phase: "เริ่มติดตั้ง…" });
    try {
      const { job_id } = await (
        await fetch(`${BACKEND_URL}/engines/${engine.id}/install`, { method: "POST" })
      ).json();
      for (;;) {
        await new Promise((r) => setTimeout(r, 700));
        const j = await (await fetch(`${BACKEND_URL}/jobs/${job_id}`)).json();
        setJob({ engineId: engine.id, jobId: job_id, ...j });
        if (j.status !== "working") {
          if (j.status === "error") throw new Error(j.error);
          break; // done หรือ cancelled — จบเงียบๆ
        }
      }
      await load();
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setJob(null);
    }
  }

  // ยกเลิกการติดตั้งที่กำลังรันอยู่ — backend หยุดแล้วเก็บกวาดไฟล์เอง
  function cancelInstall() {
    if (!job?.jobId) return;
    setJob((j) => ({ ...j, phase: "กำลังยกเลิก…" }));
    fetch(`${BACKEND_URL}/jobs/${job.jobId}/cancel`, { method: "POST" }).catch(() => {});
  }

  async function uninstall(engine) {
    if (busy) return;
    await fetch(`${BACKEND_URL}/engines/${engine.id}`, { method: "DELETE" });
    await load();
  }

  const jobFor = (id) => (job?.engineId === id ? job : null);

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="settings-modal wide">
        {/* title bar */}
        <div className="settings-titlebar">
          <Settings size={14} />
          <span>Settings</span>
          <button className="icon-btn" onClick={onClose} disabled={busy} title="ปิด">
            <X size={14} />
          </button>
        </div>

        <div className="settings-body">
          {/* คอลัมน์ 1: sidebar หมวดตั้งค่า */}
          <aside className="settings-nav">
            <div className="settings-nav-label">APPLICATION</div>
            <div className={`nav-item ${settingsPage === "general" ? "active" : ""}`} onClick={() => setSettingsPage("general")}>
              <Settings size={13} /> General
            </div>
            <div className={`nav-item ${settingsPage === "appearance" ? "active" : ""}`} onClick={() => setSettingsPage("appearance")}><Palette size={13} /> Appearance</div>
            <div className="nav-item dim"><Keyboard size={13} /> Keymap</div>
            <div className="settings-nav-label">TOOLS &amp; OUTPUT</div>
            <div className={`nav-item ${settingsPage === "engines" ? "active" : ""}`} onClick={() => setSettingsPage("engines")}>
              <Sparkles size={13} /> AI Engines
              {installedCount > 0 && <span className="nav-badge">{installedCount}</span>}
            </div>
            <div className="nav-item dim"><FolderCog size={13} /> Export</div>
          </aside>

          {settingsPage === "general" ? (
            <div className="settings-general">
              <header className="settings-page-head">
                <div><h2>{appPrefs.language === "th" ? "การตั้งค่าทั่วไป" : "General Settings"}</h2><p>{appPrefs.language === "th" ? "ตั้งค่าการทำงานพื้นฐานของโปรแกรมและโปรเจกต์" : "Configure application and project behavior"}</p></div>
              </header>

              <section className="settings-section">
                <h3>APPLICATION</h3>
                <div className="settings-form-row">
                  <div className="settings-field-label"><b>{appPrefs.language === "th" ? "เปิดแบบเต็มจอ" : "Start maximized"}</b><small>{appPrefs.language === "th" ? "เปิด ClipEasy AI เต็มพื้นที่หน้าจอในครั้งถัดไป" : "Open ClipEasy AI maximized on the next launch"}</small></div>
                  <label className="settings-switch"><input type="checkbox" checked={appPrefs.startMaximized !== false} onChange={(e) => onAppPrefsChange?.({ startMaximized: e.target.checked })} /><span /></label>
                </div>
              </section>

              <section className="settings-section">
                <h3>PROJECT SAVING</h3>
                <div className="settings-form-row">
                  <div className="settings-field-label"><b>Save mode</b><small>กำหนดวิธีบันทึกการเปลี่ยนแปลงของโปรเจกต์</small></div>
                  <select value={saveMode} onChange={(e) => onSaveModeChange?.(e.target.value)}>
                    <option value="auto">Auto Save</option>
                    <option value="manual">Manual Save</option>
                  </select>
                </div>
                <div className="settings-form-row">
                  <div className="settings-field-label"><b>Auto Save</b><small>บันทึกเมื่อ Timeline, Scene หรือ Media มีการเปลี่ยนแปลง</small></div>
                  <span className={`settings-status ${saveMode === "auto" ? "on" : ""}`}>{saveMode === "auto" ? "Enabled" : "Disabled"}</span>
                </div>
                <div className="settings-form-row">
                  <div className="settings-field-label"><b>Save project now</b><small>บันทึกสถานะล่าสุดลงไฟล์โปรเจกต์ทันที</small></div>
                  <button className="btn-secondary sm" onClick={onSaveNow}>Save Now</button>
                </div>
              </section>

              <section className="settings-section">
                <h3>PROJECT FILES</h3>
                <div className="settings-form-row">
                  <div className="settings-field-label"><b>Media management</b><small>เก็บ Media, Cache และไฟล์ Export แยกในโฟลเดอร์โปรเจกต์</small></div>
                  <span className="settings-value">Project folder</span>
                </div>
              </section>
            </div>
          ) : settingsPage === "appearance" ? (
            <div className="settings-general">
              <header className="settings-page-head">
                <div><h2>{appPrefs.language === "th" ? "รูปลักษณ์" : "Appearance"}</h2><p>{appPrefs.language === "th" ? "ปรับภาษาและรูปแบบการแสดงผลของโปรแกรม" : "Customize language and interface appearance"}</p></div>
              </header>
              <section className="settings-section">
                <h3>INTERFACE</h3>
                <div className="settings-form-row">
                  <div className="settings-field-label"><b>{appPrefs.language === "th" ? "ภาษา" : "Language"}</b><small>{appPrefs.language === "th" ? "ภาษาที่ใช้แสดงในโปรแกรม" : "Language used by the application interface"}</small></div>
                  <select value={appPrefs.language || "th"} onChange={(e) => onAppPrefsChange?.({ language: e.target.value })}><option value="th">ไทย</option><option value="en">English</option></select>
                </div>
                <div className="settings-form-row">
                  <div className="settings-field-label"><b>{appPrefs.language === "th" ? "ธีมสี" : "Color theme"}</b><small>{appPrefs.language === "th" ? "เลือกโทนมืดหรือโทนสว่าง" : "Choose a dark or light interface"}</small></div>
                  <select value={appPrefs.theme || "dark"} onChange={(e) => onAppPrefsChange?.({ theme: e.target.value })}><option value="dark">{appPrefs.language === "th" ? "มืด" : "Dark"}</option><option value="light">{appPrefs.language === "th" ? "สว่าง" : "Light"}</option></select>
                </div>
              </section>
            </div>
          ) : <>
          {/* คอลัมน์ 2: รายการ engine */}
          <div className="plugin-list-col">
            <div className="plugin-list-head">
              <span className="plugin-title">Engines</span>
              <div className="plugin-tabs">
                <button className={`plugin-tab ${tab === "all" ? "active" : ""}`} onClick={() => setTab("all")}>
                  Marketplace
                </button>
                <button
                  className={`plugin-tab ${tab === "installed" ? "active" : ""}`}
                  onClick={() => setTab("installed")}
                >
                  Installed{installedCount > 0 && <span className="tab-badge">{installedCount}</span>}
                </button>
              </div>
            </div>
            <div className="plugin-search">
              <Search size={12} />
              <input
                placeholder="Type / to see options"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {data?.install_dir && (
              <div className="install-dir" title={data.install_dir}>
                <HardDrive size={11} />
                <span>ติดตั้งที่: {data.install_dir}</span>
              </div>
            )}

            <div className="plugin-list">
              {error && (
                <div className="engine-error">
                  โหลดไม่สำเร็จ: {error}
                  <span className="dim">เช็คว่า backend รันอยู่ (พอร์ต 8420)</span>
                  <button className="btn-secondary sm" onClick={load}>ลองใหม่</button>
                </div>
              )}
              {groups.map(([cat, list]) => (
                <div key={cat}>
                  <div
                    className="plugin-group-head clickable"
                    onClick={() => setClosedGroups((g) => ({ ...g, [cat]: !g[cat] }))}
                  >
                    {closedGroups[cat] ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                    <span>{cat}</span>
                    <span className="group-count">{list.length}</span>
                  </div>
                  {!closedGroups[cat] && list.map((e) => {
                    const j = jobFor(e.id);
                    return (
                      <div
                        key={e.id}
                        className={`plugin-row ${selectedId === e.id ? "selected" : ""} ${!e.supported && !e.installed ? "unsupported" : ""}`}
                        onClick={() => setSelectedId(e.id)}
                      >
                        <EngineIcon engine={e} />
                        <div className="plugin-row-main">
                          <div className="plugin-row-name">{e.name}</div>
                          <div className="plugin-row-sub">
                            {fmtSize(e.size_mb)} · {e.vendor}
                          </div>
                          {j && (
                            <div className="progress-track sm">
                              <div
                                className="progress-fill"
                                style={{
                                  width: j.total_mb > 0 ? `${Math.min(100, (j.done_mb / j.total_mb) * 100)}%` : "30%",
                                }}
                              />
                            </div>
                          )}
                        </div>
                        {j ? (
                          <Loader2 size={13} className="spin" />
                        ) : e.installed ? (
                          <span className="plugin-check"><Check size={13} /></span>
                        ) : e.supported ? (
                          <button
                            className="btn-mini"
                            disabled={busy}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              setSelectedId(e.id);
                              install(e);
                            }}
                          >
                            Install
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
              {!error && groups.length === 0 && (
                <div className="plugin-empty dim">ไม่พบ engine {tab === "installed" ? "ที่ติดตั้งไว้" : ""}</div>
              )}
            </div>
          </div>

          {/* คอลัมน์ 3: รายละเอียด engine ที่เลือก */}
          <main className="plugin-detail">
            {selected ? (
              <>
                <div className="detail-head">
                  <EngineIcon engine={selected} size={44} />
                  <h2 className="detail-name">{selected.name}</h2>
                </div>
                <div className="detail-vendor">
                  {selected.vendor} <span className="dim">· {selected.category}</span>
                </div>

                <div className="detail-actions">
                  {jobFor(selected.id) ? (
                    <div className="detail-installing">
                      <Loader2 size={13} className="spin" />
                      <span>{jobFor(selected.id).phase || "กำลังติดตั้ง…"}</span>
                      {jobFor(selected.id).total_mb > 0 && (
                        <span className="dim">
                          {jobFor(selected.id).done_mb?.toFixed(0)} / {jobFor(selected.id).total_mb?.toFixed(0)} MB
                        </span>
                      )}
                      <button className="btn-secondary sm danger" onClick={cancelInstall}>
                        ยกเลิก
                      </button>
                    </div>
                  ) : selected.installed ? (
                    <>
                      <span className="st-installed"><Check size={13} /> Installed</span>
                      <button className="btn-secondary sm danger" disabled={busy} onClick={() => uninstall(selected)}>
                        <Trash2 size={12} /> Uninstall
                      </button>
                    </>
                  ) : selected.supported ? (
                    <button className="btn-primary sm" disabled={busy} onClick={() => install(selected)}>
                      Install ({fmtSize(selected.size_mb)})
                    </button>
                  ) : (
                    <button className="btn-primary sm" disabled>Install</button>
                  )}
                </div>

                {!selected.supported && !selected.installed && (
                  <div className="detail-warning">สเปคเครื่องไม่ถึง: {selected.reason}</div>
                )}

                <div className="detail-tabs">
                  <span className="detail-tab active">Overview</span>
                </div>

                <div className="detail-overview">
                  {selected.overview.split("\n").map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>

                {data && (
                  <div className="spec-line">
                    <Cpu size={12} />
                    <span>
                      เครื่องนี้: <b>{data.specs.gpu ?? "ไม่มีการ์ด NVIDIA"}</b>
                      {data.specs.vram_mb > 0 && ` (${(data.specs.vram_mb / 1024).toFixed(0)}GB)`}
                      {" · "}RAM {(data.specs.ram_mb / 1024).toFixed(0)}GB
                      {" · "}ดิสก์ว่าง {(data.specs.disk_free_mb / 1024).toFixed(0)}GB
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="plugin-empty dim">เลือก engine จากรายการซ้ายเพื่อดูรายละเอียด</div>
            )}
          </main>
          </>}
        </div>

        <div className="settings-footer">
          <span className="footer-note dim">{busy ? "กำลังติดตั้ง… อย่าปิดหน้าต่างนี้" : ""}</span>
          <button className="btn-secondary sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn-primary sm" onClick={onClose} disabled={busy}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
