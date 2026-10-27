import React, { useEffect, useRef, useState } from "react";
import { LayoutPanelLeft, Share, AlignJustify, Settings } from "lucide-react";
import PanelGroup from "./components/PanelGroup";
import EngineManager from "./components/EngineManager";
import MediaBrowser from "./components/MediaBrowser";
import TemplatesPanel from "./components/TemplatesPanel";
import FrameBrowser from "./components/FrameBrowser";
import Monitor from "./components/Monitor";
import ProjectPanel from "./components/ProjectPanel";
import ToolsPanel from "./components/ToolsPanel";
import Timeline from "./components/Timeline";
import AudioMeter from "./components/AudioMeter";
import Splitter from "./components/Splitter";
import PropertiesPanel from "./components/PropertiesPanel";
import TextAnimPanel from "./components/TextAnimations";
import VideoFxPanel from "./components/VideoEffects";
import ImageControls from "./components/ImageControls";
import ProjectHome from "./components/ProjectHome";
import ExportWorkspace from "./components/ExportWorkspace";
import { hasMask, maskBounds, maskMatrixAt, transformPoint } from './components/maskFx';
import { maskControlSettings } from './components/MaskFxControls';

const TABS = ["Import", "Edit", "AI Tools", "Export"];
const BACKEND_URL = window.aiclip?.backendUrl ?? "http://127.0.0.1:8420";

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

// อ่านความยาวคลิป (วินาที) จาก metadata โดยไม่ต้องเล่นจริง
function probeDuration(url) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.src = url;
    v.onloadedmetadata = () => resolve(v.duration || 0);
    v.onerror = () => resolve(0);
  });
}

// จุดสิ้นสุดของ sequence (ตำแหน่งขอบขวาสุดของทุกคลิป) — คลิปวางห่างกันได้ มีช่องว่างได้
function seqEnd(items) {
  return items.reduce((m, c) => Math.max(m, c.offset + c.duration), 0);
}

// id ก้อนบน timeline — ผูกกับเวลาจริงกันซ้ำ (ตัวนับเฉยๆ จะรีเซ็ตตอน hot-reload แล้ว id ชนกัน)
let clipIdCounter = 1;
const newClipId = () => `tc${Date.now().toString(36)}_${clipIdCounter++}`;

export default function App() {
  const [project, setProject] = useState(null);
  const [projectReady, setProjectReady] = useState(false);
  const [saveMode, setSaveMode] = useState(() => localStorage.getItem("clipeasy_save_mode") || "auto");
  const [appPrefs, setAppPrefs] = useState(() => { try { return JSON.parse(localStorage.getItem("clipeasy_app_prefs")) || { startMaximized: true, language: "th", theme: "dark" }; } catch { return { startMaximized: true, language: "th", theme: "dark" }; } });
  const [saveNotice, setSaveNotice] = useState(null);
  const [activeTab, setActiveTab] = useState("Edit");
  const [engineManagerOpen, setEngineManagerOpen] = useState(false); // popup ตั้งค่า AI Engines
  const [settingsStartPage, setSettingsStartPage] = useState("engines");
  const [layoutPickerOpen, setLayoutPickerOpen] = useState(false); // popup เลือกแบบแบ่งฉาก
  const [bgEngines, setBgEngines] = useState([]); // engine ตัดฉากหลังที่ติดตั้งแล้ว [{id, name}]
  const [bgEngineId, setBgEngineId] = useState(null); // โมเดลที่เลือกใช้อยู่
  const [bgJob, setBgJob] = useState(null); // งานตัดฉากหลังที่กำลังรัน {clipId, status, done, total}
  const bgEngineReady = bgEngines.length > 0;

  useEffect(() => {
    window.aiclip?.getAppSettings?.().then((saved) => saved && setAppPrefs((p) => ({ ...p, ...saved }))).catch(() => {});
  }, []);
  useEffect(() => {
    localStorage.setItem("clipeasy_app_prefs", JSON.stringify(appPrefs));
    document.documentElement.lang = appPrefs.language;
    document.body.classList.toggle("theme-light", appPrefs.theme === "light");
    window.aiclip?.setAppSettings?.(appPrefs).catch(() => {});
  }, [appPrefs]);
  const updateAppPrefs = (patch) => setAppPrefs((p) => ({ ...p, ...patch }));
  const tabLabel = (tab) => appPrefs.language === "th" ? ({ Import: "นำเข้า", Edit: "ตัดต่อ", "AI Tools": "เครื่องมือ AI", Export: "ส่งออก" }[tab] || tab) : tab;
  const [upEngines, setUpEngines] = useState([]); // engine ปรับภาพชัดที่ติดตั้งแล้ว
  const [sttEngines, setSttEngines] = useState([]); // engine ถอดเสียงเป็นซับ (Whisper) ที่ติดตั้งแล้ว
  const [sttEngineId, setSttEngineId] = useState(null);
  const [sttLang, setSttLang] = useState("auto"); // ภาษาที่ให้ถอด (auto = ตรวจเอง)
  const [sttJob, setSttJob] = useState(null); // สถานะงานถอดเสียงปัจจุบัน
  const [upEngineId, setUpEngineId] = useState(null);
  const [upJob, setUpJob] = useState(null);
  const [inpEngines, setInpEngines] = useState([]); // engine ลบวัตถุ/เซ็นเซอร์ (inpaint) ที่ติดตั้งแล้ว
  const [inpEngineId, setInpEngineId] = useState(null);
  const [inpJob, setInpJob] = useState(null); // งานลบวัตถุที่กำลังรัน
  const [inpDraw, setInpDraw] = useState(null); // {clipId} — รอผู้ใช้วาดกรอบบนจอ Program
  const [censorJob, setCensorJob] = useState(null); // งานฝังเซ็นเซอร์ถาวรที่กำลังรัน
  const [swapReady, setSwapReady] = useState(false); // engine สลับหน้าติดตั้งแล้วหรือยัง
  const [swapEngines, setSwapEngines] = useState([]); // engine สลับหน้าที่ติดตั้งแล้ว (Local/FaceFusion)
  const [swapEngineId, setSwapEngineId] = useState(null);
  // รายการสลับหน้า: [{source: path|null, ref: {t,x,y,w,h}|null}] — ref=null = ใช้กับทุกคน
  const [swapMaps, setSwapMaps] = useState([{ source: null, ref: null }]);
  const [swapPick, setSwapPick] = useState(null); // {clipId, index} — กำลังชี้คนบนจอให้แถวไหน
  const [swapEnhance, setSwapEnhance] = useState(true); // GFPGAN เก็บหน้าคม
  const [swapJob, setSwapJob] = useState(null); // งานสลับหน้าที่กำลังรัน
  const [trkEngines, setTrkEngines] = useState([]); // engine ชี้เป้า/ตามวัตถุที่ติดตั้งแล้ว
  const [trkEngineId, setTrkEngineId] = useState(null);
  const [trkJob, setTrkJob] = useState(null); // งานชี้เป้าที่กำลังรัน
  const [trkDraw, setTrkDraw] = useState(null); // {clipId} — รอผู้ใช้ตีกรอบเป้าบนจอ Program
  const [trkStyle, setTrkStyle] = useState("circle"); // สัญลักษณ์ชี้เป้า: circle | arrow | box
  const [fcEngines, setFcEngines] = useState([]); // engine เซ็นเซอร์ใบหน้าอัตโนมัติที่ติดตั้งแล้ว
  const [fcEngineId, setFcEngineId] = useState(null); // โมเดลตรวจหน้าที่เลือกใช้ (YuNet/SCRFD)
  const [fcTarget, setFcTarget] = useState("face"); // เป้าหมายเซ็นเซอร์: face | plate | text
  const [czInstalled, setCzInstalled] = useState({}); // engine เซ็นเซอร์ที่ติดตั้งแล้วทั้งหมด {id:true}
  const [fcStyle, setFcStyle] = useState("blur"); // แบบเซ็นเซอร์ใบหน้า blur | mosaic
  const [fcJob, setFcJob] = useState(null); // งานเซ็นเซอร์ใบหน้าอัตโนมัติที่กำลังรัน
  const [keepRefs, setKeepRefs] = useState([]); // หน้าที่เลือกไว้ [{t,x,y,w,h}] (t = เวลาในไฟล์)
  const [keepInvert, setKeepInvert] = useState(false); // true = เบลอเฉพาะคนที่เลือก (กลับด้าน)
  const [keepDraw, setKeepDraw] = useState(null); // {clipId} — รอผู้ใช้คลิกเลือกหน้าบนจอ Program

  // เช็คสถานะ engine ตอนเปิดแอป + ทุกครั้งที่ปิดหน้าตั้งค่า (เผื่อเพิ่งกดติดตั้ง/ถอน)
  useEffect(() => {
    if (engineManagerOpen) return;
    fetch(`${BACKEND_URL}/engines`)
      .then((r) => r.json())
      .then((d) => {
        const bg = d.engines.filter((e) => e.installed && e.category.includes("ตัดฉากหลัง"));
        setBgEngines(bg);
        // ตัวที่เลือกไว้โดนถอน → สลับไปตัวแรกที่เหลือ
        setBgEngineId((id) => (bg.some((e) => e.id === id) ? id : bg[0]?.id ?? null));
        const up = d.engines.filter((e) => e.installed && e.category.includes("ปรับภาพชัด"));
        setUpEngines(up);
        setUpEngineId((id) => (up.some((e) => e.id === id) ? id : up[0]?.id ?? null));
        const stt = d.engines.filter((e) => e.installed && e.category.includes("ถอดเสียง"));
        setSttEngines(stt);
        setSttEngineId((id) => (stt.some((e) => e.id === id) ? id : stt[0]?.id ?? null));
        const inp = d.engines.filter((e) => e.installed && e.category.includes("ลบวัตถุ"));
        setInpEngines(inp);
        setInpEngineId((id) => (inp.some((e) => e.id === id) ? id : inp[0]?.id ?? null));
        const sw = d.engines.filter((e) => e.installed && e.category.includes("สลับหน้า"));
        setSwapEngines(sw);
        setSwapEngineId((id) => (sw.some((e) => e.id === id) ? id : sw[0]?.id ?? null));
        setSwapReady(sw.length > 0);
        const trk = d.engines.filter((e) => e.installed && e.category.includes("ชี้เป้า"));
        setTrkEngines(trk);
        setTrkEngineId((id) => (trk.some((e) => e.id === id) ? id : trk[0]?.id ?? null));
        const cz = d.engines.filter((e) => e.installed && e.category.includes("เซ็นเซอร์อัตโนมัติ"));
        setCzInstalled(Object.fromEntries(cz.map((e) => [e.id, true])));
        // dropdown โมเดลตรวจ "หน้า" เท่านั้น (ป้ายทะเบียน/ข้อความเป็นเป้าหมายแยก ไม่ใช่โมเดลหน้า)
        const fc = cz.filter((e) => e.id.startsWith("face-censor"));
        setFcEngines(fc);
        setFcEngineId((id) => (fc.some((e) => e.id === id) ? id : fc[0]?.id ?? null));
      })
      .catch(() => {
        setBgEngines([]);
        setUpEngines([]);
      }); // backend ไม่รัน = ถือว่ายังใช้ไม่ได้
  }, [engineManagerOpen]);

  // ตัดฉากหลังก้อนที่เลือก — ได้ WebM โปร่งใสมาแทนไฟล์เดิมของก้อนนั้น
  async function removeBg(clip) {
    if (!clip || bgJob?.status === "working") return;
    setBgJob({ clipId: clip.id, status: "working", done: 0, total: 0 });
    try {
      const res = await fetch(`${BACKEND_URL}/video/remove-bg`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_path: clip.path,
          engine: bgEngineId,
          // ทำเฉพาะช่วงของก้อนนี้ (ก้อนที่ถูกตัด/แบ่งจะไม่เสียเวลาทำทั้งไฟล์)
          // ช่วงเป็นเวลา "ในไฟล์จริง" — duration บน timeline ถูกหารสปีดไว้ ต้องคูณกลับ
          start: clip.inPoint || 0,
          duration: clip.duration * (clip.speed || 1),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { job_id } = await res.json();
      setBgJob({ clipId: clip.id, status: "working", done: 0, total: 0, job_id });
      for (;;) {
        await new Promise((r) => setTimeout(r, 1000));
        const j = await (await fetch(`${BACKEND_URL}/jobs/${job_id}`)).json();
        setBgJob({ clipId: clip.id, job_id, ...j });
        if (j.status !== "working") {
          if (j.status === "error") throw new Error(j.error);
          if (j.status === "cancelled") {
            setBgJob(null);
            return;
          }
          // สำเร็จ: ชี้ก้อนนี้ไปไฟล์ใหม่ — ไฟล์ใหม่มีเฉพาะช่วงของก้อน จึงเริ่มนับที่ 0
          updateSeqClip(clip.id, {
            path: j.out_path,
            url: `media://${encodeURIComponent(j.out_path)}`,
            name: clip.name.replace(/\.\w+$/, "") + "_nobg.webm",
            inPoint: 0,
            srcDuration: clip.duration * (clip.speed || 1), // ไฟล์ใหม่ยาวเท่าช่วงจริงที่ตัดมา
            bgRemoved: true, // ติดธงไว้ — ปุ่มใน AI Tools จะโชว์ว่าทำแล้ว กดซ้ำไม่ได้
          });
          break;
        }
      }
    } catch (err) {
      setBgJob({ clipId: clip.id, status: "error", error: String(err.message || err) });
      return;
    }
    setBgJob({ clipId: clip.id, status: "done" }); // โชว์ ✓ ค้างไว้จนผู้ใช้เริ่มงานใหม่
  }

  // ปรับภาพชัด (AI upscale) ก้อนที่เลือก — ได้ mp4 ความละเอียดสูงขึ้นมาแทนก้อนเดิม
  async function upscaleClip(clip) {
    if (!clip || upJob?.status === "working") return;
    setUpJob({ clipId: clip.id, status: "working", done: 0, total: 0 });
    try {
      const res = await fetch(`${BACKEND_URL}/video/upscale`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_path: clip.path,
          engine: upEngineId,
          start: clip.inPoint || 0,
          duration: clip.duration * (clip.speed || 1), // เวลาในไฟล์จริง (คูณสปีดกลับ)
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { job_id } = await res.json();
      setUpJob({ clipId: clip.id, status: "working", done: 0, total: 0, job_id });
      for (;;) {
        await new Promise((r) => setTimeout(r, 1000));
        const j = await (await fetch(`${BACKEND_URL}/jobs/${job_id}`)).json();
        setUpJob({ clipId: clip.id, job_id, ...j });
        if (j.status !== "working") {
          if (j.status === "error") throw new Error(j.error);
          if (j.status === "cancelled") {
            setUpJob(null);
            return;
          }
          updateSeqClip(clip.id, {
            path: j.out_path,
            url: `media://${encodeURIComponent(j.out_path)}`,
            name: clip.name.replace(/\.\w+$/, "") + "_up.mp4",
            inPoint: 0,
            srcDuration: clip.duration * (clip.speed || 1), // ไฟล์ใหม่ยาวเท่าช่วงจริงที่ตัดมา
            upscaled: true, // ติดธงไว้ — ปุ่มใน AI Tools จะโชว์ว่าทำแล้ว กดซ้ำไม่ได้
          });
          break;
        }
      }
    } catch (err) {
      setUpJob({ clipId: clip.id, status: "error", error: String(err.message || err) });
      return;
    }
    setUpJob({ clipId: clip.id, status: "done" }); // โชว์ ✓ ค้างไว้จนผู้ใช้เริ่มงานใหม่
  }

  // ถอดเสียงก้อนที่เลือกเป็นซับ (Whisper) → สร้างก้อนข้อความบน timeline ตาม timestamp
  async function transcribeClip(clip) {
    if (!clip || sttJob?.status === "working") return;
    setSttJob({ clipId: clip.id, status: "working", done: 0, total: 0 });
    try {
      const res = await fetch(`${BACKEND_URL}/audio/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_path: clip.path,
          engine: sttEngineId,
          language: sttLang,
          start: clip.inPoint || 0,
          duration: clip.duration * (clip.speed || 1), // เวลาในไฟล์จริง (คูณสปีดกลับ)
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { job_id } = await res.json();
      setSttJob({ clipId: clip.id, status: "working", done: 0, total: 0, job_id });
      for (;;) {
        await new Promise((r) => setTimeout(r, 1000));
        const j = await (await fetch(`${BACKEND_URL}/jobs/${job_id}`)).json();
        setSttJob({ clipId: clip.id, job_id, ...j });
        if (j.status !== "working") {
          if (j.status === "error") throw new Error(j.error);
          if (j.status === "cancelled") {
            setSttJob(null);
            return;
          }
          const segs = j.segments || [];
          if (!segs.length) {
            setSttJob({ clipId: clip.id, status: "empty" }); // ไม่พบเสียงพูด
            return;
          }
          // ซับแต่ละประโยค = 1 ก้อนข้อความ วางบน timeline ตรงกับช่วงเสียงของก้อนต้นทาง
          // seg.start/end นับจากต้นก้อน (speed=1 ในไฟล์ตัด) → บวก offset ก้อน แล้วหารสปีดกลับเป็นเวลา timeline
          const sp = clip.speed || 1;
          const base = clip.offset;
          // สไตล์ซับ: ใช้เทมเพลตที่ลากวางไว้ (สไตล์+ตำแหน่ง) ถ้ามี ไม่งั้นใช้ค่าเริ่มต้น
          const subStyle = subtitleTpl?.style
            ? { ...subtitleTpl.style }
            : { size: 42, color: "#ffffff", bold: true, outline: true };
          const subTf = subtitleTpl?.transform ? { transform: { ...subtitleTpl.transform } } : {};
          const newClips = segs.map((s) => {
            const id = newClipId();
            const dur = Math.max(0.4, (s.end - s.start) / sp);
            return {
              id,
              type: "text",
              name: "ซับ",
              text: s.text,
              style: { ...subStyle },
              ...subTf,
              track: 3,
              offset: base + s.start / sp,
              duration: dur,
              inPoint: 0,
              srcDuration: dur,
            };
          });
          setSequence((prev) => [...prev, ...newClips]);
          setSttJob({ clipId: clip.id, status: "done", count: newClips.length });
          return;
        }
      }
    } catch (err) {
      setSttJob({ clipId: clip.id, status: "error", error: String(err.message || err) });
    }
  }

  // เริ่มลบวัตถุ: ขั้นแรกให้ผู้ใช้ลากวาดกรอบบนจอ Program ก่อน (Esc = ยกเลิก)
  function startInpaint(clip) {
    if (!clip || inpJob?.status === "working") return;
    setInpDraw({ clipId: clip.id });
  }

  // ได้กรอบจากจอ Program แล้ว → ส่งงานให้ backend (rect เป็นสัดส่วน 0–1 ของเฟรม)
  async function inpaintClip(clip, rect) {
    if (!clip || inpJob?.status === "working") return;
    setInpJob({ clipId: clip.id, status: "working", done: 0, total: 0 });
    try {
      const res = await fetch(`${BACKEND_URL}/video/inpaint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_path: clip.path,
          engine: inpEngineId,
          rect,
          start: clip.inPoint || 0,
          duration: clip.duration * (clip.speed || 1), // เวลาในไฟล์จริง (คูณสปีดกลับ)
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { job_id } = await res.json();
      setInpJob({ clipId: clip.id, status: "working", done: 0, total: 0, job_id });
      for (;;) {
        await new Promise((r) => setTimeout(r, 1000));
        const j = await (await fetch(`${BACKEND_URL}/jobs/${job_id}`)).json();
        setInpJob({ clipId: clip.id, job_id, ...j });
        if (j.status !== "working") {
          if (j.status === "error") throw new Error(j.error);
          if (j.status === "cancelled") {
            setInpJob(null);
            return;
          }
          updateSeqClip(clip.id, {
            path: j.out_path,
            url: `media://${encodeURIComponent(j.out_path)}`,
            name: clip.name.replace(/\.\w+$/, "") + "_clean.mp4",
            inPoint: 0,
            srcDuration: clip.duration * (clip.speed || 1), // ไฟล์ใหม่ยาวเท่าช่วงจริงที่ตัดมา
          });
          break;
        }
      }
    } catch (err) {
      setInpJob({ clipId: clip.id, status: "error", error: String(err.message || err) });
      return;
    }
    setInpJob({ clipId: clip.id, status: "done" });
  }

  // สลับหน้าคนในก้อนเป็นหน้าจากรูปต้นแบบ (เลือกรูปจาก Media Browser ไว้ก่อน)
  async function swapFaceClip(clip) {
    // ส่งเฉพาะแถวที่เลือกรูปแล้ว
    const maps = swapMaps.filter((m) => m.source).map((m) => ({ source: m.source, ref: m.ref }));
    if (!clip || maps.length === 0 || swapJob?.status === "working") return;
    setSwapJob({ clipId: clip.id, status: "working", done: 0, total: 0 });
    try {
      const res = await fetch(`${BACKEND_URL}/video/swap-face`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_path: clip.path,
          maps,
          engine: swapEngineId,
          enhance: swapEnhance,
          start: clip.inPoint || 0,
          duration: clip.duration * (clip.speed || 1), // เวลาในไฟล์จริง (คูณสปีดกลับ)
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { job_id } = await res.json();
      setSwapJob({ clipId: clip.id, status: "working", done: 0, total: 0, job_id });
      for (;;) {
        await new Promise((r) => setTimeout(r, 1000));
        const j = await (await fetch(`${BACKEND_URL}/jobs/${job_id}`)).json();
        setSwapJob({ clipId: clip.id, job_id, ...j });
        if (j.status !== "working") {
          if (j.status === "error") throw new Error(j.error);
          if (j.status === "cancelled") {
            setSwapJob(null);
            return;
          }
          updateSeqClip(clip.id, {
            path: j.out_path,
            url: `media://${encodeURIComponent(j.out_path)}`,
            name: clip.name.replace(/\.\w+$/, "") + "_swap.mp4",
            inPoint: 0,
            srcDuration: clip.duration * (clip.speed || 1),
          });
          break;
        }
      }
    } catch (err) {
      setSwapJob({ clipId: clip.id, status: "error", error: String(err.message || err) });
      return;
    }
    setSwapJob({ clipId: clip.id, status: "done" });
  }

  // เริ่มชี้เป้า: เลื่อน playhead ไปเฟรมที่เห็นเป้าชัด แล้วตีกรอบบนจอ Program (Esc = ยกเลิก)
  function startTrack(clip) {
    if (!clip || trkJob?.status === "working") return;
    setTrkDraw({ clipId: clip.id });
  }

  // ได้กรอบเป้าแล้ว → ให้ AI ตามเป้าทั้งก้อน + วาดสัญลักษณ์วิ่งตาม
  async function trackClip(clip, rect) {
    if (!clip || trkJob?.status === "working") return;
    setTrkJob({ clipId: clip.id, status: "working", done: 0, total: 0 });
    try {
      const res = await fetch(`${BACKEND_URL}/video/track`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_path: clip.path,
          engine: trkEngineId,
          rect,
          style: trkStyle,
          start: clip.inPoint || 0,
          duration: clip.duration * (clip.speed || 1), // เวลาในไฟล์จริง (คูณสปีดกลับ)
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { job_id } = await res.json();
      setTrkJob({ clipId: clip.id, status: "working", done: 0, total: 0, job_id });
      for (;;) {
        await new Promise((r) => setTimeout(r, 1000));
        const j = await (await fetch(`${BACKEND_URL}/jobs/${job_id}`)).json();
        setTrkJob({ clipId: clip.id, job_id, ...j });
        if (j.status !== "working") {
          if (j.status === "error") throw new Error(j.error);
          if (j.status === "cancelled") {
            setTrkJob(null);
            return;
          }
          updateSeqClip(clip.id, {
            path: j.out_path,
            url: `media://${encodeURIComponent(j.out_path)}`,
            name: clip.name.replace(/\.\w+$/, "") + "_track.mp4",
            inPoint: 0,
            srcDuration: clip.duration * (clip.speed || 1), // ไฟล์ใหม่ยาวเท่าช่วงจริงที่ตัดมา
          });
          break;
        }
      }
    } catch (err) {
      setTrkJob({ clipId: clip.id, status: "error", error: String(err.message || err) });
      return;
    }
    setTrkJob({ clipId: clip.id, status: "done" });
  }

  // เข้าโหมดคลิกเลือก "หน้าคนหลัก" บนจอ Program (ลากครอบหน้าคนที่จะเก็บไว้)
  // ---- สลับหน้าหลายคน: จัดการรายการ + ชี้ 'คนบนจอ' ให้แต่ละหน้า ----
  const addSwapMap = () => setSwapMaps((p) => [...p, { source: null, ref: null }]);
  const removeSwapMap = (i) => setSwapMaps((p) => (p.length > 1 ? p.filter((_, k) => k !== i) : p));
  const setSwapMapSource = (i, source) =>
    setSwapMaps((p) => p.map((m, k) => (k === i ? { ...m, source } : m)));
  const clearSwapMapRef = (i) =>
    setSwapMaps((p) => p.map((m, k) => (k === i ? { ...m, ref: null } : m)));

  function startPickSwapTarget(clip, i) {
    if (!clip) return window.alert("คลิกเลือกก้อนวิดีโอบน timeline ก่อน");
    setSwapPick({ clipId: clip.id, index: i });
  }
  // ได้กรอบจากจอ → เก็บเป็น ref (พร้อมเวลาในไฟล์จริง) ให้แถว index นั้น
  function setSwapTargetRef(clip, i, rect) {
    if (!clip || !rect) return;
    const t = (clip.inPoint || 0) + (playback.time - clip.offset) * (clip.speed || 1);
    setSwapMaps((p) =>
      p.map((m, k) => (k === i ? { ...m, ref: { t: Math.max(0, t), ...rect } } : m))
    );
  }

  function startPickKeep(clip) {
    if (!clip) {
      window.alert("คลิกเลือกก้อนวิดีโอบน timeline ก่อน");
      return;
    }
    setKeepDraw({ clipId: clip.id });
  }

  // ได้กรอบหน้าจากจอ → เก็บเป็น ref พร้อมเวลาในไฟล์จริง (แปลงจากเวลา timeline ปัจจุบัน)
  function addKeepRef(clip, rect) {
    if (!clip || !rect) return;
    const srcT = (clip.inPoint || 0) + (playback.time - clip.offset) * (clip.speed || 1);
    setKeepRefs((prev) => [...prev, { t: Math.max(0, srcT), x: rect.x, y: rect.y, w: rect.w, h: rect.h }]);
  }

  // เซ็นเซอร์ใบหน้าอัตโนมัติทั้งก้อน — AI หาหน้าคนแล้วเบลอ/โมเสกตามให้เอง ไม่ต้องจัดตำแหน่ง
  async function faceCensorClip(clip) {
    if (!clip || fcJob?.status === "working") return;
    // เป้าหมายกำหนด engine: หน้า = โมเดลที่เลือกใน dropdown / ป้ายทะเบียน / ข้อความ
    const engine =
      fcTarget === "plate" ? "censor-plate" : fcTarget === "text" ? "censor-text" : fcEngineId;
    const targetName =
      fcTarget === "plate" ? "ป้ายทะเบียนรถ" : fcTarget === "text" ? "ข้อความในภาพ" : "ใบหน้า";
    const ready = fcTarget === "face" ? fcEngines.length > 0 : !!czInstalled[engine];
    if (!ready) {
      if (window.confirm(`ยังไม่ได้ติดตั้ง AI เซ็นเซอร์${targetName}\nเปิดหน้าตั้งค่าเพื่อติดตั้งเลยไหม?`)) {
        setEngineManagerOpen(true);
      }
      return;
    }
    if (!window.confirm(`เซ็นเซอร์${targetName}ทั้งหมดในก้อนนี้อัตโนมัติ?\nAI จะหาแล้วเบลอ/โมเสกตามให้เอง (ต้นฉบับไม่ถูกแตะ)`)) return;
    setFcJob({ clipId: clip.id, status: "working", done: 0, total: 0 });
    try {
      const res = await fetch(`${BACKEND_URL}/video/face-censor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_path: clip.path,
          engine, // ตาม "เป้าหมาย" ที่เลือก (หน้า/ป้ายทะเบียน/ข้อความ)
          style: fcStyle,
          strength: fcStyle === "mosaic" ? 14 : 12,
          start: clip.inPoint || 0,
          duration: clip.duration * (clip.speed || 1),
          // เลือกคนหลักไว้ไม่เบลอ — ใช้ได้เฉพาะเป้าหมาย "ใบหน้า"
          keep: fcTarget === "face" && keepRefs.length ? { faces: keepRefs, invert: keepInvert } : null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { job_id } = await res.json();
      setFcJob({ clipId: clip.id, status: "working", done: 0, total: 0, job_id });
      for (;;) {
        await new Promise((r) => setTimeout(r, 1000));
        const j = await (await fetch(`${BACKEND_URL}/jobs/${job_id}`)).json();
        setFcJob({ clipId: clip.id, job_id, ...j });
        if (j.status !== "working") {
          if (j.status === "error") throw new Error(j.error);
          if (j.status === "cancelled") {
            setFcJob(null);
            return;
          }
          updateSeqClip(clip.id, {
            path: j.out_path,
            url: `media://${encodeURIComponent(j.out_path)}`,
            name: clip.name.replace(/\.\w+$/, "") + "_facecensor.mp4",
            inPoint: 0,
            srcDuration: clip.duration * (clip.speed || 1),
          });
          break;
        }
      }
    } catch (err) {
      setFcJob({ clipId: clip.id, status: "error", error: String(err.message || err) });
      return;
    }
    setFcJob({ clipId: clip.id, status: "done" });
  }

  // ฝังเซ็นเซอร์ลงไฟล์จริง (เบิร์นถาวร) — หา V1 ที่คร่อมช่วงก้อนเซ็นเซอร์ แล้วเบลอ/โมเสกลงไฟล์นั้น
  async function bakeCensor(censorClip) {
    if (!censorClip || censorJob?.status === "working") return;
    // ก้อนวิดีโอบน V1 ที่ทับช่วงเวลาของเซ็นเซอร์ (เซ็นเซอร์ทำงานทับ V1 เป็นหลัก)
    const cStart = censorClip.offset;
    const cEnd = censorClip.offset + censorClip.duration;
    const base = sequence.find(
      (c) => (c.track || 1) === 1 && c.type !== "text" && c.offset < cEnd && cStart < c.offset + c.duration
    );
    if (!base) {
      window.alert("ไม่พบคลิปบน V1 ตรงช่วงเซ็นเซอร์ — วางก้อนเซ็นเซอร์ให้ทับคลิปวิดีโอก่อน");
      return;
    }
    // ช่วงที่ทับกัน (บนไทม์ไลน์) → แปลงเป็นเวลาในไฟล์ต้นฉบับของ base (คูณสปีด + บวก inPoint)
    const spd = base.speed || 1;
    const oStart = Math.max(cStart, base.offset);
    const oEnd = Math.min(cEnd, base.offset + base.duration);
    const srcStart = (base.inPoint || 0) + (oStart - base.offset) * spd;
    const srcDur = (oEnd - oStart) * spd;
    // กล่อง cx/cy = จุดกึ่งกลาง %, boxW/boxH = ขนาด % → มุมซ้ายบนเป็นสัดส่วน 0–1
    const rect = {
      x: (censorClip.cx - censorClip.boxW / 2) / 100,
      y: (censorClip.cy - censorClip.boxH / 2) / 100,
      w: censorClip.boxW / 100,
      h: censorClip.boxH / 100,
    };
    setCensorJob({ clipId: censorClip.id, status: "working" });
    try {
      const res = await fetch(`${BACKEND_URL}/video/censor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_path: base.path,
          rect,
          style: censorClip.censorStyle || "blur",
          strength: censorClip.strength || 12,
          start: srcStart,
          duration: srcDur,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { job_id } = await res.json();
      for (;;) {
        await new Promise((r) => setTimeout(r, 800));
        const j = await (await fetch(`${BACKEND_URL}/jobs/${job_id}`)).json();
        setCensorJob({ clipId: censorClip.id, job_id, ...j });
        if (j.status !== "working") {
          if (j.status === "error") throw new Error(j.error);
          if (j.status === "cancelled") {
            setCensorJob(null);
            return;
          }
          // V1 ชี้ไปไฟล์ที่เบิร์นเซ็นเซอร์แล้ว (ทั้งไฟล์ถูกประมวลผล → inPoint เดิมใช้ได้) แล้วลบก้อนเซ็นเซอร์ทิ้ง
          updateSeqClip(base.id, {
            path: j.out_path,
            url: `media://${encodeURIComponent(j.out_path)}`,
            name: base.name.replace(/\.\w+$/, "") + "_censor.mp4",
          });
          removeSeqClip(censorClip.id);
          break;
        }
      }
    } catch (err) {
      setCensorJob({ clipId: censorClip.id, status: "error", error: String(err.message || err) });
      return;
    }
    setCensorJob({ clipId: censorClip.id, status: "done" });
  }
  // ลดสั่น (vid.stab) — งานต่อก้อน {clipId, status, done, total, job_id}
  const [stabJob, setStabJob] = useState(null);

  async function stabilizeClip(clip, strength = "medium") {
    if (!clip || stabJob?.status === "working") return;
    setStabJob({ clipId: clip.id, status: "working", done: 0, total: 100 });
    try {
      const res = await fetch(`${BACKEND_URL}/video/stabilize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_path: clip.path,
          strength,
          start: clip.inPoint || 0,
          duration: clip.duration,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { job_id } = await res.json();
      setStabJob({ clipId: clip.id, status: "working", done: 0, total: 100, job_id });
      for (;;) {
        await new Promise((r) => setTimeout(r, 800));
        const j = await (await fetch(`${BACKEND_URL}/jobs/${job_id}`)).json();
        setStabJob({ clipId: clip.id, job_id, ...j });
        if (j.status !== "working") {
          if (j.status === "error") throw new Error(j.error);
          if (j.status === "cancelled") {
            setStabJob(null);
            return;
          }
          updateSeqClip(clip.id, {
            path: j.out_path,
            url: `media://${encodeURIComponent(j.out_path)}`,
            name: clip.name.replace(/\.\w+$/, "") + "_stab.mp4",
            inPoint: 0,
            srcDuration: clip.duration,
            stabilized: true, // ติดธง — ปุ่มโชว์ว่าทำแล้ว
          });
          break;
        }
      }
    } catch (err) {
      setStabJob({ clipId: clip.id, status: "error", error: String(err.message || err) });
      return;
    }
    setStabJob({ clipId: clip.id, status: "done" });
  }

  const [clips, setClips] = useState([]);
  const [programClip, setProgramClip] = useState(null); // คลิปที่เลือกล่าสุด (ใช้กับ Properties)
  const [sequence, setSequence] = useState([]); // คลิปที่วางเรียงบน timeline [{id, ..., offset, duration, hidden, locked}]
  const [selectedId, setSelectedId] = useState(null); // ก้อนบน timeline ที่ถูกคลิกเลือกอยู่
  const [selectedIds, setSelectedIds] = useState([]); // โหมดเลือกหลายท่อน: ทุกก้อนที่ติดเลือกอยู่
  const sceneClipboardRef = useRef(null); // สำเนารูป/ข้อความภายใน Scene สำหรับ Ctrl+C / Ctrl+V
  const [extract, setExtract] = useState(null); // null | {status: working|done|error, ...}
  const [audioJob, setAudioJob] = useState(null); // null | {tool, status: working|done|error, ...}

  // สถานะเล่นของ Program Monitor — ส่งให้ Timeline วาด playhead ตามจริง
  const [playback, setPlayback] = useState({ time: 0, duration: 0 });
  const [isPlaying, setIsPlaying] = useState(false); // Program กำลังเล่นอยู่ไหม — Timeline ใช้ตัดสินใจ auto-follow
  const programControl = useRef(null); // Timeline สั่ง seek ผ่านตัวนี้
  const [audioMuted, setAudioMuted] = useState(false); // mute A1 จาก timeline
  const [tool, setTool] = useState("select"); // เครื่องมือ active (select/razor/...)
  const [maskRedraw, setMaskRedraw] = useState(0);
  const [maskTrackJob, setMaskTrackJob] = useState(null);
  const maskTrackRun = useRef(null);
  const maskProjectSession = useRef(0);
  const sequenceRef = useRef(sequence);
  sequenceRef.current = sequence;
  const [copiedStyle, setCopiedStyle] = useState(null); // สไตล์ที่ดูดไว้จากเครื่องมือก็อปสไตล์ (null = ยังไม่ดูด)
  // คลังเทมเพลตข้อความ (เก็บถาวรใน localStorage — อยู่ข้ามการปิดเปิดโปรแกรม)
  const [textTemplates, setTextTemplates] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("clipeasy_text_templates") || "[]");
    } catch {
      return [];
    }
  });
  const saveTemplates = (list) => {
    setTextTemplates(list);
    try {
      localStorage.setItem("clipeasy_text_templates", JSON.stringify(list));
    } catch {}
  };
  // บันทึกเทมเพลตจากก้อนที่ลากมา (payload = {text, style, transform, duration})
  function addTextTemplate(payload) {
    const tpl = {
      id: newClipId(),
      name: (payload.text || "ข้อความ").replace(/\s+/g, " ").trim().slice(0, 18) || "เทมเพลต",
      text: payload.text || "ข้อความ",
      style: { ...(payload.style || {}) },
      transform: payload.transform ? { ...payload.transform } : null,
      duration: payload.duration || 4,
    };
    saveTemplates([...textTemplates, tpl]);
  }
  const deleteTextTemplate = (id) => saveTemplates(textTemplates.filter((t) => t.id !== id));
  // เทมเพลตสไตล์ซับ: ตอนถอดเสียงจะใช้สไตล์+ตำแหน่งนี้กับซับทุกก้อน (ไม่ต้องมาแต่งซ้ำ)
  const [subtitleTpl, setSubtitleTpl] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("clipeasy_subtitle_tpl") || "null");
    } catch {
      return null;
    }
  });
  const setSubtitleTemplate = (tpl) => {
    setSubtitleTpl(tpl);
    try {
      if (tpl) localStorage.setItem("clipeasy_subtitle_tpl", JSON.stringify(tpl));
      else localStorage.removeItem("clipeasy_subtitle_tpl");
    } catch {}
  };
  // ปล่อยเทมเพลตลง timeline = สร้างก้อน text ใหม่ (คงสไตล์+ตำแหน่ง/ขนาด) ตรงเวลาที่ปล่อย
  function dropTextTemplate(tpl, at) {
    const id = newClipId();
    const dur = tpl.duration || 4;
    setSequence((prev) => [
      ...prev,
      {
        id,
        type: "text",
        name: "Text",
        text: tpl.text || "ข้อความ",
        style: { ...(tpl.style || {}) },
        ...(tpl.transform ? { transform: { ...tpl.transform } } : {}),
        track: 3,
        offset: Math.max(0, at || 0),
        duration: dur,
        inPoint: 0,
        srcDuration: dur,
      },
    ]);
    setSelectedId(id);
  }
  // ปล่อยเทมเพลตทับก้อน text เดิม = เปลี่ยนสไตล์+ตำแหน่ง/ขนาด (ข้อความ/เวลาเดิมคงไว้)
  function applyTextTemplate(clipId, tpl) {
    updateSeqClip(clipId, {
      style: { ...(tpl.style || {}) },
      ...(tpl.transform ? { transform: { ...tpl.transform } } : {}),
    });
  }
  // เปลี่ยนเครื่องมือ = ล้างสไตล์ที่ดูดค้างไว้ (เริ่มดูดใหม่ทุกครั้งที่กลับมาใช้)
  function selectTool(key) {
    if (key !== "copystyle") setCopiedStyle(null);
    if (key === 'mask') {
      programControl.current?.pause?.();
      const selected = sequence.find(c => c.id === selectedId);
      if (selected && !['image', 'scene', 'text', 'audio', 'layout'].includes(selected.type)) openMaskEditor(selected);
    }
    setTool(key);
  }

  function openMaskEditor(clip, redraw = false) {
    if (!clip || clip.locked || ['image', 'scene', 'text', 'audio', 'layout'].includes(clip.type)) return;
    programControl.current?.pause?.();
    setSelectedId(clip.id);
    if (playback.time < clip.offset || playback.time >= clip.offset + clip.duration)
      programControl.current?.seekTo(clip.offset);
    setTool('mask');
    if (redraw) {
      if (maskTrackRun.current?.clipId === clip.id) stopMaskTrack(maskTrackRun.current, { clearStatus: true });
      setMaskRedraw({ clipId: clip.id, revision: Date.now() });
    } else setMaskRedraw(0);
  }
  function commitMask(clip, points, sourceTime) {
    if (clip.locked || !points || points.length < 3) return;
    if (maskTrackRun.current?.clipId === clip.id) stopMaskTrack(maskTrackRun.current, { clearStatus: true });
    const t = clip.transform || {}, fx = maskControlSettings(t, clip.duration);
    if (fx.center) fx.center = transformPoint(fx.center, maskMatrixAt(t, sourceTime));
    updateSeqClip(clip.id, { transform: { ...t, fxMaskPath: points, fxMaskRect: maskBounds(points),
      fxMaskTime: sourceTime, fxMaskTrack: [], fxMaskShowGuide: true, maskFx: fx } });
    setMaskTrackJob(job => job?.clipId === clip.id ? null : job);
  }
  function deleteMask(clip) {
    if (!clip || clip.locked) return;
    if (maskTrackRun.current?.clipId === clip.id) stopMaskTrack(maskTrackRun.current, { clearStatus: true });
    const t = { ...(clip.transform || {}) };
    ['fxMaskPath', 'fxMaskRect', 'fxMaskTime', 'fxMaskTrack', 'fxMaskShowGuide', 'maskFx'].forEach(k => delete t[k]);
    updateSeqClip(clip.id, { transform: t });
    setMaskTrackJob(job => job?.clipId === clip.id ? null : job);
  }
  function maskTrackInputKey(clip) {
    return JSON.stringify([clip?.path, clip?.transform?.fxMaskPath,
      clip?.transform?.fxMaskTime ?? clip?.inPoint ?? 0, clip?.inPoint || 0,
      clip?.duration, clip?.speed || 1]);
  }
  function maskTrackClip(run, items = sequenceRef.current) {
    if (run.cancelled || run.session !== maskProjectSession.current) return null;
    const clip = items.find(c => c.id === run.clipId);
    return clip && !clip.locked && hasMask(clip.transform) && maskTrackInputKey(clip) === run.inputKey ? clip : null;
  }
  function stopMaskTrack(run, { clearStatus = false, silent = false } = {}) {
    if (!run) return;
    run.cancelled = true;
    run.pollController?.abort();
    if (maskTrackRun.current === run) {
      maskTrackRun.current = null;
      if (!silent) setMaskTrackJob(clearStatus ? null : { clipId: run.clipId, status: 'cancelled' });
    }
    // The start request may still be returning a job id. Its continuation calls
    // this again once the id is known, without touching a newer run's UI state.
    if (run.jobId && !run.cancelSent) {
      run.cancelSent = true;
      fetch(`${BACKEND_URL}/jobs/${run.jobId}/cancel`, { method: 'POST' }).catch(() => {});
    }
  }
  function resetMaskSession() {
    maskProjectSession.current += 1;
    stopMaskTrack(maskTrackRun.current, { clearStatus: true });
    setMaskTrackJob(null);
    setMaskRedraw(0);
    setTool('select');
  }
  async function trackMask(clip) {
    if (!clip || clip.locked || !hasMask(clip.transform) || maskTrackRun.current) return;
    programControl.current?.pause?.();
    const run = { clipId: clip.id, inputKey: maskTrackInputKey(clip), session: maskProjectSession.current,
      cancelled: false, pollController: new AbortController() };
    maskTrackRun.current = run;
    setMaskTrackJob({ clipId: clip.id, status: 'working', done: 0, total: 0 });
    try {
      const response = await fetch(`${BACKEND_URL}/video/mask-track`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        video_path: clip.path, points: clip.transform.fxMaskPath, reference_time: clip.transform.fxMaskTime ?? clip.inPoint ?? 0,
        start: clip.inPoint || 0, duration: clip.duration * (clip.speed || 1),
      }) });
      if (!response.ok) throw new Error(await response.text());
      run.jobId = (await response.json()).job_id;
      if (!run.jobId) throw new Error('Tracking did not return a job id');
      if (maskTrackRun.current !== run || !maskTrackClip(run)) { stopMaskTrack(run); return; }
      for (;;) {
        await new Promise(r => setTimeout(r, 350));
        if (maskTrackRun.current !== run || !maskTrackClip(run)) { stopMaskTrack(run); return; }
        const res = await fetch(`${BACKEND_URL}/jobs/${run.jobId}`, { signal: run.pollController.signal });
        if (!res.ok) throw new Error(await res.text());
        const job = await res.json();
        if (maskTrackRun.current !== run || !maskTrackClip(run)) { stopMaskTrack(run); return; }
        if (job.status === 'working') { setMaskTrackJob({ ...job, clipId: clip.id }); continue; }
        if (job.status === 'cancelled') { setMaskTrackJob({ clipId: clip.id, status: 'cancelled' }); break; }
        if (job.status !== 'done') throw new Error(job.error || 'Tracking failed');
        setSequence(items => {
          const latest = maskTrackClip(run, items);
          if (!latest) return items;
          return items.map(item => item.id === run.clipId ? { ...item, transform: { ...latest.transform, fxMaskTrack: job.mask_track,
            maskFx: { ...maskControlSettings(latest.transform, latest.duration), trackingEnabled: true } } } : item);
        });
        setMaskTrackJob({ clipId: clip.id, status: 'done', lostFrames: job.lost_frames || 0 });
        break;
      }
    } catch (e) {
      if (maskTrackRun.current === run && !run.cancelled) {
        if (!maskTrackClip(run)) stopMaskTrack(run);
        else setMaskTrackJob({ clipId: clip.id, status: 'error', error: String(e.message || e) });
      }
    }
    finally { if (maskTrackRun.current === run) maskTrackRun.current = null; }
  }
  function cancelMaskTrack() {
    stopMaskTrack(maskTrackRun.current);
  }
  useEffect(() => {
    const run = maskTrackRun.current;
    if (run && !maskTrackClip(run)) stopMaskTrack(run);
  }, [sequence]);
  useEffect(() => () => {
    maskProjectSession.current += 1;
    stopMaskTrack(maskTrackRun.current, { silent: true });
  }, []);
  useEffect(() => {
    const key = e => {
      if (e.target.closest?.('input,textarea,select,[contenteditable=true]') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'KeyG') { e.preventDefault(); selectTool(tool === 'mask' ? 'select' : 'mask'); }
      if (tool === 'mask' && e.key === 'Escape') { e.preventDefault(); setTool('select'); }
      if (tool === 'mask' && e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [tool, selectedId, sequence, playback.time]);
  const [cutRange, setCutRange] = useState(null); // ช่วงที่เลือกใน timeline — เล่นวนเฉพาะช่วงนี้

  // ขนาดพาเนล (px) — ลากเส้นคั่นเพื่อปรับ
  const [srcW, setSrcW] = useState(380); // Source Monitor
  const [propW, setPropW] = useState(280); // Properties
  const [projW, setProjW] = useState(300); // Project panel
  const [middleH, setMiddleH] = useState(() =>
    Math.max(260, Math.round((window.innerHeight - 44) * 0.55))
  ); // ความสูงแถวจอ monitor

  async function handleImport() {
    if (!window.aiclip?.openVideoDialog) {
      alert("การ import ใช้ได้เฉพาะตอนรันเป็นแอป Electron (npm run electron:dev)");
      return;
    }
    let paths = await window.aiclip.openVideoDialog();
    if (!paths.length) return;
    if (project?.dirPath && window.aiclip?.copyProjectMedia) paths = await window.aiclip.copyProjectMedia(project.dirPath, paths);
    const newClips = paths.map((p) => ({
      name: p.split(/[\\/]/).pop(),
      path: p,
      url: `media://${encodeURIComponent(p)}`,
    }));
    // แค่เพิ่มเข้าลิสต์โปรเจกต์ ไม่เอาไปทับคลิปที่เปิดอยู่ใน Program
    setClips((prev) => [...prev, ...newClips.filter((c) => !prev.some((x) => x.path === c.path))]);
  }

  // ---- Frame Browser: ดูเฟรมที่แตกแล้ว เอารูปแทนเฟรม แล้วประกอบกลับ ----
  const [frameCtx, setFrameCtx] = useState(null); // {clipId, path, start, duration}
  const [frameBrowserOpen, setFrameBrowserOpen] = useState(false);
  const [rebuildJob, setRebuildJob] = useState(null);

  // เลือกรูปจากเครื่องมาแทนเฟรมที่เลือก แล้วสั่งรีเฟรชภาพในตาราง
  async function replaceFrame(frameNo, refresh) {
    if (!extract?.frames_dir || !window.aiclip?.openMediaDialog) return;
    let paths = await window.aiclip.openMediaDialog();
    if (project?.dirPath && paths.length && window.aiclip?.copyProjectMedia) paths = await window.aiclip.copyProjectMedia(project.dirPath, paths);
    const img = paths.find((p) => /\.(png|jpe?g|webp|bmp)$/i.test(p));
    if (!img) return;
    const res = await fetch(`${BACKEND_URL}/frames/replace`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frames_dir: extract.frames_dir, frame: frameNo, image_path: img }),
    });
    if (res.ok) refresh();
    else alert(`แทนเฟรมไม่สำเร็จ: ${await res.text()}`);
  }

  // ประกอบเฟรมกลับเป็นวิดีโอ แล้วเอาไปแทนก้อนเดิมบน timeline
  async function rebuildFrames() {
    if (!extract?.frames_dir || !frameCtx || rebuildJob?.status === "working") return;
    setRebuildJob({ status: "working" });
    try {
      const res = await fetch(`${BACKEND_URL}/frames/rebuild`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          frames_dir: extract.frames_dir,
          video_path: frameCtx.path,
          start: frameCtx.start,
          duration: frameCtx.duration,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { job_id } = await res.json();
      for (;;) {
        await new Promise((r) => setTimeout(r, 900));
        const j = await (await fetch(`${BACKEND_URL}/jobs/${job_id}`)).json();
        if (j.status !== "working") {
          if (j.status === "error") throw new Error(j.error);
          if (frameCtx.clipId) {
            const clip = sequence.find((c) => c.id === frameCtx.clipId);
            updateSeqClip(frameCtx.clipId, {
              path: j.out_path,
              url: `media://${encodeURIComponent(j.out_path)}`,
              name: (clip?.name || "clip").replace(/\.\w+$/, "") + "_edit.mp4",
              inPoint: 0,
              srcDuration: clip?.duration ?? frameCtx.duration,
            });
          }
          break;
        }
      }
      setRebuildJob(null);
      setFrameBrowserOpen(false);
    } catch (err) {
      setRebuildJob({ status: "error", error: String(err.message || err) });
    }
  }

  // ---- Media Browser: รูปภาพ + เสียงจากข้างนอก ----
  const [media, setMedia] = useState([]); // [{name, path, url, kind: image|audio}]

  const loadProject = (opened) => {
    if (!opened) return;
    resetMaskSession();
    setProjectReady(false);
    setProject(opened);
    setClips(opened.data?.clips || []);
    setMedia(opened.data?.media || []);
    setSequence(opened.data?.sequence || []);
    setSelectedId(null); setSelectedIds([]); setPlayback({ time: 0, duration: 0 });
    setTimeout(() => setProjectReady(true), 0);
  };
  const createProject = async (name, parentDir) => {
    const created = await window.aiclip?.createProject?.(name, parentDir);
    if (created) loadProject(created);
  };
  const openProject = async () => loadProject(await window.aiclip?.openProject?.());
  const openRecentProject = async (filePath) => loadProject(await window.aiclip?.openRecentProject?.(filePath));

  useEffect(() => {
    if (saveMode !== "auto" || !project?.filePath || !projectReady || !window.aiclip?.saveProject) return;
    const timer = setTimeout(() => {
      const next = { ...project, data: { ...(project.data || {}), clips, media, sequence } };
      window.aiclip.saveProject(next)
        .then((r) => r?.updatedAt && setProject((p) => p ? { ...p, updatedAt: r.updatedAt, data: next.data } : p))
        .catch((err) => setSaveNotice({ type: "error", text: `บันทึกอัตโนมัติไม่สำเร็จ: ${err?.message || err}` }));
    }, 500);
    return () => clearTimeout(timer);
  }, [clips, media, sequence, projectReady, saveMode]);

  const saveProjectNow = async () => {
    if (!project?.filePath || !window.aiclip?.saveProject) {
      setSaveNotice({ type: "error", text: "ยังไม่มีไฟล์โปรเจกต์สำหรับบันทึก" });
      return;
    }
    try {
      const latest = { ...project, data: { ...(project.data || {}), clips, media, sequence } };
      const r = await window.aiclip.saveProject(latest);
      if (!r?.ok) throw new Error("ระบบไม่ยืนยันการเขียนไฟล์");
      setProject((p) => p ? { ...p, updatedAt: r.updatedAt || p.updatedAt, data: latest.data } : p);
      setSaveNotice({ type: "success", text: `บันทึกโปรเจกต์แล้ว • ${new Date(r.updatedAt).toLocaleTimeString("th-TH")}` });
    } catch (err) {
      setSaveNotice({ type: "error", text: `บันทึกไม่สำเร็จ: ${err?.message || err}` });
    }
  };

  useEffect(() => {
    if (!saveNotice) return;
    const timer = setTimeout(() => setSaveNotice(null), saveNotice.type === "error" ? 6000 : 2600);
    return () => clearTimeout(timer);
  }, [saveNotice]);

  useEffect(() => {
    const cleanups = [];
    if (window.aiclip?.onSaveProject) cleanups.push(window.aiclip.onSaveProject(saveProjectNow));
    if (window.aiclip?.onOpenSettings) cleanups.push(window.aiclip.onOpenSettings(() => {
      setSettingsStartPage("general");
      setEngineManagerOpen(true);
    }));
    return () => cleanups.forEach((fn) => fn?.());
  }, [project, clips, media, sequence]);

  useEffect(() => {
    if (!window.aiclip?.onGoHome) return;
    return window.aiclip.onGoHome(async () => {
      resetMaskSession();
      if (project?.filePath && window.aiclip?.saveProject) {
        const latest = { ...project, data: { ...(project.data || {}), clips, media, sequence } };
        try { await window.aiclip.saveProject(latest); } catch {}
      }
      setIsPlaying(false);
      setProjectReady(false);
      setProject(null);
    });
  }, [project, clips, media, sequence]);

  async function importMedia() {
    if (!window.aiclip?.openMediaDialog) {
      alert("การ import ใช้ได้เฉพาะตอนรันเป็นแอป Electron");
      return;
    }
    const paths = await window.aiclip.openMediaDialog();
    const items = paths.map((p) => {
      const name = p.split(/[\\/]/).pop();
      const kind = /\.(png|jpe?g|webp|gif|bmp)$/i.test(name) ? "image" : "audio";
      return { name, path: p, url: `media://${encodeURIComponent(p)}`, kind };
    });
    setMedia((prev) => [...prev, ...items.filter((m) => !prev.some((x) => x.path === m.path))]);
  }

  function deleteMedia(item) {
    setMedia((prev) => prev.filter((m) => m.path !== item.path));
    setSequence((prev) => prev.filter((c) => c.path !== item.path));
  }

  // ยืด/หดก้อนบน timeline — วิดีโอ/เสียงยึดเฟรมจริงในไฟล์:
  // กางออกเกินความยาวจริงไม่ได้ (หุบเข้าได้) และลากขอบซ้าย = เลื่อนจุด in ในไฟล์จริง
  function resizeClip(id, patch) {
    setSequence((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        let offset = patch.offset ?? c.offset;
        let duration = patch.duration ?? c.duration;
        // รูปภาพ/ข้อความไม่มีเฟรมจริง ยืดได้อิสระ
        if (c.type === "image" || c.type === "text" || c.type === "scene")
          return { ...c, offset, duration }; // ไม่มีเฟรมจริง ยืดได้อิสระ

        const src = c.srcDuration ?? c.duration;
        let inPoint = c.inPoint || 0;
        if (patch.offset !== undefined) {
          // ขอบซ้าย: ตำแหน่งที่ขยับ = เนื้อไฟล์ที่ถูกตัดหัว/คืนหัว
          const delta = offset - c.offset;
          inPoint += delta;
          if (inPoint < 0) {
            // กางซ้ายได้มากสุดแค่หัวไฟล์จริง
            offset -= inPoint;
            duration += inPoint;
            inPoint = 0;
          }
        }
        // ขอบขวา: ยาวสุดเท่าเฟรมจริงที่เหลือจากจุด in
        duration = Math.max(0.1, Math.min(duration, src - inPoint));
        return { ...c, offset, duration, inPoint };
      })
    );
  }

  // วาง media ลง timeline — รูป/เสียงห้ามลงเลนหลัก (V1 เป็นวิดีโอ) → ดันขึ้นเลนซ้อนแทน
  // at = เวลาที่ปล่อยเมาส์: รูปวางทับช่วงเฟรมที่ต้องการได้ตรงจุด (null = ต่อท้าย)
  async function dropMedia(path, track = 2, at = null) {
    const item = media.find((m) => m.path === path);
    if (!item) return;
    const t = track === 1 ? 2 : Math.min(3, Math.max(2, track));
    let dur = 5; // รูปภาพ: ค่าเริ่ม 5 วิ (ยืด/หดได้บน timeline)
    if (item.kind === "audio") {
      dur = await probeDuration(item.url);
      if (!dur) return;
    }
    setSequence((prev) => [
      ...prev,
      {
        ...item,
        type: item.kind,
        id: `tc${clipIdCounter++}`,
        track: t,
        offset:
          at != null
            ? Math.max(0, at)
            : seqEnd(prev.filter((c) => (c.track || 1) === t)),
        duration: dur,
        inPoint: 0,
        srcDuration: item.kind === "audio" ? dur : 1e9, // รูปยืดได้ไม่จำกัด
      },
    ]);
  }

  // ต่อคลิปเข้าท้าย sequence บน timeline (วัดความยาวจาก metadata ก่อน)
  // track 1 = V1 (หลัก) / track 2 = V2 (ซ้อนทับแบบ PiP) — ต่อท้ายเฉพาะแทร็กตัวเอง
  async function appendToTimeline(clip, track = 1) {
    const dur = await probeDuration(clip.url);
    if (!dur) return;
    // fps จริงจากไฟล์ (ffprobe ฝั่ง backend) — ใช้โชว์จำนวนเฟรมให้ตรงกับงาน AI จริง
    let fps = clip.fps;
    if (!fps) {
      try {
        fps = (await (await fetch(`${BACKEND_URL}/video/fps?path=${encodeURIComponent(clip.path)}`)).json()).fps;
      } catch {
        fps = null; // backend ไม่รัน/อ่านไม่ได้ — Properties จะประมาณที่ 30
      }
    }
    setSequence((prev) => [
      ...prev,
      // inPoint/srcDuration: จุดเริ่มในไฟล์ต้นฉบับ + ความยาวไฟล์เต็ม (ใช้ตอนแบ่งคลิป)
      {
        ...clip,
        id: `tc${clipIdCounter++}`,
        track,
        offset: seqEnd(prev.filter((c) => (c.track || 1) === track)), // ต่อท้ายในแทร็กเดียวกัน
        duration: dur,
        inPoint: 0,
        srcDuration: dur,
        fps, // fps จริงของไฟล์ (null = ไม่รู้) — ท่อนที่ถูกแบ่ง/ก๊อปสืบทอดค่านี้ผ่าน spread
      },
    ]);
    setProgramClip(clip);
    setExtract(null);
  }

  // ดับเบิลคลิกใน Project = เริ่ม sequence ใหม่ด้วยคลิปนี้ / ลากมาวาง = ต่อท้าย
  function openClip(clip) {
    setSequence([]);
    setCutRange(null);
    appendToTimeline(clip);
  }

  // ลบคลิปออกจากโปรเจกต์ — เอาออกจาก timeline ด้วยถ้าวางอยู่
  function deleteClip(clip) {
    setClips((prev) => prev.filter((c) => c.path !== clip.path));
    setSequence((prev) => {
      // ลบแล้วเว้นที่ว่างไว้ ไม่ดึงคลิปอื่นมาชิด
      const next = prev.filter((c) => c.path !== clip.path);
      if (next.length !== prev.length) setCutRange(null);
      if (!next.length) setPlayback({ time: 0, duration: 0 });
      return next;
    });
    if (programClip?.path === clip.path) {
      setProgramClip(null);
      setExtract(null);
    }
  }

  // รับคลิปที่ถูกลากมาวาง (จาก ProjectPanel) → ต่อท้ายแทร็กที่วางลง (V1 หรือ V2)
  function dropClip(path, track = 1) {
    const clip = clips.find((c) => c.path === path);
    if (clip) appendToTimeline(clip, track);
  }

  // แบ่งคลิปที่คร่อมเวลา t ออกเป็นสองท่อน (ไม่ระบุ = ตรงเส้น playhead)
  function splitAt(t = playback.time) {
    setSequence((prev) => {
      const crosses = (c) => t > c.offset + 0.05 && t < c.offset + c.duration - 0.05;
      let i = prev.findIndex((c) => c.id === selectedId && crosses(c));
      if (i === -1) i = prev.findIndex(crosses);
      if (i === -1) return prev; // เส้นไม่ได้คร่อมกลางคลิปไหน
      const c = prev[i];
      const at = t - c.offset; // จุดแบ่ง นับจากต้นคลิปท่อนนี้
      const head = { ...c, id: `tc${clipIdCounter++}`, duration: at };
      const tail = {
        ...c,
        id: `tc${clipIdCounter++}`,
        // at เป็นวินาทีบน timeline → แปลงเป็นวินาทีในไฟล์ด้วยสปีดของก้อน
        inPoint: (c.inPoint || 0) + at * (c.speed || 1),
        duration: c.duration - at,
        offset: c.offset + at, // ท่อนหลังเริ่มตรงจุดแบ่งพอดี
      };
      return [...prev.slice(0, i), head, tail, ...prev.slice(i + 1)];
    });
  }

  function detachAudio(clipId = selectedId) {
    setSequence((prev) => {
      const source = prev.find((c) => c.id === clipId);
      if (!source || ["audio", "image", "text", "scene"].includes(source.type) || source.audioDetached) return prev;
      const audio = { ...source, id: `tc${clipIdCounter++}`, type: "audio", name: `${source.name || "Video"} — Audio`, linkedSourceId: source.id, audioDetached: false, transform: undefined };
      return [...prev.map((c) => c.id === source.id ? { ...c, audioDetached: true } : c), audio];
    });
  }

  // รวมท่อนวิดีโอบนเลนเดียวกันเป็นไฟล์เดียวเนื้อเดียว (เรียงตามตำแหน่ง ช่องว่างถูกตัดชิด)
  // ใช้เลนของก้อนที่เลือกอยู่ ไม่ได้เลือก = V1 — ได้ไฟล์ใหม่มาแทนทุกท่อนบนเลนนั้น
  const [mergeJob, setMergeJob] = useState(null);

  // รวมเฉพาะท่อนที่เลือกไว้ (โหมดเลือกหลายท่อน) — เรียงตามตำแหน่งบน timeline
  function mergeSelected() {
    const parts = sequence
      .filter((c) => selectedIds.includes(c.id) && c.type !== "text" && c.type !== "layout" && c.type !== "image" && c.type !== "scene")
      .sort((a, b) => a.offset - b.offset);
    if (parts.length < 2) {
      window.alert("เลือกวิดีโออย่างน้อย 2 ท่อนก่อน (กดเครื่องมือเลือกหลายท่อน แล้วคลิกทีละก้อน)");
      return;
    }
    mergeClips(parts, `รวม ${parts.length} ท่อนที่เลือกเป็นคลิปเดียว?`).then(() => setSelectedIds([]));
  }

  async function mergeClips(parts, confirmMsg) {
    if (mergeJob?.status === "working") return;
    if (!window.confirm(`${confirmMsg}\nช่องว่างระหว่างท่อนจะถูกตัดชิด (ต้นฉบับไม่ถูกแตะ)`))
      return;
    setMergeJob({ status: "working", done: 0 });
    try {
      const res = await fetch(`${BACKEND_URL}/video/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segments: parts.map((c) => ({
            path: c.path,
            start: c.inPoint || 0,
            duration: c.duration * (c.speed || 1), // วินาทีในไฟล์จริง
            speed: c.speed || 1,
          })),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { job_id } = await res.json();
      for (;;) {
        await new Promise((r) => setTimeout(r, 1000));
        const j = await (await fetch(`${BACKEND_URL}/jobs/${job_id}`)).json();
        setMergeJob({ job_id, ...j });
        if (j.status !== "working") {
          if (j.status === "error") throw new Error(j.error);
          if (j.status === "cancelled") {
            setMergeJob(null);
            return;
          }
          // แทนทุกท่อนบนเลนด้วยก้อนเดียว เริ่มที่ตำแหน่งท่อนแรก ยาวเท่าผลรวม (หน่วย timeline)
          const totalDur = parts.reduce((s, c) => s + c.duration, 0);
          const first = parts[0];
          setSequence((prev) => [
            ...prev.filter((c) => !parts.some((p) => p.id === c.id)),
            {
              ...first,
              id: newClipId(),
              path: j.out_path,
              url: `media://${encodeURIComponent(j.out_path)}`,
              name: first.name.replace(/\.\w+$/, "") + "_merged.mp4",
              offset: first.offset,
              inPoint: 0,
              duration: totalDur,
              srcDuration: totalDur,
              speed: 1, // สปีดถูกฝังลงไฟล์ใหม่แล้ว
            },
          ]);
          break;
        }
      }
    } catch (err) {
      setMergeJob({ status: "error", error: String(err.message || err) });
      window.alert("รวมท่อนไม่สำเร็จ: " + String(err.message || err));
      return;
    }
    setMergeJob(null);
  }

  // ลบช่วงเวลา start–end ออกจากทุกเลน (จากโซนน้ำเงินของเครื่องมือ Razor → คลิกขวา)
  // ก้อนที่คร่อมขอบช่วงถูกผ่าอัตโนมัติ เหลือเฉพาะส่วนนอกช่วง / ripple = เลื่อนก้อนหลังช่วงมาชิด
  function deleteRange(start, end, ripple = false) {
    const len = end - start;
    if (len <= 0) return;
    setSequence((prev) => {
      let next = [];
      for (const c of prev) {
        const cEnd = c.offset + c.duration;
        if (cEnd <= start + 0.001 || c.offset >= end - 0.001) {
          next.push(c); // อยู่นอกช่วง — เก็บไว้ทั้งก้อน
          continue;
        }
        const spd = c.speed || 1;
        if (c.offset < start) {
          // เหลือหัวก้อนส่วนที่อยู่ก่อนช่วง
          next.push({ ...c, id: newClipId(), duration: start - c.offset });
        }
        if (cEnd > end) {
          // เหลือท้ายก้อนส่วนที่อยู่หลังช่วง — ขยับ inPoint ตามเวลาในไฟล์จริง
          next.push({
            ...c,
            id: newClipId(),
            inPoint: (c.inPoint || 0) + (end - c.offset) * spd,
            offset: end,
            duration: cEnd - end,
          });
        }
        // ก้อนที่จมทั้งก้อนในช่วง = หายไปเลย
      }
      if (ripple) {
        next = next.map((c) =>
          c.offset >= end - 0.001 ? { ...c, offset: Math.max(0, c.offset - len) } : c
        );
      }
      return next;
    });
    setSelectedId(null);
  }

  // ย้ายตำแหน่งคลิปบน timeline (จากการลากก้อนใน Timeline)
  // ถ้าตำแหน่งใหม่ทับคลิปอื่น → ดันก้อนที่ขวางถอยไปทางขวาให้พ้น (สลับก้อนที่ชิดกันได้)
  function moveClip(id, offset, track) {
    setSequence((prev) => {
      const me = prev.find((c) => c.id === id);
      if (!me) return prev;
      const myTrack = track || me.track || 1; // ลากข้ามเลน V1↔V2 ได้ — ใช้เลนปลายทาง
      // การชน/ดัน คิดเฉพาะก้อนในแทร็กเดียวกัน — คนละแทร็กซ้อนเวลากันได้ (นั่นคือจุดประสงค์ของ V2)
      const same = (c) => (c.id === id ? myTrack : c.track || 1) === myTrack;
      let o = Math.max(0, offset);
      // ปล่อยทับก้อนอื่น → ดูจุดกึ่งกลางว่าจะแทรกหน้าหรือหลังก้อนนั้น
      for (const c of prev) {
        if (c.id !== id && same(c) && o < c.offset + c.duration && o + me.duration > c.offset) {
          const insertBefore = o + me.duration / 2 < c.offset + c.duration / 2;
          o = insertBefore ? Math.max(0, c.offset - me.duration) : c.offset + c.duration;
          break;
        }
      }
      const items = prev
        .filter(same)
        .map((c) => (c.id === id ? { ...c, offset: o, track: myTrack } : { ...c }))
        // ตำแหน่งเท่ากันให้ก้อนที่ถูกลากมาก่อน — ก้อนเดิมจะโดนดันไปขวา
        .sort((a, b) => a.offset - b.offset || (a.id === id ? -1 : b.id === id ? 1 : 0));
      // ยังทับกันอยู่ตรงไหน → ดันก้อนหลังถอยขวาให้พ้นเป็นทอดๆ
      for (let i = 1; i < items.length; i++) {
        const before = items[i - 1];
        if (items[i].offset < before.offset + before.duration) {
          items[i].offset = before.offset + before.duration;
        }
      }
      return [...items, ...prev.filter((c) => !same(c))];
    });
  }

  const seqTotal = seqEnd(sequence);
  // โปรเจกต์ว่างยังมีพื้นที่ทำงาน 5 นาที และคงสเกลเริ่มต้นของ ruler เป็นระดับนาที
  // ใช้เฉพาะพื้นที่ Timeline — ความยาวการเล่น/ส่งออกยังอิงจากคลิปจริงใน sequence
  const timelineDuration = Math.max(5 * 60, seqTotal);
  const sceneChildren = sequence.flatMap((scene) =>
    scene.type === "scene"
      ? (scene.children || []).map((child) => ({
          ...child,
          sceneId: scene.id,
          sceneLocalOffset: child.offset || 0,
          sceneDuration: scene.duration,
          offset: scene.offset + (child.offset || 0),
          duration: Math.min(child.duration || scene.duration, scene.duration - (child.offset || 0)),
        }))
      : []
  );
  const selectedClip = sequence.find((c) => c.id === selectedId) ?? sceneChildren.find((c) => c.id === selectedId) ?? null;

  // คัดลอกลูกภายใน Scene โดยไม่แตะ system clipboard (กันข้อมูลรูป/ข้อความในช่องพิมพ์ถูกทับ)
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const tag = e.target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || e.target?.isContentEditable) return;
      // ใช้ physical key code เพื่อให้ Ctrl+C/V ทำงานแม้คีย์บอร์ดกำลังอยู่ภาษาไทย
      const isCopy = e.code === "KeyC" || e.key.toLowerCase() === "c";
      const isPaste = e.code === "KeyV" || e.key.toLowerCase() === "v";
      if (isCopy) {
        const scene = sequence.find((s) => s.children?.some((child) => child.id === selectedId));
        const child = scene?.children.find((item) => item.id === selectedId);
        if (!scene || !child) return;
        e.preventDefault();
        sceneClipboardRef.current = { sceneId: scene.id, child: structuredClone(child) };
      }
      if (isPaste) {
        const copied = sceneClipboardRef.current;
        if (!copied) return;
        const targetScene = sequence.find((s) => s.id === copied.sceneId);
        if (!targetScene) return;
        e.preventDefault();
        const id = newClipId();
        const child = structuredClone(copied.child);
        child.id = id;
        child.name = `${child.name || (child.type === "text" ? "Text" : "Image")} copy`;
        child.transform = {
          ...(child.transform || {}),
          x: (child.transform?.x || 0) + 20,
          y: (child.transform?.y || 0) + 20,
        };
        setSequence((prev) => prev.map((scene) => scene.id === copied.sceneId
          ? { ...scene, children: [...(scene.children || []), child] }
          : scene));
        setSelectedId(id);
        setSelectedIds([id]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sequence, selectedId]);

  // คลิกเลือกก้อนบน timeline → โชว์คุณสมบัติใน Properties (null = คลิกพื้นว่าง ยกเลิกเลือก)
  function selectClip(clip) {
    // เครื่องมือก็อปสไตล์ข้อความ: คลิกแรกดูดสไตล์ คลิกถัดไปทับสไตล์ให้ก้อน text อื่น (ใช้ได้เฉพาะก้อน text)
    if (tool === "copystyle" && clip?.type === "text") {
      if (!copiedStyle) {
        setCopiedStyle({ ...(clip.style || {}) }); // ดูดสไตล์ต้นแบบ → เข้าสู่โหมด "พร้อมทับ"
      } else {
        updateSeqClip(clip.id, { style: { ...copiedStyle } }); // ทับสไตล์ (ยังอยู่โหมดทับ ทาต่อได้)
      }
      return; // ไม่เปลี่ยน selection ตามปกติ
    }
    // เครื่องมือเลือกหลายท่อน: คลิกก้อน = สลับติด/ปลดเลือก โดยไม่ยกเลิกก้อนที่เลือกไว้แล้ว
    if (tool === "multi" && clip) {
      setSelectedIds((prev) =>
        prev.includes(clip.id) ? prev.filter((id) => id !== clip.id) : [...prev, clip.id]
      );
      setSelectedId(clip.id);
      setProgramClip(clip);
      return;
    }
    setSelectedId(clip?.id ?? null);
    setSelectedIds(clip ? [clip.id] : []); // โหมดปกติ/คลิกพื้นว่าง = เหลือก้อนเดียว/ล้างหมด
    if (clip) setProgramClip(clip);
  }

  // แก้คุณสมบัติรายก้อน เช่น {hidden: true} / {locked: true}
  function updateSeqClip(id, patch) {
    const run = maskTrackRun.current;
    if (run?.clipId === id) {
      const current = sequenceRef.current.find(c => c.id === id);
      const next = current && { ...current, ...patch };
      if (!next || next.locked || maskTrackInputKey(next) !== run.inputKey) stopMaskTrack(run);
    }
    setSequence((prev) => prev.map((c) => {
      if (c.id === id) return { ...c, ...patch };
      if (!c.children?.some((child) => child.id === id)) return c;
      return { ...c, children: c.children.map((child) => child.id === id ? { ...child, ...patch } : child) };
    }));
  }

  function addMediaToScene(sceneId, path) {
    const item = media.find((m) => m.path === path);
    if (!item || item.kind !== "image") return;
    // รูปเข้า Scene แบบย่อเพื่อให้จัดวางได้ทันที แต่พิกัดจะยึดกับเฟรมวิดีโอ
    const child = { ...item, id: newClipId(), type: "image", offset: 0, duration: 5, transform: { scale: 45, x: 0, y: 0 } };
    setSequence((prev) => prev.map((c) => c.id === sceneId ? { ...c, children: [...(c.children || []), { ...child, duration: c.duration }] } : c));
    setSelectedId(child.id);
  }

  function moveTextIntoScene(sceneId, textId) {
    setSequence((prev) => {
      const text = prev.find((c) => c.id === textId && c.type === "text");
      if (!text) return prev;
      return prev.filter((c) => c.id !== textId).map((c) => c.id === sceneId
        ? { ...c, children: [...(c.children || []), { ...text, track: undefined, offset: 0, duration: Math.min(text.duration, c.duration), transform: { ...(text.transform || {}), scale: text.transform?.scale ?? 70 } }] }
        : c);
    });
    setSelectedId(textId);
  }

  // ปรับสปีดเฉพาะก้อน — เนื้อไฟล์ช่วงเดิม เล่นเร็ว/ช้าลง ความยาวบน timeline เปลี่ยนตาม
  // ก้อนที่อยู่ถัดไปเลื่อนตามเท่าที่ความยาวเปลี่ยน (แบบ CapCut) — ช่องว่างที่เว้นไว้เดิมคงระยะเดิม
  function setClipSpeed(id, speed) {
    setSequence((prev) => {
      const me = prev.find((c) => c.id === id);
      if (!me) return prev;
      const oldDur = me.duration;
      const newDur = (oldDur * (me.speed || 1)) / speed;
      const delta = newDur - oldDur;
      const oldEnd = me.offset + oldDur;
      return prev.map((c) => {
        if (c.id === id) return { ...c, speed, duration: newDur };
        // ทุกก้อนที่เริ่มตั้งแต่ท้ายก้อนนี้เป็นต้นไป ขยับตามความยาวที่เปลี่ยน
        if (c.offset >= oldEnd - 0.001) return { ...c, offset: Math.max(0, c.offset + delta) };
        return c;
      });
    });
  }

  // แบบแบ่งฉากสำเร็จรูป — เลือกแล้ว "แทรกก้อนแบ่งฉาก" ลงเลน FX (ล่างสุด) ตรงเส้น playhead
  // เอฟเฟกต์ทำงานเฉพาะช่วงเวลาของก้อน ลาก/ยืดหด/ลบได้เหมือนก้อนข้อความ
  // kind "split" = เส้นแบ่งจอ V1|V2 (ลากย้าย + เอียงมุมบนจอได้) / kind "shape" = ตัด V2 เป็นรูปทรง (ลากย้าย + ปรับขนาด)
  const LAYOUTS = [
    { id: "lr", label: "ซ้าย-ขวา", kind: "split", angle: 90 },
    { id: "tb", label: "บน-ล่าง", kind: "split", angle: 0 },
    { id: "diag", label: "เฉียง", kind: "split", angle: 115 },
    { id: "circle", label: "วงกลม", kind: "shape", shape: "circle" },
    { id: "square", label: "สี่เหลี่ยม", kind: "shape", shape: "square" },
    { id: "heart", label: "หัวใจ", kind: "shape", shape: "heart" },
    { id: "star", label: "ดาว", kind: "shape", shape: "star" },
    // kind "censor" = กล่องเบลอทับภาพ (ปิดหน้าคนไม่เกี่ยว ฯลฯ) — ไม่แตะไฟล์จริง เอาออก/แก้ได้ตลอด
    { id: "censor", label: "เซ็นเซอร์ (เบลอ)", kind: "censor" },
  ];

  function addLayoutBlock(layout) {
    const id = newClipId();
    setSequence((prev) => {
      // FX1 ตรงช่วงนี้มีก้อนอยู่แล้ว → ก้อนใหม่ตกเลน FX2 ให้เลย (ซ้อนสองเอฟเฟกต์พร้อมกัน)
      const o = playback.time;
      const d = 4;
      const busyFx1 = prev.some(
        (c) => c.type === "layout" && c.track === 4 && c.offset < o + d && o < c.offset + c.duration
      );
      return [
      ...prev,
      {
        id,
        type: "layout",
        name: layout.kind === "censor" ? `เซ็นเซอร์: ${layout.label}` : `แบ่งฉาก: ${layout.label}`,
        track: busyFx1 ? 5 : 4,
        offset: playback.time,
        duration: 4,
        kind: layout.kind,
        shape: layout.shape ?? null,
        // จุดกึ่งกลาง/มุม/ขนาด (หน่วย % ของจอ) — ลากปรับบนจอ Program ได้โดยตรง
        cx: 50,
        cy: 50,
        angle: layout.angle ?? 90,
        size: 34,
        // เส้นแบ่งจริงบนภาพ (คนดูเห็น): ปิดไว้ = เนียนไร้รอยต่อสำหรับภาพซ้อน / เปิด = เส้นสีชัดเจน
        line: false,
        lineColor: "#ffffff",
        lineWidth: 3,
        // เฉพาะ censor: กล่องเบลอ (กว้าง×สูง เป็น % ของจอ) + ความแรง + แบบ (เบลอ/โมเสก)
        boxW: 24,
        boxH: 18,
        censorStyle: "blur", // blur | mosaic
        strength: 12,
      },
    ];
    });
    setSelectedId(id);
    setProgramClip((p) => p); // ก้อน FX ไม่เปลี่ยนคลิปที่เปิดอยู่
    setLayoutPickerOpen(false);
  }

  // กดปุ่ม T → แทรกก้อนข้อความลง V3 ตรงเส้น playhead (แสดงทับทุกอย่าง ปรับค่าใน Properties)
  function addTextClip() {
    const id = newClipId();
    setSequence((prev) => [
      ...prev,
      {
        id,
        type: "text",
        name: "Text",
        text: "ข้อความ",
        style: { size: 48, color: "#ffffff", bold: true, outline: true },
        track: 3,
        offset: playback.time,
        duration: 4,
        inPoint: 0,
        srcDuration: 4,
      },
    ]);
    setSelectedId(id);
  }

  // เพิ่มก้อน Scene: วิดีโอเปล่าพื้นหลังดำ ตรงเส้น playhead บน V1 — ยืด/หด/เลื่อนได้เหมือนคลิปปกติ
  // (เฟสแรกของระบบฉากย่อย — ไว้เป็นฐานให้วางรูป/ข้อความ/เสียงทับข้างบน)
  function addSceneClip() {
    const id = newClipId();
    setSequence((prev) => [
      ...prev,
      {
        id,
        type: "scene",
        name: "Scene",
        track: 1,
        offset: playback.time,
        duration: 5,
        inPoint: 0,
        srcDuration: 5,
        children: [],
      },
    ]);
    setSelectedId(id);
  }

  // เอาก้อนนี้ออกจาก timeline (ไฟล์ยังอยู่ใน Project)
  function removeSeqClip(id) {
    setSequence((prev) =>
      prev
        .filter((c) => c.id !== id)
        .map((c) =>
          c.children?.some((child) => child.id === id)
            ? { ...c, children: c.children.filter((child) => child.id !== id) }
            : c
        )
    );
    setSelectedIds((prev) => prev.filter((selected) => selected !== id));
    if (selectedId === id) {
      setSelectedId(null);
      if (programClip?.id === id) setProgramClip(null);
    }
  }

  async function handleExtractFrames() {
    // แตกเฟรมเฉพาะก้อนที่เลือกบน timeline (ไม่มีก้อนเลือก → ทั้งไฟล์ของคลิปใน Program)
    const target = selectedClip ?? programClip;
    if (!target) return;
    // จำบริบทไว้ให้ Frame Browser (แทนเฟรม/ประกอบกลับ ต้องรู้ไฟล์+ช่วง+ก้อนไหน)
    setFrameCtx({
      clipId: selectedClip?.id ?? null,
      path: target.path,
      start: selectedClip ? selectedClip.inPoint || 0 : 0,
      duration: selectedClip ? selectedClip.duration : null,
    });
    setExtract({ status: "working", done: 0, total: 0 });
    try {
      const res = await fetch(`${BACKEND_URL}/video/extract-frames`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          selectedClip
            ? {
                video_path: selectedClip.path,
                start: selectedClip.inPoint || 0,
                // ช่วงเวลา "ในไฟล์จริง" — duration บน timeline ถูกหารสปีดไว้ ต้องคูณกลับ
                duration: selectedClip.duration * (selectedClip.speed || 1),
              }
            : { video_path: target.path }
        ),
      });
      if (!res.ok) throw new Error(`backend ตอบ ${res.status}: ${await res.text()}`);
      const { job_id } = await res.json();
      setExtract({ status: "working", done: 0, total: 0, job_id });

      // poll ความคืบหน้าจนงานจบ
      for (;;) {
        await new Promise((r) => setTimeout(r, 800));
        const job = await (await fetch(`${BACKEND_URL}/jobs/${job_id}`)).json();
        setExtract({ job_id, ...job });
        if (job.status !== "working") break;
      }
    } catch (err) {
      setExtract({ status: "error", error: String(err.message || err) });
    }
  }

  // สั่งยกเลิกงานที่กำลังรันฝั่ง backend — backend จะฆ่า subprocess แล้วตอบ status "cancelled" รอบ poll ถัดไป
  function cancelJob(job) {
    if (!job?.job_id) return;
    fetch(`${BACKEND_URL}/jobs/${job.job_id}/cancel`, { method: "POST" }).catch(() => {});
  }

  // ติ๊กเปิด/ปิดตัวปรับเสียง (denoise/enhance) ต่อก้อน — ติ๊กแล้วสลับ source ของก้อน
  // ไปใช้ไฟล์ที่ประมวลผลแล้ว ติ๊กออกหมดกลับไฟล์ต้นฉบับ (ต้นฉบับไม่ถูกแตะเสมอ)
  async function setAudioFx(id, patch) {
    const clip = sequence.find((c) => c.id === id);
    if (!clip || audioJob?.status === "working") return;
    const fx = { reverse: false, denoise: false, enhance: false, ...clip.audioFx, ...patch };
    const origPath = clip.origPath || clip.path;
    const origUrl = clip.origUrl || clip.url;

    if (!fx.reverse && !fx.denoise && !fx.enhance) {
      updateSeqClip(id, { audioFx: fx, origPath, origUrl, path: origPath, url: origUrl });
      setAudioJob(null);
      return;
    }

    setAudioJob({ status: "working", clipId: id });
    try {
      const res = await fetch(`${BACKEND_URL}/audio/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_path: origPath,
          reverse: fx.reverse,
          denoise: fx.denoise,
          enhance: fx.enhance,
        }),
      });
      if (!res.ok) throw new Error(`backend ตอบ ${res.status}: ${await res.text()}`);
      const { job_id } = await res.json();

      let job;
      for (;;) {
        await new Promise((r) => setTimeout(r, 600));
        job = await (await fetch(`${BACKEND_URL}/jobs/${job_id}`)).json();
        if (job.status !== "working") break;
      }
      if (job.status === "error") throw new Error(job.error);
      updateSeqClip(id, {
        audioFx: fx,
        origPath,
        origUrl,
        path: job.out_path,
        url: `media://${encodeURIComponent(job.out_path)}`,
      });
      setAudioJob({ status: "done", clipId: id });
    } catch (err) {
      setAudioJob({ status: "error", clipId: id, error: String(err.message || err) });
    }
  }

  if (!project) return <ProjectHome onCreate={createProject} onOpen={openProject} onOpenRecent={openRecentProject} />;

  if (activeTab === "Export") return (
    <div className="export-app-shell">
      <div className="topbar">
        <div className="topbar-brand">ClipEasy <span>AI</span></div>
        <div className="topbar-tabs">
          {TABS.map((tab) => <div key={tab} className={`topbar-tab ${activeTab === tab ? "active" : ""}`} onClick={() => tab === "Import" ? handleImport() : setActiveTab(tab)}>{tabLabel(tab)}</div>)}
        </div>
        <div className="topbar-actions"><button className="icon-btn" title="Quick export"><Share size={15} /></button><button className="icon-btn" title="Settings" onClick={() => { setSettingsStartPage("general"); setEngineManagerOpen(true); }}><Settings size={15} /></button></div>
      </div>
      <ExportWorkspace project={project} sequence={sequence} onBack={() => setActiveTab("Edit")} />
      {engineManagerOpen && <EngineManager initialPage={settingsStartPage} onClose={() => setEngineManagerOpen(false)} saveMode={saveMode} onSaveModeChange={(mode) => { setSaveMode(mode); localStorage.setItem("clipeasy_save_mode", mode); }} onSaveNow={saveProjectNow} appPrefs={appPrefs} onAppPrefsChange={updateAppPrefs} />}
    </div>
  );

  return (
    <div
      className="app-shell"
      style={{ gridTemplateRows: `44px ${middleH}px 5px minmax(160px, 1fr)` }}
    >
      {/* ---------- Top bar ---------- */}
      <div className="topbar">
        <div className="topbar-brand">
          ClipEasy <span>AI</span>
        </div>
        <div className="topbar-tabs">
          {TABS.map((tab) => (
            <div
              key={tab}
              className={`topbar-tab ${activeTab === tab ? "active" : ""}`}
              onClick={() => (tab === "Import" ? handleImport() : setActiveTab(tab))}
            >
              {tabLabel(tab)}
            </div>
          ))}
        </div>
        {/* workspace switcher */}
        <div className="topbar-actions">
          <button className="icon-btn" title="Workspaces">
            <LayoutPanelLeft size={15} />
          </button>
          <button className="icon-btn" title="Quick export">
            <Share size={15} />
          </button>
          <button className="icon-btn" title="Panel menu">
            <AlignJustify size={15} />
          </button>
          <button className="icon-btn" title="ตั้งค่า (AI Engines)" onClick={() => { setSettingsStartPage("engines"); setEngineManagerOpen(true); }}>
            <Settings size={15} />
          </button>
        </div>
      </div>

      {/* ---------- Middle: Source | Program | Properties ---------- */}
      <div
        className="middle-row"
        style={{ gridTemplateColumns: `${srcW}px 5px minmax(280px, 1fr) 5px ${propW}px` }}
      >
        <PanelGroup tabs={["Effect Video", "Effect Controls", "Image Controls", "Audio Clip Mixer"]}>
          {(active) =>
            active === "Effect Controls" ? (
              <TextAnimPanel
                clip={selectedClip}
                onUpdate={updateSeqClip}
              />
            ) : active === "Effect Video" ? (
              <VideoFxPanel
                clip={sequence.find((c) => c.id === selectedId) || null}
                onUpdate={updateSeqClip}
              />
            ) : active === "Image Controls" ? (
              <ImageControls clip={selectedClip} onUpdate={updateSeqClip} />
            ) : (
              <Monitor placeholder="ดับเบิลคลิกคลิปใน Project เพื่อเปิดใน Source Monitor" />
            )
          }
        </PanelGroup>

        <Splitter direction="v" onDrag={(dx) => setSrcW((w) => clamp(w + dx, 220, 800))} />

        <PanelGroup
          tabs={[
            sequence.length
              ? `Program: ${sequence.length === 1 ? sequence[0].name : `${sequence.length} คลิป`}`
              : "Program: Main",
          ]}
        >
          <Monitor
            /* V1 = ภาพหลัก — ก้อน Scene ไม่มีไฟล์ ให้เครื่องเล่นมองเป็นช่องดำ (เล่นผ่านเป็นจอดำ) */
            sequence={sequence.filter((c) => !c.hidden && (c.track || 1) === 1 && c.type !== "scene" && c.type !== "audio")}
            blanks={sequence.filter((c) => !c.hidden && c.type === "scene")} /* ก้อน Scene — นับความยาวรวม */
            overlay={sequence.filter((c) => !c.hidden && c.track === 2 && c.type !== "audio")} /* V2 = ซ้อนแบบ PiP */
            overlay2={sequence.filter((c) => !c.hidden && c.track === 3 && c.type !== "text" && c.type !== "audio")} /* V3 = วิดีโอชั้นบนสุด */
            audio={sequence.filter((c) => !c.hidden && c.type === "audio")}
            texts={[...sequence.filter((c) => !c.hidden && c.type === "text"), ...sceneChildren.filter((c) => c.type === "text")]} /* ข้อความปกติ + ข้อความใน Scene */
            sceneMedia={sceneChildren.filter((c) => c.type === "image")}
            fx={sequence.filter((c) => !c.hidden && c.type === "layout")} /* ก้อนแบ่งฉากจากเลน FX */
            placeholder="ลากวิดีโอมาวางที่นี่ หรือกด Import"
            onPlayback={(time, duration) => setPlayback({ time, duration })}
            controlRef={programControl}
            muted={audioMuted}
            playRange={cutRange}
            onDropClip={dropClip}
            onPlayingChange={setIsPlaying}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onUpdateClip={updateSeqClip}
            drawMode={!!inpDraw || !!keepDraw || !!trkDraw || !!swapPick}
            maskDrawMode={tool === "mask" && !!selectedClip && !["image", "text", "layout", "audio", "scene"].includes(selectedClip.type)}
            maskToolActive={tool === 'mask'}
            maskRedraw={maskRedraw}
            onExitMask={() => setTool('select')}
            onDeleteMask={deleteMask}
            drawHint={
              keepDraw
                ? "ลากครอบ 'หน้าคนที่จะเก็บไว้' (ไม่เบลอ) — Esc เลิก"
                : trkDraw
                  ? "ตีกรอบครอบ 'เป้าที่จะให้ตาม' — AI จะตามและวาดสัญลักษณ์ให้เอง (Esc เลิก)"
                  : swapPick
                    ? "ลากครอบ 'หน้าคนบนจอ' ที่จะสลับเป็นรูปนี้ — Esc เลิก"
                    : tool === "mask"
                      ? "ลากกรอบครอบตัวคนหรือวัตถุเพื่อสร้าง Mask — Esc ยกเลิก"
                      : undefined
            }
            onDrawRect={(rect) => {
              if (swapPick) {
                const clip = sequence.find((c) => c.id === swapPick.clipId);
                const idx = swapPick.index;
                setSwapPick(null);
                if (rect && clip) setSwapTargetRef(clip, idx, rect);
                return;
              }
              if (keepDraw) {
                const clip = sequence.find((c) => c.id === keepDraw.clipId);
                setKeepDraw(null);
                if (rect && clip) addKeepRef(clip, rect);
                return;
              }
              if (trkDraw) {
                const clip = sequence.find((c) => c.id === trkDraw.clipId);
                setTrkDraw(null);
                if (rect && clip) trackClip(clip, rect);
                return;
              }
              const clip = sequence.find((c) => c.id === inpDraw?.clipId);
              setInpDraw(null);
              if (rect && clip) inpaintClip(clip, rect);
            }}
            onDrawMask={commitMask}
          />
        </PanelGroup>

        <Splitter direction="v" onDrag={(dx) => setPropW((w) => clamp(w - dx, 220, 520))} />

        <PanelGroup tabs={["Properties", "Effect & Animate", "AI Video", "AI เสียง"]} className="properties-panel">
          {(tab) => (
          <div className="properties-body">
            <PropertiesPanel
              /* แยกแท็บ: คุณสมบัติ | แอนิเมชันข้อความ | AI ภาพ/วิดีโอ | AI เสียง */
              section={
                tab === "Effect & Animate"
                  ? "text-anim"
                  : tab === "AI Video"
                    ? "ai"
                    : tab === "AI เสียง"
                      ? "ai-audio"
                      : "props"
              }
              selectedClip={selectedClip}
              onEditMask={clip => openMaskEditor(clip)}
              onRedrawMask={clip => openMaskEditor(clip, true)}
              onDeleteMask={deleteMask}
              onTrackMask={trackMask}
              onCancelMaskTrack={cancelMaskTrack}
              maskTrackJob={maskTrackJob}
              maskToolActive={tool === 'mask'}
              programClip={programClip}
              onUpdate={updateSeqClip}
              onSelectClipId={setSelectedId}
              onRemove={removeSeqClip}
              onSetSpeed={setClipSpeed}
              extract={extract}
              onExtract={handleExtractFrames}
              audioJob={audioJob}
              onAudioFx={setAudioFx}
              bgEngineReady={bgEngineReady}
              bgEngines={bgEngines}
              bgEngineId={bgEngineId}
              onSelectBgEngine={setBgEngineId}
              bgJob={bgJob}
              onRemoveBg={removeBg}
              upEngines={upEngines}
              upEngineId={upEngineId}
              onSelectUpEngine={setUpEngineId}
              upJob={upJob}
              onUpscale={upscaleClip}
              sttEngines={sttEngines}
              sttEngineId={sttEngineId}
              onSelectSttEngine={setSttEngineId}
              sttLang={sttLang}
              onSelectSttLang={setSttLang}
              sttJob={sttJob}
              onTranscribe={transcribeClip}
              subtitleTpl={subtitleTpl}
              onSetSubtitleTpl={setSubtitleTemplate}
              stabJob={stabJob}
              onStabilize={stabilizeClip}
              inpEngines={inpEngines}
              inpEngineId={inpEngineId}
              onSelectInpEngine={setInpEngineId}
              inpJob={inpJob}
              inpDrawing={!!inpDraw}
              onInpaintStart={startInpaint}
              censorJob={censorJob}
              onBakeCensor={bakeCensor}
              swapReady={swapReady}
              swapEngines={swapEngines}
              swapEngineId={swapEngineId}
              onSelectSwapEngine={setSwapEngineId}
              swapImages={media.filter((m) => m.kind === "image")}
              swapMaps={swapMaps}
              swapPickIndex={swapPick?.index ?? null}
              onAddSwapMap={addSwapMap}
              onRemoveSwapMap={removeSwapMap}
              onSetSwapMapSource={setSwapMapSource}
              onPickSwapTarget={(i) => startPickSwapTarget(selectedClip, i)}
              onClearSwapMapRef={clearSwapMapRef}
              swapEnhance={swapEnhance}
              onToggleSwapEnhance={() => setSwapEnhance((v) => !v)}
              swapJob={swapJob}
              onFaceSwap={swapFaceClip}
              trkEngines={trkEngines}
              trkEngineId={trkEngineId}
              onSelectTrkEngine={setTrkEngineId}
              trkStyle={trkStyle}
              onSelectTrkStyle={setTrkStyle}
              trkJob={trkJob}
              trkDrawing={!!trkDraw}
              onTrackStart={startTrack}
              fcEngines={fcEngines}
              censorReady={Object.keys(czInstalled).length > 0}
              fcEngineId={fcEngineId}
              onSelectFcEngine={setFcEngineId}
              fcTarget={fcTarget}
              onSelectFcTarget={setFcTarget}
              fcStyle={fcStyle}
              onSelectFcStyle={setFcStyle}
              fcJob={fcJob}
              onFaceCensor={faceCensorClip}
              keepRefs={keepRefs}
              keepInvert={keepInvert}
              keepPicking={!!keepDraw}
              onPickKeep={startPickKeep}
              onClearKeep={() => setKeepRefs([])}
              onToggleKeepInvert={() => setKeepInvert((v) => !v)}
              onCancelJob={cancelJob}
              onOpenFrames={() => setFrameBrowserOpen(true)}
              onOpenEngines={() => { setSettingsStartPage("engines"); setEngineManagerOpen(true); }}
            />
          </div>
          )}
        </PanelGroup>
      </div>

      {/* เส้นคั่นแนวนอน: ลากขึ้น-ลงเพื่อปรับสัดส่วนจอ monitor กับ timeline */}
      <Splitter
        direction="h"
        onDrag={(dy) =>
          setMiddleH((h) => clamp(h + dy, 200, window.innerHeight - 44 - 160))
        }
      />

      {/* ---------- Bottom: Project | Tools | Timeline | Meter ---------- */}
      <div
        className="bottom-row"
        style={{ gridTemplateColumns: `${projW}px 5px 38px minmax(280px, 1fr) 60px` }}
      >
        <PanelGroup
          tabs={["Project: Main", "Media Browser", "Templates", "Info"]}
          className="project-panel"
        >
          {(tab) =>
            tab === "Project: Main" ? (
              <ProjectPanel
                clips={clips}
                activeClip={programClip}
                onImport={handleImport}
                onOpenClip={openClip}
                onDeleteClip={deleteClip}
              />
            ) : tab === "Media Browser" ? (
              <MediaBrowser items={media} onImport={importMedia} onDelete={deleteMedia} />
            ) : tab === "Templates" ? (
              <TemplatesPanel
                templates={textTemplates}
                onSave={addTextTemplate}
                onDelete={deleteTextTemplate}
              />
            ) : (
              <div className="panel-placeholder">{tab} — ยังไม่ทำ</div>
            )
          }
        </PanelGroup>

        <Splitter direction="v" onDrag={(dx) => setProjW((w) => clamp(w + dx, 200, 600))} />

        <ToolsPanel tool={tool} onSelectTool={selectTool} />
        <Timeline
          sequence={sequence}
          time={playback.time}
          duration={timelineDuration}
          playing={isPlaying}
          tool={tool}
          copyStyleArmed={tool === "copystyle" && !!copiedStyle}
          onResetCopyStyle={() => setCopiedStyle(null)}
          onDropTemplate={dropTextTemplate}
          onApplyTemplate={applyTextTemplate}
          onSeek={(t) => programControl.current?.seekTo(t)}
          onMute={setAudioMuted}
          onRangeChange={setCutRange}
          onDropClip={dropClip}
          onDropMedia={dropMedia}
          onDropMediaIntoScene={addMediaToScene}
          onMoveTextIntoScene={moveTextIntoScene}
          onUpdateSceneChild={updateSeqClip}
          onSplit={() => splitAt()}
          onSplitAt={splitAt}
          onDetachAudio={detachAudio}
          onMergeSelected={mergeSelected}
          selectedIds={selectedIds}
          merging={mergeJob?.status === "working"}
          mergePct={mergeJob?.done || 0}
          onDeleteRange={deleteRange}
          onMoveClip={moveClip}
          onResizeClip={resizeClip}
          selectedId={selectedId}
          onSelectClip={selectClip}
          onAddLayout={() => setLayoutPickerOpen(true)}
          onAddText={addTextClip}
          onAddScene={addSceneClip}
        />
        <AudioMeter />
      </div>

      {saveNotice && <div className={`save-notice ${saveNotice.type}`}>{saveNotice.text}</div>}

      {engineManagerOpen && <EngineManager initialPage={settingsStartPage} onClose={() => setEngineManagerOpen(false)} saveMode={saveMode} onSaveModeChange={(mode) => { setSaveMode(mode); localStorage.setItem("clipeasy_save_mode", mode); }} onSaveNow={saveProjectNow} appPrefs={appPrefs} onAppPrefsChange={updateAppPrefs} />}
      {frameBrowserOpen && extract?.status === "done" && (
        <FrameBrowser
          framesDir={extract.frames_dir}
          count={extract.frame_count}
          onClose={() => setFrameBrowserOpen(false)}
          onReplace={replaceFrame}
          onRebuild={rebuildFrames}
          rebuildJob={rebuildJob}
        />
      )}

      {/* popup แบ่งฉาก — เลือกแบบแล้วใส่ทรงให้ก้อนตรงเส้น playhead ทันที */}
      {layoutPickerOpen && (
        <div className="layout-pop-backdrop" onClick={() => setLayoutPickerOpen(false)}>
          <div className="layout-pop" onClick={(e) => e.stopPropagation()}>
            <div className="layout-pop-title">
              แบ่งฉาก — ใช้กับก้อนวิดีโอตรงเส้น playhead (V1 = พื้น, V2/V3 = ชั้นซ้อน)
              <br />
              <span style={{ opacity: 0.65 }}>เลือกแล้วยังเอียงมุม/ปรับขนาด/ย้าย แต่ละชั้นได้ใน Properties → Motion</span>
            </div>
            <div className="layout-grid">
              {LAYOUTS.map((l) => (
                <button key={l.id} className="layout-btn" onClick={() => addLayoutBlock(l)}>
                  <LayoutPreview id={l.id} />
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** ไอคอนตัวอย่างของแต่ละแบบแบ่งฉาก — วาดเป็น SVG เล็กๆ ให้เห็นหน้าตาก่อนกด */
function LayoutPreview({ id }) {
  const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.5 };
  return (
    <svg viewBox="0 0 34 24" width="34" height="24">
      <rect x="1" y="1" width="32" height="22" rx="2" {...s} />
      {id === "lr" && <line x1="17" y1="1" x2="17" y2="23" {...s} />}
      {id === "tb" && <line x1="1" y1="12" x2="33" y2="12" {...s} />}
      {id === "diag" && <line x1="11" y1="23" x2="23" y2="1" {...s} />}
      {id === "circle" && <circle cx="17" cy="12" r="6" {...s} />}
      {id === "square" && <rect x="11" y="6" width="12" height="12" rx="2" {...s} />}
      {id === "censor" && (
        <>
          <rect x="10" y="7" width="14" height="10" rx="1" fill="currentColor" opacity="0.35" {...s} />
          <line x1="10" y1="10" x2="24" y2="10" {...s} strokeWidth="1" />
          <line x1="10" y1="13" x2="24" y2="13" {...s} strokeWidth="1" />
        </>
      )}
      {id === "heart" && (
        <path d="M17 18 l-5 -4.5 a3 3 0 1 1 5 -3 a3 3 0 1 1 5 3 z" {...s} />
      )}
      {id === "star" && (
        <path d="M17 5 l1.8 4 4.2 .4 -3.2 2.8 1 4.2 -3.8 -2.3 -3.8 2.3 1 -4.2 -3.2 -2.8 4.2 -.4 z" {...s} />
      )}
    </svg>
  );
}
