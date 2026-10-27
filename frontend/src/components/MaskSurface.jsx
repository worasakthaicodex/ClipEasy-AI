import React, { useEffect, useRef, useState } from 'react';
import { hasMask, maskStateAt, maskBounds, simplifyMask, renderMaskFrame } from './maskFx';
import './mask-surface.css';

const stop = e => { e.preventDefault(); e.stopPropagation(); };
const limit = v => Math.max(0, Math.min(1, v));
const EMPTY_TRANSFORM = Object.freeze({});

// Shares the source element's fitting and transform; drawing is in source coordinates.
export default function MaskSurface({ sourceRef, clip, time, active = false, selected = false, redraw = 0, onCommit, onExit, onDelete }) {
  const canvasRef = useRef(null), frameRef = useRef(null), svgRef = useRef(null), gesture = useRef(null);
  const [draft, setDraft] = useState(null), [mode, setMode] = useState(hasMask(clip.transform) ? 'edit' : 'draw');
  const [pointIndex, setPointIndex] = useState(null), [geometry, setGeometry] = useState({ w: 1, h: 1 });
  const [error, setError] = useState('');
  const tf = clip.transform || EMPTY_TRANSFORM;
  const sourceTime = (clip.inPoint || 0) + Math.max(0, time - clip.offset) * (clip.speed || 1);
  const state = maskStateAt(tf, sourceTime, time - clip.offset);
  const points = draft || state.points;
  const visible = active || (selected && tf.fxMaskShowGuide !== false && hasMask(tf));

  useEffect(() => { gesture.current = null; setDraft(null); setPointIndex(null); setMode(hasMask(tf) ? 'edit' : 'draw'); }, [clip.id, active]);
  useEffect(() => { if (active && redraw?.clipId === clip.id) { setMode('draw'); setDraft(null); setPointIndex(null); } }, [redraw]);
  useEffect(() => {
    if (!active) return;
    const key = e => {
      if (e.target.closest?.('input,textarea,select,[contenteditable=true]')) return;
      if (e.key === 'Escape') { stop(e); gesture.current = null; setDraft(null); onExit?.(); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Never let a mask-point shortcut fall through and delete the whole clip.
        stop(e);
        if (pointIndex != null && points.length > 3) {
          const next = points.filter((_, i) => i !== pointIndex); setDraft(null); setPointIndex(null); onCommit?.(clip, next, sourceTime);
        }
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [active, pointIndex, points, sourceTime, onCommit, onExit]);

  useEffect(() => {
    if (!active && !hasMask(tf)) return;
    let raf = 0, lastKey = '', cancelled = false;
    const sourceEl = sourceRef.current;
    if (sourceEl && !active && hasMask(tf) && tf.maskFx?.enabled !== false) sourceEl.dataset.maskSourceHidden = 'true';
    const paint = () => {
      if (cancelled) return;
      const source = sourceRef.current, canvas = canvasRef.current, frame = frameRef.current;
      if (source && canvas && frame && source.videoWidth && source.readyState >= 2) {
        const cs = getComputedStyle(source), ew = source.clientWidth, eh = source.clientHeight;
        const sw = source.videoWidth, sh = source.videoHeight;
        const fit = cs.objectFit === 'cover' ? Math.max(ew / sw, eh / sh) : Math.min(ew / sw, eh / sh);
        const w = sw * fit, h = sh * fit;
        // The container uses exactly the same local transform as the source element.
        Object.assign(frame.style, { left: `${source.offsetLeft}px`, top: `${source.offsetTop}px`, width: `${ew}px`, height: `${eh}px`, transform: cs.transform, transformOrigin: cs.transformOrigin, visibility: cs.visibility });
        const inner = frame.firstElementChild;
        Object.assign(inner.style, { left: `${(ew - w) / 2}px`, top: `${(eh - h) / 2}px`, width: `${w}px`, height: `${h}px` });
        setGeometry(prev => Math.abs(prev.w - w) > .1 || Math.abs(prev.h - h) > .1 ? { w, h } : prev);
        Object.assign(canvas.style, { left: `${source.offsetLeft}px`, top: `${source.offsetTop}px`, width: `${ew}px`, height: `${eh}px`, objectFit: cs.objectFit, objectPosition: cs.objectPosition, transform: cs.transform, transformOrigin: cs.transformOrigin, opacity: source.style.opacity || '1', filter: cs.filter, clipPath: cs.clipPath, webkitMaskImage: cs.webkitMaskImage, maskImage: cs.maskImage, mixBlendMode: cs.mixBlendMode, visibility: cs.visibility });
        // Source time, not a timer, determines the animation for scrubbing and export parity.
        const st = source.currentTime, lt = (st - (clip.inPoint || 0)) / (clip.speed || 1);
        const key = `${st}:${sw}:${sh}:${active}`;
        if (key !== lastKey && !source.seeking) {
          lastKey = key;
          if (canvas.width !== sw || canvas.height !== sh) { canvas.width = sw; canvas.height = sh; }
          try { renderMaskFrame(canvas.getContext('2d'), source, tf, st, lt); }
          catch (e) { setError(String(e.message || e)); }
        }
      }
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => { cancelled = true; cancelAnimationFrame(raf); if (sourceEl) delete sourceEl.dataset.maskSourceHidden; };
  }, [sourceRef, clip.id, clip.inPoint, clip.speed, tf, active]);

  const pointer = e => {
    const rect = svgRef.current.getBoundingClientRect();
    return { x: limit((e.clientX - rect.left) / rect.width), y: limit((e.clientY - rect.top) / rect.height) };
  };
  // SVG's screen transform also handles rotated/flipped/scaled clips.
  const sourcePoint = e => {
    const svg = svgRef.current, m = svg?.getScreenCTM();
    if (!m) return pointer(e);
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: limit(p.x), y: limit(p.y) };
  };
  const begin = (e, kind = 'draw', index = null) => {
    if (!active || e.button !== 0) return;
    stop(e); svgRef.current.setPointerCapture(e.pointerId);
    const p = sourcePoint(e);
    gesture.current = { kind, index, start: p, points: kind === 'draw' ? [p] : points.map(x => ({ ...x })), pointerId: e.pointerId };
    if (kind === 'draw') setDraft([p]);
    setPointIndex(index);
  };
  const move = e => {
    const g = gesture.current;
    if (!g) return;
    stop(e); const p = sourcePoint(e);
    let next;
    if (g.kind === 'draw') {
      const last = g.points[g.points.length - 1];
      if (Math.hypot((p.x - last.x) * geometry.w, (p.y - last.y) * geometry.h) < 2) return;
      g.points.push(p); next = [...g.points];
    } else if (g.kind === 'point') next = g.points.map((q, i) => i === g.index ? p : q);
    else {
      const box = maskBounds(g.points), dx = Math.max(-box.x, Math.min(1 - box.x - box.w, p.x - g.start.x)), dy = Math.max(-box.y, Math.min(1 - box.y - box.h, p.y - g.start.y));
      next = g.points.map(q => ({ x: q.x + dx, y: q.y + dy }));
    }
    g.result = next; setDraft(next);
  };
  const end = e => {
    const g = gesture.current; if (!g) return;
    stop(e); gesture.current = null;
    svgRef.current.releasePointerCapture(e.pointerId);
    const next = g.kind === 'draw' ? simplifyMask(g.result || g.points) : g.result;
    const b = maskBounds(next);
    if (next?.length >= 3 && b.w > .003 && b.h > .003) { onCommit?.(clip, next, sourceTime); setMode('edit'); }
    setDraft(null);
  };
  const remove = () => { onDelete?.(clip); setDraft(null); setMode('draw'); setPointIndex(null); };
  const addPoint = e => {
    stop(e); if (!active || mode !== 'edit' || points.length < 3) return;
    const p = sourcePoint(e); let best = Infinity, index = 0, hit = p;
    points.forEach((a, i) => {
      const b = points[(i + 1) % points.length], dx = (b.x - a.x) * geometry.w, dy = (b.y - a.y) * geometry.h;
      const k = dx || dy ? limit(((p.x - a.x) * geometry.w * dx + (p.y - a.y) * geometry.h * dy) / (dx * dx + dy * dy)) : 0;
      const q = { x: a.x + k * (b.x - a.x), y: a.y + k * (b.y - a.y) };
      const d = Math.hypot((p.x - q.x) * geometry.w, (p.y - q.y) * geometry.h);
      if (d < best) { best = d; index = i; hit = q; }
    });
    if (best > 14) return;
    const next = [...points.slice(0, index + 1), hit, ...points.slice(index + 1)];
    onCommit?.(clip, next, sourceTime); setPointIndex(index + 1);
  };
  return <>
    <canvas ref={canvasRef} className="mask-render-canvas" data-mask-render={clip.id} style={{ display: !active && hasMask(tf) && tf.maskFx?.enabled !== false ? 'block' : 'none' }} />
    <div ref={frameRef} className={`mask-surface ${active ? 'editing' : ''}`} style={{ display: visible ? 'block' : 'none' }}>
      <div className="mask-source-plane">
        <svg ref={svgRef} viewBox="0 0 1 1" preserveAspectRatio="none" data-mask-editor={clip.id}
          onPointerDown={e => { if (mode === 'draw' || !points.length) begin(e); else stop(e); }} onPointerMove={move} onPointerUp={end}
          onPointerCancel={() => { gesture.current = null; setDraft(null); }} onClick={stop} onDoubleClick={addPoint} onContextMenu={stop}>
          {points.length >= 2 && <polygon points={points.map(p => `${p.x},${p.y}`).join(' ')} onPointerDown={e => begin(e, mode === 'draw' ? 'draw' : 'move')} />}
          {active && mode === 'edit' && points.map((p, i) => <ellipse key={i} data-mask-point={i} cx={p.x} cy={p.y} rx={4 / geometry.w} ry={4 / geometry.h} className={i === pointIndex ? 'selected' : ''} onPointerDown={e => begin(e, 'point', i)} />)}
        </svg>
      </div>
    </div>
    {active && <div className="mask-editor-toolbar" onPointerDown={stop} onClick={e => e.stopPropagation()}>
      <span>{mode === 'draw' ? 'ลากวาดรอบวัตถุ แล้วปล่อยเพื่อปิดเส้น' : 'ลากจุดแก้เส้น · ลากพื้นที่ย้าย Mask'}</span>
      <button onClick={() => { setMode('draw'); setDraft(null); }}>วาดใหม่</button>
      <button disabled={!hasMask(tf)} onClick={remove}>ลบ Mask</button>
      <button onClick={() => onExit?.()}>เสร็จ / Esc</button>
    </div>}
    {error && <div className="mask-render-error">Mask Preview: {error}</div>}
  </>;
}
