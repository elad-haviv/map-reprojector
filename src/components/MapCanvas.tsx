import { useRef, useEffect, useImperativeHandle, forwardRef, useMemo } from "react";
import * as d3Geo from "d3-geo";
import { select } from "d3-selection";
import { drag as d3Drag } from "d3-drag";

import type { MapCanvasHandle, VectorGeometry, VectorFeature } from "./types";
import { createProjection, baseScaleFor } from "../utils/projections";

interface MapCanvasProps {
  sourceImage: HTMLImageElement | null;
  vectorData: VectorGeometry | null;
  hiddenIds: Set<string>;
  projectionId: string;
  width: number;
  height: number;
  rotation: [number, number, number];
  zoom: number;
  onInteraction: (rotation: [number, number, number], zoom: number) => void;
  /** When true, dragging draws a selection box; releasing focuses the view on it. */
  focusMode?: boolean;
  /** Called after a focus selection completes (or is too small to use). */
  onFocusComplete?: () => void;
}

type Rot = [number, number, number];

// ---- Tunables -------------------------------------------------------------
/** Raster resolution factor while dragging / zooming. */
const INTERACTIVE_SCALE = 1 / 3;
/** How often (ms) live view state is pushed back up to React during interaction. */
const STATE_SYNC_MS = 100;
/** Idle time (ms) after the last wheel tick before rendering full quality. */
const WHEEL_SETTLE_MS = 150;
/** d3 adaptive-resampling precision for vectors (higher = coarser, faster). */
const PRECISION_INTERACTIVE = 3;
const PRECISION_FULL = Math.SQRT1_2;
/** Number of reprojection workers. */
const POOL_SIZE = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
/** Body class toggled while interacting (disables backdrop blur in index.css). */
const INTERACTING_CLASS = "map-interacting";
/** Region focus: fraction of the viewport the region should fill, grid samples, animation. */
const FOCUS_FILL = 0.8;
const FOCUS_SAMPLES = 16;
const FOCUS_ANIM_MS = 700;
const FOCUS_MIN_BOX_PX = 6;
/** Min distance (px) between recorded lasso points. */
const LASSO_STEP_PX = 3;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

// Static geometry, computed once.
const GRATICULE = d3Geo.geoGraticule()();
const SPHERE = { type: "Sphere" } as const;

export const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(({
  sourceImage,
  vectorData,
  hiddenIds,
  projectionId,
  width,
  height,
  rotation,
  zoom,
  onInteraction,
  focusMode = false,
  onFocusComplete,
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lassoPathRef = useRef<SVGPathElement>(null);
  const focusModeRef = useRef(focusMode);
  focusModeRef.current = focusMode;
  const onFocusCompleteRef = useRef(onFocusComplete);
  onFocusCompleteRef.current = onFocusComplete;
  const animRef = useRef(0);
  const workersRef = useRef<Worker[]>([]);
  const lowResCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hasSourceRef = useRef(false);

  // Live view state. Drag/wheel mutate these directly; React state is only synced (throttled).
  const rotationRef = useRef<Rot>(rotation);
  const zoomRef = useRef(zoom);
  const lastSentRotationRef = useRef<Rot>(rotation);
  const lastSentZoomRef = useRef(zoom);
  const interactingRef = useRef(false);
  const draggingRef = useRef(false);

  // Latest props, readable from long-lived handlers without stale closures.
  const propsRef = useRef({ width, height, projectionId, onInteraction });
  propsRef.current = { width, height, projectionId, onInteraction };

  const visibleFeatures = useMemo<VectorFeature[]>(
    () => (vectorData ? vectorData.features.filter((f) => !hiddenIds.has(f.id)) : []),
    [vectorData, hiddenIds]
  );
  const visibleFeaturesRef = useRef(visibleFeatures);
  visibleFeaturesRef.current = visibleFeatures;

  const projection = useMemo(() => createProjection(projectionId), [projectionId]);
  const projectionRef = useRef(projection);
  projectionRef.current = projection;

  // Render scheduling state.
  const rafRef = useRef(0);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const requestIdRef = useRef(0);
  const jobRef = useRef<{ id: number; w: number; h: number; remaining: number; data: Uint8ClampedArray } | null>(null);
  const reportTimerRef = useRef(0);
  const lastReportTimeRef = useRef(0);

  /**
   * Engine: all functions only read refs, so they're created once and are safe to call
   * from long-lived event handlers / worker callbacks.
   */
  const engine = useMemo(() => {
    const syncProjection = (scaleFactor = 1) => {
      const { width, height, projectionId } = propsRef.current;
      const p = projectionRef.current;
      p.scale(baseScaleFor(projectionId, width, height) * zoomRef.current * scaleFactor)
        .translate([(width / 2) * scaleFactor, (height / 2) * scaleFactor])
        .rotate(rotationRef.current);
      return p;
    };

    const drawOverlay = (ctx: CanvasRenderingContext2D) => {
      const interacting = interactingRef.current;
      const p = syncProjection(1);
      p.precision(interacting ? PRECISION_INTERACTIVE : PRECISION_FULL);
      const path = d3Geo.geoPath(p, ctx);

      for (const f of visibleFeaturesRef.current) {
        ctx.strokeStyle = f.properties.stroke;
        ctx.lineWidth = interacting ? 0.5 : f.properties.strokeWidth;
        ctx.beginPath();
        path(f as any);
        ctx.stroke();
      }

      ctx.strokeStyle = "rgba(59, 130, 246, 0.15)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      path(GRATICULE);
      ctx.stroke();

      ctx.strokeStyle = "rgba(59, 130, 246, 0.4)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      path(SPHERE);
      ctx.stroke();
    };

    const drawRaster = (ctx: CanvasRenderingContext2D, data: Uint8ClampedArray, w: number, h: number) => {
      const { width, height } = propsRef.current;
      ctx.clearRect(0, 0, width, height);
      const img = new ImageData(data as any, w, h);
      if (w !== width || h !== height) {
        // Reuse one offscreen canvas instead of allocating per frame.
        let off = lowResCanvasRef.current;
        if (!off) off = lowResCanvasRef.current = document.createElement("canvas");
        if (off.width !== w) off.width = w;
        if (off.height !== h) off.height = h;
        off.getContext("2d")!.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(off, 0, 0, width, height);
      } else {
        ctx.putImageData(img, 0, 0);
      }
    };

    const renderFrame = () => {
      rafRef.current = 0;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Vector-only: draw synchronously.
      if (!hasSourceRef.current || workersRef.current.length === 0) {
        const { width, height } = propsRef.current;
        ctx.clearRect(0, 0, width, height);
        drawOverlay(ctx);
        return;
      }

      // One frame in flight at a time; coalesce extra requests.
      if (inFlightRef.current) {
        pendingRef.current = true;
        return;
      }

      const interacting = interactingRef.current;
      const sf = interacting ? INTERACTIVE_SCALE : 1;
      const { width, height, projectionId } = propsRef.current;
      const w = Math.max(1, Math.floor(width * sf));
      const h = Math.max(1, Math.floor(height * sf));
      const p = syncProjection(sf);
      const t = p.translate();
      const projectionConfig = {
        id: projectionId,
        rotation: [...rotationRef.current] as Rot,
        scale: p.scale(),
        translate: [t[0], t[1]] as [number, number],
      };

      const workers = workersRef.current;
      const id = ++requestIdRef.current;
      jobRef.current = { id, w, h, remaining: workers.length, data: new Uint8ClampedArray(w * h * 4) };
      inFlightRef.current = true;
      pendingRef.current = false;

      const rowsPer = Math.ceil(h / workers.length);
      workers.forEach((worker, i) => {
        const yStart = Math.min(h, i * rowsPer);
        const yEnd = Math.min(h, yStart + rowsPer);
        worker.postMessage({
          type: "render",
          requestId: id,
          targetWidth: w,
          yStart,
          yEnd,
          highQuality: !interacting,
          projectionConfig,
        });
      });
    };

    const scheduleRender = () => {
      if (!rafRef.current) rafRef.current = requestAnimationFrame(renderFrame);
    };

    const onWorkerMessage = (e: MessageEvent) => {
      const m = e.data as { requestId: number; yStart: number; rows: number; data: Uint8ClampedArray; error?: string };
      const job = jobRef.current;
      if (!job || m.requestId !== job.id) return;
      if (m.error) console.error("Reprojection worker error:", m.error);
      if (m.data && m.data.length) job.data.set(m.data, m.yStart * job.w * 4);
      if (--job.remaining > 0) return;

      jobRef.current = null;
      inFlightRef.current = false;

      const ctx = canvasRef.current?.getContext("2d");
      if (ctx) {
        drawRaster(ctx, job.data, job.w, job.h);
        drawOverlay(ctx);
      }

      if (pendingRef.current) {
        pendingRef.current = false;
        scheduleRender();
      }
    };

    /** Push live view state to React, throttled (or immediately with force). */
    const report = (force: boolean) => {
      const flush = () => {
        reportTimerRef.current = 0;
        lastReportTimeRef.current = performance.now();
        const r = rotationRef.current;
        const z = zoomRef.current;
        lastSentRotationRef.current = r;
        lastSentZoomRef.current = z;
        propsRef.current.onInteraction(r, z);
      };
      if (force) {
        clearTimeout(reportTimerRef.current);
        flush();
        return;
      }
      if (reportTimerRef.current) return;
      const wait = Math.max(0, STATE_SYNC_MS - (performance.now() - lastReportTimeRef.current));
      reportTimerRef.current = window.setTimeout(flush, wait);
    };

    const setInteracting = (on: boolean) => {
      interactingRef.current = on;
      document.body.classList.toggle(INTERACTING_CLASS, on);
    };

    return { syncProjection, scheduleRender, onWorkerMessage, report, setInteracting };
  }, []);

  useImperativeHandle(ref, () => ({
    exportImage: () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const link = document.createElement("a");
      link.download = `reprojection-${projectionId}-${Date.now()}.png`;
      link.href = canvas.toDataURL("image/png", 1.0);
      link.click();
    },
    exportSVG: () => {
      if (!vectorData) return;

      const p = engine.syncProjection(1);
      p.precision(PRECISION_FULL);
      const path = d3Geo.geoPath(p);

      const paths = visibleFeatures.map(f => {
        const d = path(f as any);
        return d ? `<path d="${d}" fill="none" stroke="${f.properties.stroke || '#3b82f6'}" stroke-width="1" />` : '';
      }).join('\n');

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background-color: black;">
        ${paths}
      </svg>`;

      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `reprojection-${projectionId}-${Date.now()}.svg`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    }
  }));

  // Worker pool: created once.
  useEffect(() => {
    const workers: Worker[] = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const w = new Worker(new URL("../utils/reprojection.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = engine.onWorkerMessage;
      workers.push(w);
    }
    workersRef.current = workers;

    return () => {
      workers.forEach((w) => w.terminate());
      workersRef.current = [];
      jobRef.current = null;
      inFlightRef.current = false;
      pendingRef.current = false;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      clearTimeout(reportTimerRef.current);
      reportTimerRef.current = 0;
      document.body.classList.remove(INTERACTING_CLASS);
    };
  }, [engine]);

  // Decode the source image once and hand it to every worker once (not per frame).
  useEffect(() => {
    const workers = workersRef.current;
    if (!sourceImage) {
      hasSourceRef.current = false;
      workers.forEach((w) => w.postMessage({ type: "source", data: null, width: 0, height: 0 }));
      engine.scheduleRender();
      return;
    }
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = sourceImage.width;
    tempCanvas.height = sourceImage.height;
    const tempCtx = tempCanvas.getContext("2d");
    if (!tempCtx) return;
    tempCtx.drawImage(sourceImage, 0, 0);
    const { data } = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    workers.forEach((w) =>
      w.postMessage({ type: "source", data, width: tempCanvas.width, height: tempCanvas.height })
    );
    hasSourceRef.current = true;
    engine.scheduleRender();
  }, [sourceImage, engine]);

  // Apply external rotation/zoom changes (sidebar controls, buttons). Values we reported
  // ourselves are recognised by identity and ignored so they can't rewind a live drag.
  useEffect(() => {
    let changed = false;
    if (rotation !== lastSentRotationRef.current) {
      rotationRef.current = rotation;
      lastSentRotationRef.current = rotation;
      changed = true;
    }
    if (zoom !== lastSentZoomRef.current) {
      zoomRef.current = zoom;
      lastSentZoomRef.current = zoom;
      changed = true;
    }
    if (changed) engine.scheduleRender();
  }, [rotation, zoom, engine]);

  // Redraw on anything else that affects the picture.
  useEffect(() => {
    engine.scheduleRender();
  }, [projection, width, height, visibleFeatures, engine]);

  // Drag + wheel handlers: bound once, read everything from refs.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const selection = select(canvas);
    let wheelTimer = 0;
    let lasso: [number, number][] | null = null;

    const cancelAnim = () => {
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
        animRef.current = 0;
      }
    };

    /** Animate rotation (shortest longitude path) and zoom (geometric) to a target. */
    const animateTo = (target: Rot, targetZoom: number) => {
      cancelAnim();
      const from = rotationRef.current;
      const fromZoom = zoomRef.current;
      let dLon = (target[0] - from[0]) % 360;
      if (dLon > 180) dLon -= 360;
      else if (dLon < -180) dLon += 360;
      const dLat = target[1] - from[1];
      const dGam = target[2] - from[2];
      const zRatio = targetZoom / fromZoom;
      const t0 = performance.now();
      engine.setInteracting(true);

      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / FOCUS_ANIM_MS);
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // cubic in-out
        rotationRef.current = [from[0] + dLon * e, from[1] + dLat * e, from[2] + dGam * e];
        zoomRef.current = fromZoom * Math.pow(zRatio, e);
        engine.scheduleRender();
        if (t < 1) {
          engine.report(false);
          animRef.current = requestAnimationFrame(step);
        } else {
          animRef.current = 0;
          engine.setInteracting(false);
          engine.report(true);
          engine.scheduleRender();
        }
      };
      animRef.current = requestAnimationFrame(step);
    };

    /**
     * Focus on a lasso polygon (screen px): sample points inside it plus its outline, take the
     * spherical centroid as the new projection centre (where most projections have least
     * distortion), then fit zoom so the region fills the view.
     */
    const focusOnPolygon = (poly: [number, number][]) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of poly) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      const inside = (x: number, y: number) => {
        let c = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const [xi, yi] = poly[i], [xj, yj] = poly[j];
          if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
        }
        return c;
      };

      const screenPts: [number, number][] = [];
      for (let i = 0; i <= FOCUS_SAMPLES; i++) {
        for (let j = 0; j <= FOCUS_SAMPLES; j++) {
          const x = x0 + ((x1 - x0) * i) / FOCUS_SAMPLES;
          const y = y0 + ((y1 - y0) * j) / FOCUS_SAMPLES;
          if (inside(x, y)) screenPts.push([x, y]);
        }
      }
      const stride = Math.max(1, Math.floor(poly.length / 64));
      for (let i = 0; i < poly.length; i += stride) screenPts.push(poly[i]);

      const p = engine.syncProjection(1);
      const pts: [number, number][] = [];
      for (const sp of screenPts) {
        const c = p.invert?.(sp);
        if (c && Number.isFinite(c[0]) && Number.isFinite(c[1])) pts.push([c[0], c[1]]);
      }
      if (pts.length < 3) return;

      let X = 0, Y = 0, Z = 0;
      for (const [lon, lat] of pts) {
        const l = lon * DEG, f = lat * DEG, cf = Math.cos(f);
        X += cf * Math.cos(l);
        Y += cf * Math.sin(l);
        Z += Math.sin(f);
      }
      const cLon = Math.atan2(Y, X) * RAD;
      const cLat = Math.atan2(Z, Math.hypot(X, Y)) * RAD;
      const target: Rot = [-cLon, -cLat, 0];

      const { width, height, projectionId } = propsRef.current;
      const fit = createProjection(projectionId)
        .rotate(target)
        .scale(baseScaleFor(projectionId, width, height))
        .translate([width / 2, height / 2]);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const pt of pts) {
        const s = fit(pt);
        if (!s || !Number.isFinite(s[0]) || !Number.isFinite(s[1])) continue;
        if (s[0] < minX) minX = s[0];
        if (s[0] > maxX) maxX = s[0];
        if (s[1] < minY) minY = s[1];
        if (s[1] > maxY) maxY = s[1];
      }
      let targetZoom = zoomRef.current;
      if (Number.isFinite(minX)) {
        const bw = Math.max(1, maxX - minX);
        const bh = Math.max(1, maxY - minY);
        targetZoom = Math.max(0.1, Math.min(40, Math.min((width * FOCUS_FILL) / bw, (height * FOCUS_FILL) / bh)));
      }
      animateTo(target, targetZoom);
    };

    const drawLasso = (pts: [number, number][], closed: boolean) => {
      const path = lassoPathRef.current;
      if (!path) return;
      path.setAttribute("d", pts.length ? "M" + pts.map((q) => `${q[0]},${q[1]}`).join("L") + (closed ? "Z" : "") : "");
    };
    const clearLasso = () => drawLasso([], false);

    const dragHandler = d3Drag<HTMLCanvasElement, unknown>()
      .on("start", (event) => {
        cancelAnim();
        if (focusModeRef.current) {
          lasso = [[event.x, event.y]];
          drawLasso(lasso, false);
          return;
        }
        lasso = null;
        draggingRef.current = true;
        clearTimeout(wheelTimer);
        engine.setInteracting(true);
      })
      .on("drag", (event) => {
        if (lasso) {
          const last = lasso[lasso.length - 1];
          if (Math.hypot(event.x - last[0], event.y - last[1]) >= LASSO_STEP_PX) {
            lasso.push([event.x, event.y]);
            drawLasso(lasso, false);
          }
          return;
        }
        const { width, height, projectionId } = propsRef.current;
        const sensitivity = 70 / (baseScaleFor(projectionId, width, height) * zoomRef.current);
        const r = rotationRef.current;
        rotationRef.current = [
          r[0] + event.dx * sensitivity,
          Math.max(-90, Math.min(90, r[1] - event.dy * sensitivity)),
          r[2],
        ];
        engine.scheduleRender();
        engine.report(false);
      })
      .on("end", (event) => {
        if (lasso) {
          const poly = lasso;
          lasso = null;
          drawLasso(poly, true);
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const [x, y] of poly) {
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          }
          if (poly.length >= 3 && maxX - minX >= FOCUS_MIN_BOX_PX && maxY - minY >= FOCUS_MIN_BOX_PX) {
            focusOnPolygon(poly);
          }
          // Briefly show the closed outline, then clear it.
          window.setTimeout(clearLasso, 250);
          onFocusCompleteRef.current?.();
          return;
        }
        draggingRef.current = false;
        engine.setInteracting(false);
        engine.report(true);
        engine.scheduleRender();
      });

    selection.call(dragHandler as any);

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelAnim();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      zoomRef.current = Math.max(0.1, Math.min(40, zoomRef.current * delta));
      engine.setInteracting(true);
      engine.scheduleRender();
      engine.report(false);
      clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => {
        if (draggingRef.current) return;
        engine.setInteracting(false);
        engine.report(true);
        engine.scheduleRender();
      }, WHEEL_SETTLE_MS);
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", handleWheel);
      selection.on(".drag", null);
      clearTimeout(wheelTimer);
      cancelAnim();
    };
  }, [engine]);

  return (
    <>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className={`${focusMode ? "cursor-crosshair" : "cursor-move"} w-full h-full block`}
      />
      <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
        <path
          ref={lassoPathRef}
          fill="rgba(59,130,246,0.12)"
          stroke="#60a5fa"
          strokeWidth={2}
          strokeDasharray="6 4"
          strokeLinejoin="round"
          strokeLinecap="round"
          style={{ filter: "drop-shadow(0 0 6px rgba(59,130,246,0.6))" }}
        />
      </svg>
    </>
  );
});
