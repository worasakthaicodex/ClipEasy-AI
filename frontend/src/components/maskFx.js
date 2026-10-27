// Mask coordinates and tracking times are always in the original source image.
export const IDENTITY = [1, 0, 0, 1, 0, 0];
export const MASK_DEFAULTS = { enabled: true, scale: 160, feather: 0, start: 0, enter: .4, hold: .8, exit: .4, bounce: .2, trackingEnabled: true };
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const hasMask = (t = {}) => Array.isArray(t.fxMaskPath) && t.fxMaskPath.length >= 3;
export function transformPoint(p, m = IDENTITY) { return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }; }
export function invertPoint(p, m = IDENTITY) {
  const d = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(d) < 1e-8) return p;
  return { x: (m[3] * (p.x - m[4]) - m[2] * (p.y - m[5])) / d, y: (-m[1] * (p.x - m[4]) + m[0] * (p.y - m[5])) / d };
}
export function maskBounds(points) {
  if (!points?.length) return { x: 0, y: 0, w: 1, h: 1 };
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
export function maskMatrixAt(t, sourceTime) {
  const track = t.maskFx?.trackingEnabled === false ? [] : t.fxMaskTrack || [];
  if (!track.length) return IDENTITY;
  if (sourceTime <= track[0].time) return track[0].matrix;
  let lo = 0, hi = track.length - 1;
  while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (track[mid].time <= sourceTime) lo = mid; else hi = mid; }
  const a = track[lo], b = track[hi];
  const k = clamp((sourceTime - a.time) / Math.max(1e-8, b.time - a.time), 0, 1);
  return a.matrix.map((v, i) => v + (b.matrix[i] - v) * k);
}
export function maskEnvelope(fx, localTime) {
  const t = localTime - Math.max(0, fx.start || 0);
  const enter = Math.max(0, fx.enter ?? .4), hold = Math.max(0, fx.hold ?? .8), exit = Math.max(0, fx.exit ?? .4);
  if (t < 0 || t >= enter + hold + exit) return 0;
  const smooth = p => p * p * (3 - 2 * p);
  if (enter > 0 && t < enter) { const p = t / enter; return smooth(p) + clamp(fx.bounce ?? .2, 0, 1) * Math.sin(Math.PI * p); }
  if (t <= enter + hold) return 1;
  return exit > 0 ? 1 - smooth(clamp((t - enter - hold) / exit, 0, 1)) : 0;
}
export function maskStateAt(t = {}, sourceTime = 0, localTime = 0) {
  const fx = { ...MASK_DEFAULTS, ...t.maskFx }, matrix = maskMatrixAt(t, sourceTime);
  const base = t.fxMaskPath || [], bounds = maskBounds(base);
  const center = fx.center || { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
  return { points: base.map(p => transformPoint(p, matrix)), center: transformPoint(center, matrix), matrix,
    scale: fx.enabled && hasMask(t) ? 1 + (clamp(fx.scale, 100, 400) / 100 - 1) * maskEnvelope(fx, localTime) : 1,
    feather: clamp(fx.feather || 0, 0, .05) };
}

// Ramer–Douglas–Peucker keeps editable control points without hundreds of mouse samples.
export function simplifyMask(points, tolerance = .002) {
  const clean = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)).map(p => ({ x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) }));
  function simplify(ps) {
    if (ps.length <= 2) return ps;
    const a = ps[0], b = ps[ps.length - 1], dx = b.x - a.x, dy = b.y - a.y;
    let best = tolerance * tolerance, index = -1;
    for (let i = 1; i < ps.length - 1; i++) {
      const p = ps[i], k = dx || dy ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy), 0, 1) : 0;
      const d = (p.x - a.x - k * dx) ** 2 + (p.y - a.y - k * dy) ** 2;
      if (d > best) { best = d; index = i; }
    }
    if (index < 0) return [a, b];
    return [...simplify(ps.slice(0, index + 1)).slice(0, -1), ...simplify(ps.slice(index))];
  }
  let out = simplify(clean);
  if (out.length > 128) {
    const dense = out;
    out = Array.from({ length: 128 }, (_, i) => dense[Math.round(i * (dense.length - 1) / 127)]);
  }
  return out;
}

const buffers = new WeakMap();
export function renderMaskFrame(ctx, source, transform, sourceTime, localTime) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  const state = maskStateAt(transform, sourceTime, localTime);
  if (state.points.length < 3 || Math.abs(state.scale - 1) < 1e-6) return;
  let pair = buffers.get(ctx);
  if (!pair) { pair = [document.createElement('canvas'), document.createElement('canvas')]; buffers.set(ctx, pair); }
  const [cut, mask] = pair;
  for (const c of pair) if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const mc = mask.getContext('2d'), cc = cut.getContext('2d');
  mc.clearRect(0, 0, w, h); mc.save();
  mc.filter = state.feather > 0 ? `blur(${state.feather * Math.min(w, h)}px)` : 'none';
  mc.fillStyle = '#fff'; mc.beginPath();
  state.points.forEach((p, i) => i ? mc.lineTo(p.x * w, p.y * h) : mc.moveTo(p.x * w, p.y * h));
  mc.closePath(); mc.fill(); mc.restore();
  cc.clearRect(0, 0, w, h); cc.drawImage(source, 0, 0, w, h);
  cc.globalCompositeOperation = 'destination-in'; cc.drawImage(mask, 0, 0); cc.globalCompositeOperation = 'source-over';
  ctx.save(); ctx.translate(state.center.x * w, state.center.y * h); ctx.scale(state.scale, state.scale);
  ctx.translate(-state.center.x * w, -state.center.y * h); ctx.drawImage(cut, 0, 0); ctx.restore();
}
