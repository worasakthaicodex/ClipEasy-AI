import React, { useMemo, useState } from "react";
import { Check, ChevronDown, FileVideo, FolderOpen, Loader2 } from "lucide-react";
import Monitor from "./Monitor";
import { hasMask } from "./maskFx";
import "./export-mask.css";

const tc = (s = 0) => {
  const n = Math.max(0, Math.floor(s));
  return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60].map((v) => String(v).padStart(2, "0")).join(":");
};

const EXPORT_PRESETS = [
  { group: "Custom", id: "custom", label: "Custom Settings", w: 1920, h: 1080, fps: 25, crf: 18 },
  { group: "Match Source", id: "match-high", label: "Match Source — High Quality", match: true, crf: 16, speed: "medium" },
  { group: "Match Source", id: "match-balanced", label: "Match Source — Balanced", match: true, crf: 19, speed: "veryfast" },
  { group: "YouTube", id: "yt-720", label: "YouTube 720p HD", w: 1280, h: 720, fps: 30, crf: 20 },
  { group: "YouTube", id: "yt-480", label: "YouTube 480p SD Wide", w: 854, h: 480, fps: 30, crf: 22 },
  { group: "YouTube", id: "yt-1080", label: "YouTube 1080p Full HD", w: 1920, h: 1080, fps: 30, crf: 18 },
  { group: "YouTube", id: "yt-1440", label: "YouTube 1440p QHD", w: 2560, h: 1440, fps: 30, crf: 18 },
  { group: "YouTube", id: "yt-4k", label: "YouTube 2160p 4K Ultra HD", w: 3840, h: 2160, fps: 30, crf: 17, speed: "medium" },
  { group: "Facebook", id: "fb-720", label: "Facebook 720p HD", w: 1280, h: 720, fps: 30, crf: 21 },
  { group: "Facebook", id: "fb-480", label: "Facebook 480p SD Wide", w: 854, h: 480, fps: 30, crf: 23 },
  { group: "Facebook", id: "fb-1080", label: "Facebook 1080p Full HD", w: 1920, h: 1080, fps: 30, crf: 19 },
  { group: "Facebook", id: "fb-4k", label: "Facebook 2160p 4K Ultra HD", w: 3840, h: 2160, fps: 30, crf: 18 },
  { group: "Vertical Video", id: "tiktok", label: "TikTok 1080×1920 Vertical", w: 1080, h: 1920, fps: 30, crf: 19 },
  { group: "Vertical Video", id: "reels", label: "Instagram Reels 1080×1920", w: 1080, h: 1920, fps: 30, crf: 19 },
  { group: "Vertical Video", id: "shorts", label: "YouTube Shorts 1080×1920", w: 1080, h: 1920, fps: 30, crf: 18 },
  { group: "Vimeo", id: "vimeo-720", label: "Vimeo 720p HD", w: 1280, h: 720, fps: 30, crf: 19 },
  { group: "Vimeo", id: "vimeo-480", label: "Vimeo 480p SD Wide", w: 854, h: 480, fps: 30, crf: 22 },
  { group: "Vimeo", id: "vimeo-1080", label: "Vimeo 1080p Full HD", w: 1920, h: 1080, fps: 30, crf: 17 },
  { group: "Vimeo", id: "vimeo-4k", label: "Vimeo 2160p 4K Ultra HD", w: 3840, h: 2160, fps: 30, crf: 16, speed: "medium" },
  { group: "Mobile", id: "mobile-720", label: "Mobile Device 720p HD", w: 1280, h: 720, fps: 30, crf: 23 },
  { group: "Mobile", id: "mobile-1080", label: "Mobile Device 1080p HD", w: 1920, h: 1080, fps: 30, crf: 21 },
  { group: "X / Twitter", id: "twitter-720", label: "X / Twitter 720p HD", w: 1280, h: 720, fps: 30, crf: 21 },
  { group: "X / Twitter", id: "twitter-1080", label: "X / Twitter 1080p Full HD", w: 1920, h: 1080, fps: 30, crf: 20 },
];

// Mask exports must never look successful while dropping a visible layer.
export function maskExportLayerError(sequence = []) {
  const visible = sequence.filter((clip) => !clip.hidden);
  const objects = visible.flatMap((clip) => clip.type === "scene"
    ? [clip, ...(clip.children || []).filter((child) => !child.hidden)] : [clip]);
  if (!objects.some((clip) => hasMask(clip.transform) && clip.transform?.maskFx?.enabled !== false)) return null;
  const types = { scene: "Scene", image: "รูปภาพ", text: "ข้อความ", layout: "Layout FX" };
  const unsupported = visible.find((clip) => clip.type !== "audio" &&
    (types[clip.type] || ![1, 2, 3].includes(clip.track || 1)));
  if (!unsupported) return null;
  const label = types[unsupported.type] || `เลเยอร์ V${unsupported.track}`;
  return `ยังส่งออก Mask FX ร่วมกับ ${label} “${unsupported.name || label}” ไม่ได้: เลเยอร์นี้แสดงใน Preview แต่ระบบส่งออกยังไม่รองรับ`;
}

export default function ExportWorkspace({ project, sequence, onBack }) {
  const visible = useMemo(() => sequence.filter((c) => !c.hidden), [sequence]);
  const video = useMemo(() => visible.filter((c) => (c.track || 1) === 1 && !["scene", "audio", "image", "text", "layout"].includes(c.type)).sort((a, b) => a.offset - b.offset), [visible]);
  const overlayVideo = useMemo(() => visible.filter((c) => [2, 3].includes(c.track) && !["scene", "audio", "image", "text", "layout"].includes(c.type)), [visible]);
  const sceneChildren = useMemo(() => visible.flatMap((scene) => scene.type === "scene"
    ? (scene.children || []).filter((c) => !c.hidden).map((child) => ({ ...child, sceneId: scene.id, sceneLocalOffset: child.offset || 0, sceneDuration: scene.duration, offset: scene.offset + (child.offset || 0), duration: Math.min(child.duration || scene.duration, scene.duration - (child.offset || 0)) }))
    : []), [visible]);
  const unsupportedMask = [...visible, ...sceneChildren].find((c) => hasMask(c.transform) && c.transform?.maskFx?.enabled !== false && ![...video, ...overlayVideo].some((v) => v.id === c.id));
  const exportLayerError = useMemo(() => maskExportLayerError(sequence), [sequence]);
  const duration = visible.reduce((m, c) => Math.max(m, c.offset + c.duration), 0);
  const defaultPath = `${project?.dirPath || ""}\\Exports\\${project?.name || "Untitled"}.mp4`;
  const [output, setOutput] = useState(defaultPath);
  const [format, setFormat] = useState("H.264");
  const [preset, setPreset] = useState("match-high");
  const [matchSource, setMatchSource] = useState(true);
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [fps, setFps] = useState(25);
  const [exportVideo, setExportVideo] = useState(true);
  const [exportAudio, setExportAudio] = useState(true);
  const [job, setJob] = useState(null);

  const chooseOutput = async () => {
    const chosen = await window.aiclip?.chooseExportFile?.(output);
    if (chosen) setOutput(chosen);
  };

  const choosePreset = (id) => {
    const p = EXPORT_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPreset(id);
    setMatchSource(!!p.match);
    if (!p.match) { setWidth(p.w); setHeight(p.h); setFps(p.fps); }
  };

  const startExport = async () => {
    if ((!video.length && !overlayVideo.length) || !output || job?.status === "working") return;
    setJob({ status: "working", progress: 0 });
    try {
      if (exportLayerError) throw new Error(exportLayerError);
      if (unsupportedMask) throw new Error(`Mask FX ของ “${unsupportedMask.name || "คลิป"}” รองรับการส่งออกบนคลิปวิดีโอ V1, V2 และ V3`);
      const segments = video.map((c) => ({ path: c.path, start: c.inPoint || 0, duration: c.duration * (c.speed || 1), speed: c.speed || 1, offset: c.offset || 0, mute: !!c.audioDetached, transform: c.transform || {} }));
      const overlays = overlayVideo.map((c) => ({ path: c.path, start: c.inPoint || 0, duration: c.duration * (c.speed || 1), speed: c.speed || 1, offset: c.offset || 0, track: c.track, mute: !!c.audioDetached, transform: c.transform || {} }));
      const detachedAudio = visible.filter((c) => c.type === "audio").map((c) => ({ path: c.path, start: c.inPoint || 0, duration: c.duration * (c.speed || 1), speed: c.speed || 1, offset: c.offset || 0, volume: c.transform?.volume ?? 100, pan: c.transform?.pan ?? 0, fade_in: c.transform?.audioFadeIn ?? 0, fade_out: c.transform?.audioFadeOut ?? 0 }));
      const chosenPreset = EXPORT_PRESETS.find((p) => p.id === preset) || EXPORT_PRESETS[0];
      const quality = { crf: chosenPreset.crf, encode_preset: chosenPreset.speed || "fast" };
      const settings = { codec: format === "HEVC (H.265)" ? "h265" : "h264", audio: exportAudio, detached_audio: detachedAudio, overlays, timeline_duration: duration, ...quality, ...(matchSource ? {} : { width: Number(width), height: Number(height), fps: Number(fps) }) };
      const res = await fetch(`${window.aiclip?.backendUrl || "http://127.0.0.1:8420"}/video/merge`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ segments, settings }) });
      if (!res.ok) throw new Error(await res.text());
      const { job_id } = await res.json();
      for (;;) {
        await new Promise((r) => setTimeout(r, 700));
        const state = await (await fetch(`${window.aiclip?.backendUrl || "http://127.0.0.1:8420"}/jobs/${job_id}`)).json();
        if (state.status === "working") { setJob({ status: "working", progress: state.done || 0 }); continue; }
        if (state.status !== "done") throw new Error(state.error || "Export failed");
        const done = await window.aiclip.finalizeExport(state.out_path, output);
        setJob({ status: "done", progress: 100, bytes: done.bytes });
        break;
      }
    } catch (err) { setJob({ status: "error", progress: 0, error: String(err.message || err) }); }
  };

  return (
    <main className="export-workspace">
      <section className="export-preview-pane">
        <div className="export-preview-tabs"><b>Output Preview</b></div>
        <div className="export-preview-stage sequence-preview">
          {visible.length ? <Monitor
            sequence={visible.filter((c) => (c.track || 1) === 1 && c.type !== "scene" && c.type !== "audio")}
            blanks={visible.filter((c) => c.type === "scene")}
            overlay={visible.filter((c) => c.track === 2 && c.type !== "audio")}
            overlay2={visible.filter((c) => c.track === 3 && c.type !== "text" && c.type !== "audio")}
            audio={visible.filter((c) => c.type === "audio")}
            texts={[...visible.filter((c) => c.type === "text"), ...sceneChildren.filter((c) => c.type === "text")]}
            sceneMedia={sceneChildren.filter((c) => c.type === "image")}
            fx={visible.filter((c) => c.type === "layout")}
            muted={!exportAudio}
          /> : <div className="export-empty"><FileVideo size={42} /><span>ไม่มีวิดีโอบน V1</span></div>}
        </div>
        <div className="export-source-range">Source Range <strong>Entire Sequence</strong></div>
      </section>

      <aside className="export-settings-pane">
        <header><button className="export-back" onClick={onBack}>‹ Edit</button><h2>Export Settings</h2></header>
        <section className="export-setting-group open">
          <h3><ChevronDown size={12} /> EXPORT SETTINGS</h3>
          <label className="export-check"><input type="checkbox" checked={matchSource} onChange={(e) => { const checked = e.target.checked; setMatchSource(checked); setPreset(checked ? "match-high" : "custom"); }} /> Match Sequence Settings</label>
          <div className="export-field"><span>Format</span><select value={format} onChange={(e) => setFormat(e.target.value)}><option>H.264</option><option>HEVC (H.265)</option></select></div>
          <div className="export-field"><span>Preset</span><select value={preset} onChange={(e) => choosePreset(e.target.value)}>{[...new Set(EXPORT_PRESETS.map((p) => p.group))].map((group) => <optgroup key={group} label={group}>{EXPORT_PRESETS.filter((p) => p.group === group).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>)}</select></div>
          <div className="export-field"><span>Output Name</span><button className="export-output-path" onClick={chooseOutput}>{output || "เลือกไฟล์…"}<FolderOpen size={13} /></button></div>
          <div className="export-toggles"><label title="หน้า Export Video ต้องมีภาพเสมอ"><input type="checkbox" checked={exportVideo} disabled /> Export Video</label><label><input type="checkbox" checked={exportAudio} onChange={(e) => setExportAudio(e.target.checked)} /> Export Audio</label></div>
          <div className="export-summary"><b>Summary</b><span>Output: {output}</span><span>{format} · {matchSource ? "Match source" : `${width}×${height} · ${fps} fps`} · {tc(duration)}</span><span>{exportAudio ? "Audio: AAC, 48 kHz, Stereo" : "Audio: Disabled"}</span></div>
        </section>
        <div className="export-subtabs"><b>Video</b></div>
        <section className="export-setting-group compact"><h3><ChevronDown size={12} /> BASIC VIDEO SETTINGS</h3><div className="export-field"><span>Frame Size</span><div className="export-inline"><input type="number" min="16" step="2" value={width} disabled={matchSource} onChange={(e) => { setPreset("custom"); setWidth(e.target.value); }} /><span>×</span><input type="number" min="16" step="2" value={height} disabled={matchSource} onChange={(e) => { setPreset("custom"); setHeight(e.target.value); }} /></div></div><div className="export-field"><span>Frame Rate</span><select value={fps} disabled={matchSource} onChange={(e) => { setPreset("custom"); setFps(Number(e.target.value)); }}><option value="24">24</option><option value="25">25</option><option value="30">30</option><option value="50">50</option><option value="60">60</option></select></div></section>
        <footer className="export-footer">
          {job?.status === "working" && <div className="export-progress"><div style={{ width: `${job.progress}%` }} /><span>{job.progress}%</span></div>}
          {job?.status === "done" && <span className="export-done"><Check size={13} /> Export สำเร็จ</span>}
          {(exportLayerError || job?.status === "error") && <span className="export-error">{exportLayerError || job.error}</span>}
          <button className="export-cancel-btn" onClick={onBack}>Cancel</button><button className="export-submit-btn" disabled={!!exportLayerError || (!video.length && !overlayVideo.length) || !output || job?.status === "working"} onClick={startExport}>{job?.status === "working" ? <><Loader2 size={13} className="spin" /> Exporting</> : "Export"}</button>
        </footer>
      </aside>
    </main>
  );
}
