const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

let mask;
before(async () => {
  const source = await readFile(path.join(__dirname, "../src/components/maskFx.js"), "utf8");
  mask = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
});

const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, message || `${actual} should equal ${expected}`);
const pointNear = (actual, expected) => { near(actual.x, expected.x); near(actual.y, expected.y); };
const square = [{ x: .2, y: .2 }, { x: .4, y: .2 }, { x: .4, y: .6 }, { x: .2, y: .6 }];

test("animation follows clip-local start, expand, hold, return, and ends at normal scale", () => {
  const fx = { start: 2, enter: 1, hold: 2, exit: 1, bounce: 0 };
  for (const [time, expected] of [[0, 0], [1.999, 0], [2, 0], [2.5, .5], [3, 1], [4, 1], [5, 1], [5.5, .5], [6, 0], [6.001, 0]]) {
    near(mask.maskEnvelope(fx, time), expected, `envelope at local time ${time}`);
  }
});

test("zero-length animation does not produce a one-frame flash", () => {
  const fx = { start: 1, enter: 0, hold: 0, exit: 0, bounce: 0 };
  for (const time of [.999, 1, 1.001]) assert.equal(mask.maskEnvelope(fx, time), 0);
});

test("instant entrance and exit still support a visible hold", () => {
  const fx = { start: 1, enter: 0, hold: .5, exit: 0, bounce: 0 };
  assert.equal(mask.maskEnvelope(fx, .99), 0);
  assert.equal(mask.maskEnvelope(fx, 1), 1);
  assert.equal(mask.maskEnvelope(fx, 1.25), 1);
  assert.equal(mask.maskEnvelope(fx, 1.51), 0);
});

test("bounce adds overshoot but settles at the selected maximum before holding", () => {
  const plain = { start: 0, enter: 1, hold: 1, exit: 1, bounce: 0 };
  for (let n = 0; n <= 100; n++) {
    const value = mask.maskEnvelope(plain, n / 100);
    assert.ok(value >= 0 && value <= 1);
  }
  assert.ok(mask.maskEnvelope({ ...plain, bounce: .2 }, .9) > 1);
  near(mask.maskEnvelope({ ...plain, bounce: .2 }, 1), 1);
});

test("tracking uses source timestamps and clamps outside its stored range", () => {
  const first = [1, 0, 0, 1, 0, 0];
  const middle = [1.5, 0, 0, 1.5, .2, -.1];
  const last = [2, 0, 0, 2, .4, .1];
  const transform = { fxMaskTrack: [{ time: 10, matrix: first }, { time: 12, matrix: middle }, { time: 14, matrix: last }] };
  assert.deepEqual(mask.maskMatrixAt(transform, 0), first);
  assert.deepEqual(mask.maskMatrixAt(transform, 12), middle);
  assert.deepEqual(mask.maskMatrixAt(transform, 20), last);
  assert.deepEqual(mask.maskMatrixAt(transform, 11), [1.25, 0, 0, 1.25, .1, -.05]);
  assert.deepEqual(mask.maskMatrixAt(transform, 13), [1.75, 0, 0, 1.75, .30000000000000004, 0]);
});

test("empty and single-frame tracks are valid and tracking can be disabled", () => {
  assert.deepEqual(mask.maskMatrixAt({}, 9), mask.IDENTITY);
  const matrix = [1, 0, 0, 1, .15, .2];
  const transform = { fxMaskTrack: [{ time: 10, matrix }] };
  assert.deepEqual(mask.maskMatrixAt(transform, 0), matrix);
  assert.deepEqual(mask.maskMatrixAt(transform, 100), matrix);
  assert.deepEqual(mask.maskMatrixAt({ ...transform, maskFx: { trackingEnabled: false } }, 10), mask.IDENTITY);
});

test("tracked mask and automatic pivot move together while animation remains clip-local", () => {
  const transform = {
    fxMaskPath: square,
    fxMaskTrack: [{ time: 20, matrix: [2, 0, 0, 2, .1, -.1] }],
    maskFx: { start: 1, enter: 1, hold: 2, exit: 1, scale: 160, bounce: 0 },
  };
  const before = mask.maskStateAt(transform, 20, .5);
  pointNear(before.center, { x: .7, y: .7 });
  pointNear(before.points[0], { x: .5, y: .3 });
  near(before.scale, 1);
  const during = mask.maskStateAt(transform, 20, 2);
  pointNear(during.center, before.center);
  near(during.scale, 1.6);
  near(mask.maskStateAt(transform, 20, 6).scale, 1);
});

test("custom pivot is transformed in source space and disabling tracking restores it", () => {
  const transform = { fxMaskPath: square, fxMaskTrack: [{ time: 1, matrix: [0, 1, -1, 0, 1, 0] }], maskFx: { center: { x: .3, y: .6 } } };
  pointNear(mask.maskStateAt(transform, 1, 1).center, { x: .4, y: .3 });
  pointNear(mask.maskStateAt({ ...transform, maskFx: { ...transform.maskFx, trackingEnabled: false } }, 1, 1).center, { x: .3, y: .6 });
});

test("disabled effect and incomplete masks retain original scale; supported limits are enforced", () => {
  const base = { fxMaskPath: square, maskFx: { scale: 900, feather: .5, enter: 0, hold: 5, exit: 0 } };
  const active = mask.maskStateAt(base, 1, 1);
  near(active.scale, 4);
  near(active.feather, .05);
  near(mask.maskStateAt({ ...base, maskFx: { ...base.maskFx, enabled: false } }, 1, 1).scale, 1);
  near(mask.maskStateAt({ ...base, fxMaskPath: square.slice(0, 2) }, 1, 1).scale, 1);
  near(mask.maskStateAt({ ...base, maskFx: { ...base.maskFx, scale: 0, feather: -1 } }, 1, 1).scale, 1);
});

test("inverse mapping preserves an edited point across scale, rotation, and translation", () => {
  const point = { x: .24, y: .62 };
  for (const matrix of [[1, 0, 0, 1, .3, -.2], [0, 2, -2, 0, 1, .2], [1.2, .3, -.1, .9, -.2, .3]]) {
    pointNear(mask.invertPoint(mask.transformPoint(point, matrix), matrix), point);
  }
  pointNear(mask.invertPoint(point, [0, 0, 0, 0, 0, 0]), point);
});

test("freehand simplification removes redundant edge samples while retaining polygon corners", () => {
  const samples = [];
  const corners = [...square, square[0]];
  for (let edge = 0; edge < 4; edge++) {
    for (let n = 0; n < 25; n++) {
      const a = corners[edge], b = corners[edge + 1], k = n / 25;
      samples.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
    }
  }
  samples.push(square[0]);
  const result = mask.simplifyMask(samples);
  assert.ok(result.length < 10);
  for (const corner of square) assert.ok(result.some((p) => Math.hypot(p.x - corner.x, p.y - corner.y) < 1e-9));
});

test("dense freehand strokes stay editable without dropping the last boundary point", () => {
  const points = Array.from({ length: 300 }, (_, n) => ({ x: n / 299, y: n % 2 ? .8 : .2 }));
  const result = mask.simplifyMask(points, .0001);
  assert.ok(result.length >= 3 && result.length <= 128);
  pointNear(result[0], points[0]);
  pointNear(result.at(-1), points.at(-1));
});

test("invalid pointer samples are ignored and coordinates stay normalized", () => {
  const points = [{ x: NaN, y: .2 }, { x: -.5, y: -.2 }, { x: .5, y: 1.8 }, { x: 2, y: -.3 }, { x: Infinity, y: 0 }];
  const result = mask.simplifyMask(points);
  assert.equal(result.length, 3);
  assert.ok(result.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1));
  assert.deepEqual(mask.simplifyMask([]), []);
});
