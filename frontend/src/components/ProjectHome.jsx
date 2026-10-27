import React, { useEffect, useState } from "react";
import { Clapperboard, FolderOpen, Plus, Clock3, Film, Sparkles, X } from "lucide-react";

export default function ProjectHome({ onCreate, onOpen, onOpenRecent }) {
  const [name, setName] = useState("My Project");
  const [creating, setCreating] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [parentDir, setParentDir] = useState("");
  const [recent, setRecent] = useState([]);
  useEffect(() => { window.aiclip?.recentProjects?.().then(setRecent).catch(() => {}); }, []);
  const create = async () => {
    const value = name.trim(); if (!value || !parentDir) return;
    setCreating(true); try { await onCreate(value, parentDir); } finally { setCreating(false); }
  };
  const browse = async () => { const dir = await window.aiclip?.chooseProjectLocation?.(); if (dir) setParentDir(dir); };
  return (
    <div className="project-home">
      <aside className="project-home-side">
        <div className="project-home-brand"><span><Clapperboard size={20} /></span>ClipEasy <b>AI</b></div>
        <button className="home-nav active">Home</button>
        <button className="home-nav">Learn</button>
        <div className="home-project-actions">
          <button className="home-primary" onClick={() => setNewOpen(true)}><Plus size={15} />New Project</button>
          <button className="home-outline" onClick={onOpen}><FolderOpen size={15} />Open Project</button>
        </div>
      </aside>
      <main className="project-home-main">
        <header><div><h1>Welcome to ClipEasy AI</h1><p>สร้าง ตัดต่อ และจัดการโปรเจกต์ของคุณ</p></div><Sparkles size={24} /></header>
        <section className="home-hero">
          <div className="home-hero-art"><Film size={52} /><div className="home-wave" /></div>
          <div><h2>สร้างวิดีโอได้ง่ายขึ้น</h2><ul><li>สร้างโฟลเดอร์โปรเจกต์แยกเป็นสัดส่วน</li><li>บันทึก Timeline, Scene และ Media อัตโนมัติ</li><li>มีโฟลเดอร์ Media, Cache และ Exports พร้อมใช้</li></ul><button className="home-primary" onClick={() => setNewOpen(true)}><Plus size={15} />สร้างโปรเจกต์ใหม่</button></div>
        </section>
        <section className="home-recent"><h2><Clock3 size={17} /> Recent</h2>
          <div className="recent-head"><span>NAME</span><span>LOCATION</span><span>UPDATED</span></div>
          {recent.map((p) => <button key={p.filePath} className="recent-row" onClick={() => onOpenRecent(p.filePath)}><span><Clapperboard size={14} />{p.name}</span><span>{p.dirPath}</span><span>{p.updatedAt ? new Date(p.updatedAt).toLocaleString() : "-"}</span></button>)}
          {!recent.length && <div className="recent-empty">ยังไม่มีโปรเจกต์ล่าสุด</div>}
        </section>
      </main>
      {newOpen && (
        <div className="modal-overlay new-project-overlay" onMouseDown={(e) => e.target === e.currentTarget && !creating && setNewOpen(false)}>
          <div className="new-project-modal">
            <div className="new-project-title"><div><Clapperboard size={18} /><span><b>New Project</b><small>สร้างโปรเจกต์ใหม่บนเครื่อง</small></span></div><button className="icon-btn" onClick={() => setNewOpen(false)}><X size={15} /></button></div>
            <label>ชื่อโปรเจกต์<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น Social Video 01" /></label>
            <label>ตำแหน่งจัดเก็บ<div className="new-project-path"><input readOnly value={parentDir} placeholder="ยังไม่ได้เลือกโฟลเดอร์" /><button className="home-outline" onClick={browse}><FolderOpen size={14} />Browse</button></div></label>
            {parentDir && name.trim() && <div className="new-project-preview"><span>โปรเจกต์จะถูกสร้างที่</span><b>{parentDir}\\{name.trim()}</b></div>}
            <div className="new-project-folders"><span>Media</span><span>Cache</span><span>Exports</span><span>.clipeasy.json</span></div>
            <div className="new-project-footer"><button className="home-outline" onClick={() => setNewOpen(false)}>Cancel</button><button className="home-primary" disabled={creating || !name.trim() || !parentDir} onClick={create}>{creating ? "กำลังสร้าง..." : "Create Project"}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
