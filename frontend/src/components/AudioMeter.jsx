import React, { useEffect, useRef, useState } from "react";

const DB_MARKS = [0, -6, -12, -18, -24, -30, -36, -42, -48, -54];

/** มิเตอร์เสียงจริงจาก Web Audio analyser ของ Program Monitor */
export default function AudioMeter() {
  const [level, setLevel] = useState({ left: -60, right: -60 });
  const [peak, setPeak] = useState({ left: -60, right: -60 });
  const peakAt = useRef({ left: 0, right: 0 });
  const sources = useRef(new Map());
  useEffect(() => {
    const onLevel = (e) => {
      const now = performance.now();
      const id = e.detail?.source || "default";
      if (e.detail?.remove) sources.current.delete(id);
      else sources.current.set(id, { left: e.detail?.left ?? -60, right: e.detail?.right ?? -60, at: now });
      for (const [key, value] of sources.current) if (now - value.at > 180) sources.current.delete(key);
      const values = [...sources.current.values()];
      const next = { left: values.length ? Math.max(...values.map((v) => v.left)) : -60, right: values.length ? Math.max(...values.map((v) => v.right)) : -60 };
      setLevel(next);
      setPeak((p) => {
        const out = { ...p };
        for (const ch of ["left", "right"]) {
          if (next[ch] >= p[ch] || now - peakAt.current[ch] > 900) { out[ch] = next[ch]; peakAt.current[ch] = now; }
        }
        return out;
      });
    };
    window.addEventListener("clipeasy:audio-level", onLevel);
    return () => window.removeEventListener("clipeasy:audio-level", onLevel);
  }, []);
  const pct = (db) => `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
  return (
    <div className="audio-meter">
      <div className="meter-bars">
        <div className="meter-bar">
          <div className="meter-fill" style={{ height: pct(level.left) }} />
          <i className="meter-peak" style={{ bottom: pct(peak.left) }} />
        </div>
        <div className="meter-bar">
          <div className="meter-fill" style={{ height: pct(level.right) }} />
          <i className="meter-peak" style={{ bottom: pct(peak.right) }} />
        </div>
      </div>
      <div className="meter-scale">
        {DB_MARKS.map((db) => (
          <span key={db}>{db}</span>
        ))}
        <span>dB</span>
      </div>
    </div>
  );
}
