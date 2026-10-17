import { createProjection } from "./projections";

/**
 * Reprojection worker.
 *
 * Protocol:
 *  - { type: "source", data, width, height }  -> cache the equirectangular source once.
 *  - { type: "render", ... yStart, yEnd ... } -> render a horizontal strip of the target.
 *
 * The source is cached here so it is NOT re-sent (structured-cloned) on every frame.
 * Rendering is split into strips so several workers can share a frame.
 */

export interface ProjectionConfig {
  id: string;
  rotation: [number, number, number];
  scale: number;
  translate: [number, number];
}

export type WorkerInMessage =
  | { type: "source"; data: Uint8ClampedArray | null; width: number; height: number }
  | {
      type: "render";
      requestId: number;
      targetWidth: number;
      yStart: number;
      yEnd: number;
      highQuality: boolean;
      projectionConfig: ProjectionConfig;
    };

let src: Uint8ClampedArray | null = null;
let srcW = 0;
let srcH = 0;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const PI = Math.PI;
const HALF_PI = Math.PI / 2;

/** Writes [lon, lat] in degrees to `o`; returns false if the pixel is off the map. */
type Inverse = (px: number, py: number, o: Float64Array) => boolean;

function makeInverse(cfg: ProjectionConfig): Inverse {
  const { id, rotation, scale: k, translate } = cfg;
  const tx = translate[0];
  const ty = translate[1];

  // Inverse of d3's rotateRadians (phi/gamma inverted first, then lambda).
  const dl = rotation[0] * DEG;
  const dp = rotation[1] * DEG;
  const dg = (rotation[2] || 0) * DEG;
  const cp = Math.cos(dp), sp = Math.sin(dp);
  const cg = Math.cos(dg), sg = Math.sin(dg);

  const unrotate = (x: number, y: number, z: number, o: Float64Array): boolean => {
    const kk = z * cg - y * sg;
    let lam = Math.atan2(y * cg + z * sg, x * cp + kk * sp) - dl;
    if (lam > PI) lam -= 2 * PI;
    else if (lam < -PI) lam += 2 * PI;
    let s = kk * cp - x * sp;
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    o[0] = lam * RAD;
    o[1] = Math.asin(s) * RAD;
    return true;
  };

  // Fast hand-inlined paths for the most common projections.
  if (id === "orthographic") {
    return (px, py, o) => {
      const x = (px - tx) / k;
      const y = (ty - py) / k;
      const r2 = x * x + y * y;
      if (r2 > 1) return false;
      return unrotate(Math.sqrt(1 - r2), x, y, o);
    };
  }

  if (id === "equirectangular") {
    return (px, py, o) => {
      const lam = (px - tx) / k;
      const phi = (ty - py) / k;
      if (lam < -PI || lam > PI || phi < -HALF_PI || phi > HALF_PI) return false;
      const cphi = Math.cos(phi);
      return unrotate(cphi * Math.cos(lam), cphi * Math.sin(lam), Math.sin(phi), o);
    };
  }

  // Generic fallback via d3.
  const p = createProjection(id).rotate(rotation).scale(k).translate([tx, ty]);
  const pt: [number, number] = [0, 0];
  return (px, py, o) => {
    pt[0] = px;
    pt[1] = py;
    const c = p.invert!(pt);
    if (!c || c[0] !== c[0] || c[1] !== c[1]) return false;
    o[0] = c[0];
    o[1] = c[1];
    return true;
  };
}

function renderStrip(
  out: Uint8ClampedArray,
  W: number,
  yStart: number,
  rows: number,
  highQuality: boolean,
  cfg: ProjectionConfig
) {
  if (!src) return;
  const data = src;
  const sw = srcW;
  const sh = srcH;
  const inv = makeInverse(cfg);
  const o = new Float64Array(2);
  const sx = sw / 360;
  const sy = sh / 180;
  const maxU = sw - 1;
  const maxV = sh - 1;

  for (let r = 0; r < rows; r++) {
    const py = yStart + r;
    const rowOff = r * W;
    for (let x = 0; x < W; x++) {
      if (!inv(x, py, o)) continue;
      const u = (180 + o[0]) * sx;
      const v = (90 - o[1]) * sy;
      const ti = (rowOff + x) << 2;

      if (highQuality) {
        // Bilinear, wrapping horizontally across the antimeridian.
        let u0 = Math.floor(u);
        let v0 = Math.floor(v);
        const du = u - u0;
        const dv = v - v0;
        if (u0 >= sw) u0 -= sw;
        else if (u0 < 0) u0 += sw;
        if (v0 > maxV) v0 = maxV;
        else if (v0 < 0) v0 = 0;
        const u1 = u0 + 1 >= sw ? 0 : u0 + 1;
        const v1 = v0 + 1 > maxV ? maxV : v0 + 1;

        const i00 = (v0 * sw + u0) << 2;
        const i10 = (v0 * sw + u1) << 2;
        const i01 = (v1 * sw + u0) << 2;
        const i11 = (v1 * sw + u1) << 2;
        const w00 = (1 - du) * (1 - dv);
        const w10 = du * (1 - dv);
        const w01 = (1 - du) * dv;
        const w11 = du * dv;

        out[ti] = data[i00] * w00 + data[i10] * w10 + data[i01] * w01 + data[i11] * w11;
        out[ti + 1] = data[i00 + 1] * w00 + data[i10 + 1] * w10 + data[i01 + 1] * w01 + data[i11 + 1] * w11;
        out[ti + 2] = data[i00 + 2] * w00 + data[i10 + 2] * w10 + data[i01 + 2] * w01 + data[i11 + 2] * w11;
        out[ti + 3] = data[i00 + 3] * w00 + data[i10 + 3] * w10 + data[i01 + 3] * w01 + data[i11 + 3] * w11;
      } else {
        // Nearest neighbour.
        let su = u | 0;
        let sv = v | 0;
        if (su > maxU) su = maxU;
        else if (su < 0) su = 0;
        if (sv > maxV) sv = maxV;
        else if (sv < 0) sv = 0;
        const si = (sv * sw + su) << 2;
        out[ti] = data[si];
        out[ti + 1] = data[si + 1];
        out[ti + 2] = data[si + 2];
        out[ti + 3] = data[si + 3];
      }
    }
  }
}

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;

  if (msg.type === "source") {
    src = msg.data;
    srcW = msg.width;
    srcH = msg.height;
    return;
  }

  if (msg.type !== "render") return;

  const { requestId, targetWidth, yStart, yEnd, highQuality, projectionConfig } = msg;
  const rows = Math.max(0, yEnd - yStart);
  const out = new Uint8ClampedArray(targetWidth * rows * 4);
  let error: string | undefined;

  try {
    renderStrip(out, targetWidth, yStart, rows, highQuality, projectionConfig);
  } catch (err) {
    error = String(err);
  }

  self.postMessage({ requestId, yStart, rows, data: out, error }, [out.buffer] as any);
};
