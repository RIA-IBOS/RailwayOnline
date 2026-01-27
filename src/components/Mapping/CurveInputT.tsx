import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';

import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import type { DynmapProjection } from '@/lib/DynmapProjection';

import { DraggablePanel } from '@/components/DraggablePanel/DraggablePanel';
import AppButton from '@/components/ui/AppButton';
import AppCard from '@/components/ui/AppCard';

import { X, ArrowLeftRight, Plus, Trash2 } from 'lucide-react';

import {
  formatGridNumber,
  parseStepNumber,
  snapWorldPointByMode,
  roundToStepStable,
} from '@/components/Mapping/GridSnapModeSwitch';

export type WorldPoint = { x: number; z: number; y?: number };

export type CurveInputTHandle = {
  requestCloseAndClear: () => void;
  isOpen: () => boolean;
};

type CurveInputTProps = {
  enabled?: boolean;
  /** 主控件当前是否已处于 click 抑制状态（例如 ControlPointsT 正在工作） */
  externallySuppressed?: boolean;
  mapReady: boolean;
  leafletMapRef: MutableRefObject<L.Map | null>;
  projectionRef: MutableRefObject<DynmapProjection | null>;
  activeMode: 'none' | 'point' | 'polyline' | 'polygon';

  /** 与主绘制一致的辅助线过滤（点选输入） */
  filterWorldPointByAssistLine?: (p: WorldPoint) => WorldPoint;

  /** 打开/关闭时抑制主绘制 click 加点 */
  onSetDrawClickSuppressed?: (suppressed: boolean) => void;

  /** 输出：将生成的点序列按顺序追加到当前要素控制点末尾 */
  onCommitPoints: (points: WorldPoint[]) => void;

  /** 外层容器 className（用于在主界面并排布局等场景） */
  outerClassName?: string;
};

const Y_FOR_DISPLAY = 64;

const snapToHalf = (n: number) => roundToStepStable(n, 0.5);
const snapToTenth = (n: number) => roundToStepStable(n, 0.1);

const dist = (a: WorldPoint, b: WorldPoint) => Math.hypot(a.x - b.x, a.z - b.z);

const wrapToPi = (a: number) => {
  let x = a;
  while (x <= -Math.PI) x += Math.PI * 2;
  while (x > Math.PI) x -= Math.PI * 2;
  return x;
};

function resampleByArcLength(polyline: WorldPoint[], dotcnt: number): WorldPoint[] {
  if (!Array.isArray(polyline) || polyline.length === 0) return [];
  if (polyline.length === 1) return [polyline[0]];
  const pts = polyline;
  const acc: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    acc[i] = acc[i - 1] + dist(pts[i], pts[i - 1]);
  }
  const total = acc[acc.length - 1];
  if (!Number.isFinite(total) || total <= 1e-9) {
    return Array.from({ length: dotcnt }, () => ({ ...pts[0] }));
  }

  const out: WorldPoint[] = [];
  for (let k = 0; k < dotcnt; k++) {
    const s = (total * k) / (dotcnt - 1);
    // find segment
    let j = 1;
    while (j < acc.length && acc[j] < s) j++;
    if (j >= acc.length) {
      out.push({ ...pts[pts.length - 1] });
      continue;
    }
    const s0 = acc[j - 1];
    const s1 = acc[j];
    const t = s1 - s0 <= 1e-9 ? 0 : (s - s0) / (s1 - s0);
    const a = pts[j - 1];
    const b = pts[j];
    out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  }
  return out;
}

function removeConsecutiveDuplicates(points: WorldPoint[], eps = 1e-9): WorldPoint[] {
  const out: WorldPoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) <= eps && Math.abs(last.z - p.z) <= eps) continue;
    out.push(p);
  }
  return out;
}

type ArcSide = 'left' | 'right';

type ArcSolution = {
  ok: true;
  C: WorldPoint;
  a0: number;
  delta: number;
  M: WorldPoint;
  n: WorldPoint; // unit normal (left)
  h: number;
  d: number;
};

type ArcFail = { ok: false; reason: string };

function solveArc(P0: WorldPoint, P1: WorldPoint, R: number, side: ArcSide): ArcSolution | ArcFail {
  const d = dist(P0, P1);
  if (!Number.isFinite(R) || R <= 0) return { ok: false, reason: '半径非法' };
  if (!Number.isFinite(d) || d <= 1e-9) return { ok: false, reason: '起止点过近' };
  if (d > 2 * R + 1e-9) return { ok: false, reason: '半径过小（需满足 d ≤ 2R）' };

  const M = { x: (P0.x + P1.x) / 2, z: (P0.z + P1.z) / 2 };
  const tx = (P1.x - P0.x) / d;
  const tz = (P1.z - P0.z) / d;
  const n = { x: -tz, z: tx };

  const hh = Math.max(0, R * R - (d / 2) * (d / 2));
  const h = Math.sqrt(hh);
  const sign = side === 'left' ? 1 : -1;
  const C = { x: M.x + n.x * h * sign, z: M.z + n.z * h * sign };

  const a0 = Math.atan2(P0.z - C.z, P0.x - C.x);
  const a1 = Math.atan2(P1.z - C.z, P1.x - C.x);
  const delta = wrapToPi(a1 - a0);

  return { ok: true, C, a0, delta, M, n, h, d };
}

function sampleArcDense(sol: ArcSolution, R: number, steps = 128): WorldPoint[] {
  const out: WorldPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = sol.a0 + sol.delta * t;
    out.push({ x: sol.C.x + Math.cos(a) * R, z: sol.C.z + Math.sin(a) * R });
  }
  return out;
}

// --------- Centripedal Catmull-Rom (B1) ---------
function catmullRomCentripetalDense(anchors: WorldPoint[], samplesPerSeg = 40): WorldPoint[] {
  const pts = anchors.slice();
  if (pts.length < 2) return pts;

  // duplicate endpoints for boundary
  const p: WorldPoint[] = [pts[0], ...pts, pts[pts.length - 1]];
  const out: WorldPoint[] = [];
  const alpha = 0.5;

  const tj = (ti: number, a: WorldPoint, b: WorldPoint) => {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    return ti + Math.pow(d, alpha);
  };

  for (let i = 1; i < p.length - 2; i++) {
    const p0 = p[i - 1];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2];

    let t0 = 0;
    let t1 = tj(t0, p0, p1);
    let t2 = tj(t1, p1, p2);
    let t3 = tj(t2, p2, p3);

    // Guard against coincident points
    if (Math.abs(t1 - t0) < 1e-9) t1 = t0 + 1;
    if (Math.abs(t2 - t1) < 1e-9) t2 = t1 + 1;
    if (Math.abs(t3 - t2) < 1e-9) t3 = t2 + 1;

    for (let s = 0; s <= samplesPerSeg; s++) {
      const t = t1 + ((t2 - t1) * s) / samplesPerSeg;

      const A1 = {
        x: ((t1 - t) / (t1 - t0)) * p0.x + ((t - t0) / (t1 - t0)) * p1.x,
        z: ((t1 - t) / (t1 - t0)) * p0.z + ((t - t0) / (t1 - t0)) * p1.z,
      };
      const A2 = {
        x: ((t2 - t) / (t2 - t1)) * p1.x + ((t - t1) / (t2 - t1)) * p2.x,
        z: ((t2 - t) / (t2 - t1)) * p1.z + ((t - t1) / (t2 - t1)) * p2.z,
      };
      const A3 = {
        x: ((t3 - t) / (t3 - t2)) * p2.x + ((t - t2) / (t3 - t2)) * p3.x,
        z: ((t3 - t) / (t3 - t2)) * p2.z + ((t - t2) / (t3 - t2)) * p3.z,
      };

      const B1 = {
        x: ((t2 - t) / (t2 - t0)) * A1.x + ((t - t0) / (t2 - t0)) * A2.x,
        z: ((t2 - t) / (t2 - t0)) * A1.z + ((t - t0) / (t2 - t0)) * A2.z,
      };
      const B2 = {
        x: ((t3 - t) / (t3 - t1)) * A2.x + ((t - t1) / (t3 - t1)) * A3.x,
        z: ((t3 - t) / (t3 - t1)) * A2.z + ((t - t1) / (t3 - t1)) * A3.z,
      };

      const C = {
        x: ((t2 - t) / (t2 - t1)) * B1.x + ((t - t1) / (t2 - t1)) * B2.x,
        z: ((t2 - t) / (t2 - t1)) * B1.z + ((t - t1) / (t2 - t1)) * B2.z,
      };

      // Avoid duplicating joint point at segment boundaries
      if (i > 1 && s === 0) continue;
      out.push(C);
    }
  }

  return out;
}

function findClosestPolylineIndex(poly: WorldPoint[], p: WorldPoint) {
  let best = { idx: 0, d: Number.POSITIVE_INFINITY };
  for (let i = 0; i < poly.length; i++) {
    const dd = dist(poly[i], p);
    if (dd < best.d) best = { idx: i, d: dd };
  }
  return best;
}

function insertAnchorByPolyline(anchors: WorldPoint[], poly: WorldPoint[], p: WorldPoint): number {
  if (anchors.length <= 1) {
    anchors.push(p);
    return anchors.length - 1;
  }
  const polyIdx = findClosestPolylineIndex(poly, p).idx;

  // Map each anchor to its nearest polyline index (spline passes through anchors)
  const anchorPolyIdx = anchors.map((a) => findClosestPolylineIndex(poly, a).idx);

  // Find insertion position: first anchor whose poly index is after click
  let ins = anchors.length - 1;
  for (let i = 1; i < anchorPolyIdx.length; i++) {
    if (polyIdx < anchorPolyIdx[i]) {
      ins = i;
      break;
    }
  }
  anchors.splice(ins, 0, p);
  return ins;
}

type PickState = 'none' | 'pickStart' | 'pickEnd' | 'pickSide' | 'addAnchor';

export default forwardRef<CurveInputTHandle, CurveInputTProps>(function CurveInputT(props, ref) {
  const {
    enabled = true,
    externallySuppressed = false,
    mapReady,
    leafletMapRef,
    projectionRef,
    activeMode,
    filterWorldPointByAssistLine,
    onSetDrawClickSuppressed,
    onCommitPoints,
    outerClassName,
  } = props;

  const modeOk = activeMode === 'polyline' || activeMode === 'polygon';
  const disabled = !enabled || !modeOk;

  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const [pickState, setPickState] = useState<PickState>('none');
  const pickStateRef = useRef<PickState>('none');
  useEffect(() => {
    pickStateRef.current = pickState;
  }, [pickState]);

  const [P0, setP0] = useState<WorldPoint | null>(null);
  const [P1, setP1] = useState<WorldPoint | null>(null);
  const [radiusRaw, setRadiusRaw] = useState('');
  const [side, setSide] = useState<ArcSide | null>(null);

  const [mode, setMode] = useState<'Arc' | 'Spline'>('Arc');
  const [anchors, setAnchors] = useState<WorldPoint[]>([]);
  // 用于拖拽时的“即时预览”而不触发 React 重绘（避免 Marker 被重建导致拖不动）
  const anchorsRef = useRef<WorldPoint[]>([]);
  useEffect(() => {
    anchorsRef.current = anchors;
  }, [anchors]);
  const [selectedAnchor, setSelectedAnchor] = useState<number | null>(null);

  const [dotcntRaw, setDotcntRaw] = useState('7');

  // Leaflet container (独立图层容器)
  const rootRef = useRef<L.LayerGroup | null>(null);
  const polyRef = useRef<L.Polyline | null>(null);
  const markerRefs = useRef<L.Marker[]>([]);

  const clearLeaflet = useCallback(() => {
    if (polyRef.current && rootRef.current) {
      rootRef.current.removeLayer(polyRef.current);
      polyRef.current = null;
    }
    markerRefs.current.forEach((m) => {
      try {
        rootRef.current?.removeLayer(m);
      } catch {
        // ignore
      }
    });
    markerRefs.current = [];
    rootRef.current?.clearLayers();
  }, []);

  const requestCloseAndClear = useCallback(() => {
    // 立即解除主绘制冻结，避免依赖 effect 产生短暂窗口
    onSetDrawClickSuppressed?.(false);
    setOpen(false);
    setPickState('none');
    setMode('Arc');
    setP0(null);
    setP1(null);
    setRadiusRaw('');
    setSide(null);
    setAnchors([]);
    setSelectedAnchor(null);
    clearLeaflet();
  }, [clearLeaflet, onSetDrawClickSuppressed]);

  useImperativeHandle(ref, () => ({
    requestCloseAndClear,
    isOpen: () => openRef.current,
  }));

  // 关闭测绘/切换到非线面/禁用时：自动清理
  useEffect(() => {
    if (!open) return;
    if (disabled) requestCloseAndClear();
  }, [disabled, open, requestCloseAndClear]);

  // 打开时冻结主绘制（draw click suppressed）
  useEffect(() => {
    if (!onSetDrawClickSuppressed) return;
    if (open && !disabled) onSetDrawClickSuppressed(true);
    else onSetDrawClickSuppressed(false);
  }, [open, disabled, onSetDrawClickSuppressed]);

  const worldToLatLng = useCallback(
    (p: WorldPoint): L.LatLng | null => {
      const proj = projectionRef.current;
      if (!proj) return null;
      return proj.locationToLatLng(p.x, Y_FOR_DISPLAY, p.z);
    },
    [projectionRef]
  );

  const latLngToWorld = useCallback(
    (ll: L.LatLng): WorldPoint | null => {
      const proj = projectionRef.current;
      if (!proj) return null;
      const loc = proj.latLngToLocation(ll, Y_FOR_DISPLAY);
      return { x: loc.x, z: loc.z };
    },
    [projectionRef]
  );

  const fmt = useCallback((p: WorldPoint | null) => {
    if (!p) return '未设置';
    return `${formatGridNumber(p.x)}, ${formatGridNumber(p.z)}`;
  }, []);

  const radius = useMemo(() => {
    const v = Number(String(radiusRaw ?? '').trim());
    return Number.isFinite(v) ? v : NaN;
  }, [radiusRaw]);

  const dotcnt = useMemo(() => {
    const v = Number(String(dotcntRaw ?? '').trim());
    if (!Number.isFinite(v)) return NaN;
    return Math.floor(v);
  }, [dotcntRaw]);

  const arcSol = useMemo(() => {
    if (!P0 || !P1 || !side || !Number.isFinite(radius)) return { ok: false as const, reason: '' };
    return solveArc(P0, P1, radius, side);
  }, [P0, P1, radius, side]);

  const densePreview = useMemo<WorldPoint[]>(() => {
    if (!open || disabled) return [];

    if (mode === 'Arc') {
      if (!arcSol.ok) return [];
      return sampleArcDense(arcSol as ArcSolution, radius, 128);
    }
    // Spline
    if (anchors.length < 2) return [];
    return catmullRomCentripetalDense(anchors, 35);
  }, [open, disabled, mode, arcSol, radius, anchors]);

  // Ensure leaflet root
  useEffect(() => {
    if (!mapReady) return;
    const map = leafletMapRef.current;
    if (!map) return;
    if (!rootRef.current) {
      rootRef.current = L.layerGroup().addTo(map);
    }
    return () => {
      // on unmount
      try {
        if (rootRef.current) map.removeLayer(rootRef.current);
      } catch {
        // ignore
      }
      rootRef.current = null;
    };
  }, [mapReady, leafletMapRef]);

  // Draw preview & markers
  const redraw = useCallback(() => {
    if (!rootRef.current) return;
    clearLeaflet();
    if (!open || disabled) return;

    const map = leafletMapRef.current;
    if (!map) return;

    if (densePreview.length >= 2) {
      const latlngs: L.LatLng[] = [];
      for (const p of densePreview) {
        const ll = worldToLatLng(p);
        if (ll) latlngs.push(ll);
      }
      if (latlngs.length >= 2) {
        polyRef.current = L.polyline(latlngs, { color: '#3b82f6', weight: 3, opacity: 0.9 });
        polyRef.current.addTo(rootRef.current);
      }
    }

    const mk = (p: WorldPoint, opts: { draggable?: boolean; title?: string; kind?: 'end' | 'anchor' | 'handle'; onClick?: () => void; onDrag?: (ll: L.LatLng) => void; onDragEnd?: (ll: L.LatLng) => void }) => {
      const ll = worldToLatLng(p);
      if (!ll) return;

      const kind = opts.kind ?? 'anchor';
      const base = 'w-3 h-3 rounded-full border';
      const cls =
        kind === 'end'
          ? `${base} bg-white border-gray-900`
          : kind === 'handle'
            ? `${base} bg-yellow-300 border-yellow-800`
            : `${base} bg-blue-500 border-blue-900`;

      const icon = L.divIcon({
        className: '',
        html: `<div class="${cls}"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });

      const marker = L.marker(ll, { icon, draggable: Boolean(opts.draggable) });
      if (opts.title) marker.bindTooltip(opts.title, { permanent: false, direction: 'top', opacity: 0.9 });
      if (opts.onClick) marker.on('click', () => opts.onClick?.());
      if (opts.onDrag) marker.on('drag', (e: any) => opts.onDrag?.(e?.latlng));
      if (opts.onDragEnd) marker.on('dragend', (e: any) => opts.onDragEnd?.(e?.target?.getLatLng?.() ?? e?.latlng));

      marker.addTo(rootRef.current!);
      markerRefs.current.push(marker);
    };

    // endpoints
    if (P0) mk(P0, { draggable: false, kind: 'end', title: '起点' });
    if (P1) mk(P1, { draggable: false, kind: 'end', title: '终点' });

    if (mode === 'Arc') {
      // Arc handle: drag to adjust radius (沿弦法线投影)
      if (arcSol.ok) {
        const sol = arcSol as ArcSolution;
        const sign = side === 'left' ? 1 : -1;
        const handlePos = { x: sol.M.x + sol.n.x * sol.h * sign, z: sol.M.z + sol.n.z * sol.h * sign };
        mk(handlePos, {
          draggable: true,
          kind: 'handle',
          title: '弧线柄：拖动调半径',
          onDragEnd: (ll) => {
            const w0 = latLngToWorld(ll);
            if (!w0 || !P0 || !P1) return;
            const w = filterWorldPointByAssistLine ? filterWorldPointByAssistLine(w0) : w0;
            // Project to normal line at M
            const M = sol.M;
            const vx = w.x - M.x;
            const vz = w.z - M.z;
            const proj = vx * sol.n.x + vz * sol.n.z; // signed
            const sideNew: ArcSide = proj >= 0 ? 'left' : 'right';
            const hNew = Math.abs(proj);
            const d = sol.d;
            const Rnew = Math.sqrt((d / 2) * (d / 2) + hNew * hNew);
            if (!Number.isFinite(Rnew) || Rnew <= 0) return;
            // Handle position has highest priority: it determines both radius and direction
            setSide(sideNew);
            setRadiusRaw(String(snapToTenth(Rnew)));
          },
        });
      }
      return;
    }

    const updateSplinePreview = (nextAnchors: WorldPoint[]) => {
      if (!polyRef.current) return;
      if (!nextAnchors || nextAnchors.length < 2) return;
      const dense = catmullRomCentripetalDense(nextAnchors, 35);
      if (dense.length < 2) return;
      const latlngs: L.LatLng[] = [];
      for (const p of dense) {
        const ll = worldToLatLng(p);
        if (ll) latlngs.push(ll);
      }
      if (latlngs.length >= 2) {
        polyRef.current.setLatLngs(latlngs);
      }
    };

    // Spline anchors
    anchors.forEach((a, idx) => {
      const isEnd = idx === 0 || idx === anchors.length - 1;
      const isSel = selectedAnchor === idx;
      const kind: any = isEnd ? 'end' : 'anchor';
      mk(a, {
        draggable: !isEnd,
        kind,
        title: isEnd ? (idx === 0 ? '起点锚点（锁定）' : '终点锚点（锁定）') : `锚点 #${idx}${isSel ? '（选中）' : ''}`,
        onClick: () => setSelectedAnchor(idx),
        onDrag: (ll) => {
          const w0 = latLngToWorld(ll);
          if (!w0) return;
          const w1 = filterWorldPointByAssistLine ? filterWorldPointByAssistLine(w0) : w0;
          const w = snapWorldPointByMode(w1);
          // 关键：拖拽中不触发 setState（否则 redraw 会清空并重建 marker，导致拖不动/抖动）
          if (idx <= 0 || idx >= anchorsRef.current.length - 1) return;
          anchorsRef.current[idx] = w;
          updateSplinePreview(anchorsRef.current);
        },
        onDragEnd: (ll) => {
          const w0 = latLngToWorld(ll);
          if (!w0) return;
          const w1 = filterWorldPointByAssistLine ? filterWorldPointByAssistLine(w0) : w0;
          const w = snapWorldPointByMode(w1);
          if (idx <= 0 || idx >= anchorsRef.current.length - 1) return;
          anchorsRef.current[idx] = w;
          // 在 dragend 再提交状态，确保后续导出/重绘一致
          setAnchors(anchorsRef.current.slice());
        },
      });
    });
  }, [
    clearLeaflet,
    open,
    disabled,
    densePreview,
    worldToLatLng,
    P0,
    P1,
    mode,
    arcSol,
    radius,
    side,
    anchors,
    selectedAnchor,
    leafletMapRef,
    latLngToWorld,
    filterWorldPointByAssistLine,
    anchorsRef,
  ]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  // Map click handler for pick states
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map) return;

    const onClick = (e: L.LeafletMouseEvent) => {
      if (!openRef.current) return;
      if (disabled) return;
      const ps = pickStateRef.current;
      if (ps === 'none') return;

      const w0 = latLngToWorld(e.latlng);
      if (!w0) return;
      let w = filterWorldPointByAssistLine ? filterWorldPointByAssistLine(w0) : w0;
      w = snapWorldPointByMode(w);

      if (ps === 'pickStart') {
        setP0(w);
        setPickState('none');
        return;
      }
      if (ps === 'pickEnd') {
        setP1(w);
        setPickState('none');
        return;
      }
      if (ps === 'pickSide') {
        if (!P0 || !P1) return;
        const d = dist(P0, P1);
        if (!Number.isFinite(d) || d <= 1e-9) return;
        const M = { x: (P0.x + P1.x) / 2, z: (P0.z + P1.z) / 2 };
        const tx = (P1.x - P0.x) / d;
        const tz = (P1.z - P0.z) / d;
        const n = { x: -tz, z: tx };
        const s = (w.x - M.x) * n.x + (w.z - M.z) * n.z;
        setSide(s >= 0 ? 'left' : 'right');
        setPickState('none');
        return;
      }
      if (ps === 'addAnchor') {
        setAnchors((prev) => {
          const next = prev.slice();
          const poly = densePreview.length >= 2 ? densePreview : catmullRomCentripetalDense(next, 35);
          const ins = insertAnchorByPolyline(next, poly, w);
          setSelectedAnchor(ins);
          return next;
        });
        setPickState('none');
      }
    };

    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [leafletMapRef, latLngToWorld, filterWorldPointByAssistLine, disabled, densePreview, P0, P1]);

  const title = useMemo(() => {
    if (!modeOk) return '曲线输入：仅线/面模式可用';
    if (disabled) return '曲线输入：需先进入线/面绘制或编辑状态';
    if (externallySuppressed) return '曲线输入：其他工具正在占用绘制交互，请先退出后再开启';
    return '曲线输入：基础圆弧 +（可选）曲柄进入自由曲线模式；输出 0.1 精度点序列';
  }, [disabled, modeOk, externallySuppressed]);

  const setEndpointByManual = (which: 'start' | 'end', xRaw: string, zRaw: string) => {
    if (disabled) return;
    const x = parseStepNumber(xRaw, 0.1);
    const z = parseStepNumber(zRaw, 0.1);
    if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z)) {
      window.alert('坐标非法：x/z 仅允许 0.1 步进。');
      return;
    }
    // 端点锁定：强制吸附到 0.5
    const p = { x: snapToHalf(x), z: snapToHalf(z) };
    if (which === 'start') setP0(p);
    else setP1(p);
  };

  const enterFreeMode = () => {
    if (disabled) return;
    if (mode === 'Spline') return;
    if (!P0 || !P1 || !arcSol.ok) {
      window.alert('请先完成：起点、终点、半径、朝向（第三次点击选侧）。');
      return;
    }
    const sol = arcSol as ArcSolution;
    const midAngle = sol.a0 + sol.delta * 0.5;
    const mid = { x: sol.C.x + Math.cos(midAngle) * radius, z: sol.C.z + Math.sin(midAngle) * radius };
    setAnchors([P0, mid, P1]);
    setSelectedAnchor(1);
    setMode('Spline');
  };

  const flipSide = () => {
    if (disabled) return;
    if (!side) return;
    setSide(side === 'left' ? 'right' : 'left');
  };

  const removeSelectedAnchor = () => {
    if (disabled) return;
    if (mode !== 'Spline') return;
    if (selectedAnchor === null) return;
    if (selectedAnchor === 0 || selectedAnchor === anchors.length - 1) return;
    setAnchors((prev) => {
      const next = prev.slice();
      next.splice(selectedAnchor, 1);
      return next;
    });
    setSelectedAnchor(null);
  };

  const exportPoints = () => {
    if (disabled) return;
    if (!Number.isFinite(dotcnt) || dotcnt < 5) {
      window.alert('打点数非法：最小为 5。');
      return;
    }
    if (!P0 || !P1) {
      window.alert('请先设置起点与终点。');
      return;
    }

    let dense: WorldPoint[] = [];
    if (mode === 'Arc') {
      if (!arcSol.ok) {
        window.alert((arcSol as any)?.reason || '圆弧参数不完整/不可解。');
        return;
      }
      dense = sampleArcDense(arcSol as ArcSolution, radius, 220);
    } else {
      if (anchors.length < 2) {
        window.alert('自由曲线锚点不足。');
        return;
      }
      dense = catmullRomCentripetalDense(anchors, 45);
    }

    let pts = resampleByArcLength(dense, dotcnt);
    if (pts.length >= 2) {
      // 端点锁定
      pts[0] = { x: P0.x, z: P0.z };
      pts[pts.length - 1] = { x: P1.x, z: P1.z };
    }

    // 输出量化到 0.1
    pts = pts.map((p) => ({ x: snapToTenth(p.x), z: snapToTenth(p.z) }));
    // 再次端点锁定（避免极端浮点）
    pts[0] = { x: snapToTenth(P0.x), z: snapToTenth(P0.z) };
    pts[pts.length - 1] = { x: snapToTenth(P1.x), z: snapToTenth(P1.z) };

    pts = removeConsecutiveDuplicates(pts);
    if (pts.length < 2) {
      window.alert('输出点序列过短（可能被量化去重）。请增大打点数或调整曲线。');
      return;
    }

    onCommitPoints(pts);
    requestCloseAndClear();
  };

  // UI local state for manual endpoints
  const [sx, setSx] = useState('');
  const [sz, setSz] = useState('');
  const [ex, setEx] = useState('');
  const [ez, setEz] = useState('');

  const canSetStart = useMemo(() => {
    const x = parseStepNumber(sx, 0.1);
    const z = parseStepNumber(sz, 0.1);
    return typeof x === 'number' && typeof z === 'number' && Number.isFinite(x) && Number.isFinite(z);
  }, [sx, sz]);

  const canSetEnd = useMemo(() => {
    const x = parseStepNumber(ex, 0.1);
    const z = parseStepNumber(ez, 0.1);
    return typeof x === 'number' && typeof z === 'number' && Number.isFinite(x) && Number.isFinite(z);
  }, [ex, ez]);

  // 若其它工具（例如 ControlPointsT）已占用 click 抑制，则不允许再开启本工具（避免双工具并发）
  const entryDisabled = disabled || (externallySuppressed && !open);

  return (
    <div className={outerClassName ?? 'mb-2'} title={title}>
      <AppButton
        type="button"
        className={`w-full px-2 py-1 rounded text-sm border ${
          open ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'
        } ${entryDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        onClick={() => {
          if (entryDisabled) return;
          const nextOpen = !openRef.current;
          // 先同步冻结/解冻主绘制，避免“刚打开立刻点图”时漏冻结
          onSetDrawClickSuppressed?.(nextOpen);
          setOpen(nextOpen);
          // 收起时立刻清理，避免残留
          if (!nextOpen) requestCloseAndClear();
        }}
      >
        曲线输入
      </AppButton>

      {open && (
        <DraggablePanel id="curve-input" defaultPosition={{ x: 420, y: 140 }}>
          <div className="bg-white border rounded shadow-md w-[26rem]">
            <div className="flex items-center justify-between px-3 py-2 border-b">
              <div className="text-sm font-semibold">曲线输入</div>
              <AppButton type="button" className="p-1 rounded hover:bg-gray-100" onClick={requestCloseAndClear} title="关闭">
                <X size={16} />
              </AppButton>
            </div>

            <div className="p-3 space-y-3">
              <AppCard>
                <div className="text-xs text-gray-600 mb-2">
                  线/面模式可用。点选遵循网格吸附与辅助线；端点锁定为 0.5 网格。输出点序列量化到 0.1。
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-xs mb-1">起点</div>
                    <div className="text-xs text-gray-700 mb-1">{fmt(P0)}</div>
                    <div className="flex gap-2">
                      <AppButton
                        type="button"
                        className={`flex-1 px-2 py-1 rounded text-sm border ${
                          pickState === 'pickStart' ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'
                        }`}
                        onClick={() => setPickState((v) => (v === 'pickStart' ? 'none' : 'pickStart'))}
                        title="点击地图选择起点"
                      >
                        点选
                      </AppButton>
                      <AppButton
                        type="button"
                        className={`flex-1 px-2 py-1 rounded text-sm border ${
                          canSetStart ? 'bg-gray-900 text-white border-gray-900 hover:bg-gray-800' : 'bg-gray-200 text-gray-500 border-gray-200 cursor-not-allowed'
                        }`}
                        onClick={() => {
                          if (!canSetStart) return;
                          setEndpointByManual('start', sx, sz);
                        }}
                        disabled={!canSetStart}
                        title={canSetStart ? '使用下方输入框设置起点（端点会自动锁定到 0.5 网格）' : '请先在下方输入完整的 X / Z（0.1 步进）'}
                      >
                        设起点
                      </AppButton>
                    </div>

                    <div className="mt-2 flex gap-2">
                      <input
                        value={sx}
                        onChange={(e) => setSx(e.target.value)}
                        className="w-24 px-2 py-1 border rounded text-sm"
                        placeholder="X(0.1)"
                      />
                      <input
                        value={sz}
                        onChange={(e) => setSz(e.target.value)}
                        className="w-24 px-2 py-1 border rounded text-sm"
                        placeholder="Z(0.1)"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="text-xs mb-1">终点</div>
                    <div className="text-xs text-gray-700 mb-1">{fmt(P1)}</div>
                    <div className="flex gap-2">
                      <AppButton
                        type="button"
                        className={`flex-1 px-2 py-1 rounded text-sm border ${
                          pickState === 'pickEnd' ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'
                        }`}
                        onClick={() => setPickState((v) => (v === 'pickEnd' ? 'none' : 'pickEnd'))}
                        title="点击地图选择终点"
                      >
                        点选
                      </AppButton>
                      <AppButton
                        type="button"
                        className={`flex-1 px-2 py-1 rounded text-sm border ${
                          canSetEnd ? 'bg-gray-900 text-white border-gray-900 hover:bg-gray-800' : 'bg-gray-200 text-gray-500 border-gray-200 cursor-not-allowed'
                        }`}
                        onClick={() => {
                          if (!canSetEnd) return;
                          setEndpointByManual('end', ex, ez);
                        }}
                        disabled={!canSetEnd}
                        title={canSetEnd ? '使用下方输入框设置终点（端点会自动锁定到 0.5 网格）' : '请先在下方输入完整的 X / Z（0.1 步进）'}
                      >
                        设终点
                      </AppButton>
                    </div>

                    <div className="mt-2 flex gap-2">
                      <input
                        value={ex}
                        onChange={(e) => setEx(e.target.value)}
                        className="w-24 px-2 py-1 border rounded text-sm"
                        placeholder="X(0.1)"
                      />
                      <input
                        value={ez}
                        onChange={(e) => setEz(e.target.value)}
                        className="w-24 px-2 py-1 border rounded text-sm"
                        placeholder="Z(0.1)"
                      />
                    </div>
                  </div>
                </div>
              </AppCard>

              <AppCard>
                <div className="grid grid-cols-2 gap-2 items-end">
                  <div>
                    <div className="text-xs mb-1">半径 R</div>
                    <input
                      value={radiusRaw}
                      onChange={(e) => setRadiusRaw(e.target.value)}
                      className="w-full px-2 py-1 border rounded text-sm"
                      placeholder="例如 12"
                    />
                  </div>
                  <div>
                    <div className="text-xs mb-1">朝向（第三次点击选侧）</div>
                    <AppButton
                      type="button"
                      className={`w-full px-2 py-1 rounded text-sm border ${
                        side || pickState === 'pickSide'
                          ? 'bg-blue-600 text-white border-blue-700'
                          : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'
                      } ${!P0 || !P1 || !Number.isFinite(radius) || side ? 'opacity-80 cursor-not-allowed' : ''}`}
                      onClick={() => {
                        if (!P0 || !P1 || !Number.isFinite(radius)) return;
                        // Once a side is chosen, keep it fixed (blue) to avoid confusion.
                        if (side) return;
                        setPickState((v) => (v === 'pickSide' ? 'none' : 'pickSide'));
                      }}
                      title={side ? '已确定弧线朝向（可用翻转或拖动弧线柄跨过中线自动反转）' : '点击地图任意位置确定弧线向左/向右弯'}
                      disabled={!P0 || !P1 || !Number.isFinite(radius) || Boolean(side)}
                    >
                      {side ? (side === 'left' ? '当前：左侧' : '当前：右侧') : '点选朝向'}
                    </AppButton>
                  </div>
                </div>

                <div className="mt-1 text-xs text-gray-600">
                  起终点距离：{P0 && P1 ? snapToTenth(dist(P0, P1)).toFixed(1) : '--'}
                </div>

                <div className="mt-2 flex gap-2">
                  <AppButton
                    type="button"
                    className={`px-2 py-1 rounded text-sm border flex-1 ${
                      mode === 'Arc' ? 'bg-blue-50 text-gray-900 border-blue-200' : 'bg-white text-gray-800 border-gray-300'
                    }`}
                    onClick={() => setMode('Arc')}
                    disabled={mode === 'Arc'}
                  >
                    基础弧线
                  </AppButton>
                  <AppButton
                    type="button"
                    className={`px-2 py-1 rounded text-sm border flex-1 ${
                      mode === 'Spline' ? 'bg-blue-50 text-gray-900 border-blue-200' : 'bg-white text-gray-800 border-gray-300'
                    }`}
                    onClick={() => {
                      // Arc → Spline 的入口必须通过 enterFreeMode
                      if (mode !== 'Spline') enterFreeMode();
                    }}
                    title="添加曲柄并进入自由曲线模式（B1：过点锚点）"
                    disabled={mode === 'Spline'}
                  >
                    添加曲柄-进入自由曲线模式
                  </AppButton>
                </div>

                {mode === 'Arc' && (
                  <div className="mt-2 flex gap-2">
                    <AppButton
                      type="button"
                      className={`flex-1 px-2 py-1 rounded text-sm border bg-white text-gray-800 border-gray-300 hover:bg-gray-50 ${
                        !side ? 'opacity-50 cursor-not-allowed' : ''
                      }`}
                      onClick={flipSide}
                      disabled={!side}
                      title="翻转弧线朝向"
                    >
                      <span className="inline-flex items-center gap-1">
                        <ArrowLeftRight size={14} /> 翻转
                      </span>
                    </AppButton>
                    <div className="flex-1 text-xs text-gray-600 self-center">
                      {arcSol.ok ? '弧线柄可拖动调半径' : side ? (arcSol as any)?.reason : '请先设置起终点、半径与朝向'}
                    </div>
                  </div>
                )}

                {mode === 'Spline' && (
                  <div className="mt-2 space-y-2">
                    <div className="flex gap-2">
                      <AppButton
                        type="button"
                        className={`flex-1 px-2 py-1 rounded text-sm border ${
                          pickState === 'addAnchor' ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'
                        }`}
                        onClick={() => setPickState((v) => (v === 'addAnchor' ? 'none' : 'addAnchor'))}
                        title="点击地图添加锚点（按曲线位置插入）"
                      >
                        <span className="inline-flex items-center gap-1">
                          <Plus size={14} /> 添加锚点
                        </span>
                      </AppButton>
                      <AppButton
                        type="button"
                        className={`flex-1 px-2 py-1 rounded text-sm border bg-white text-gray-800 border-gray-300 hover:bg-gray-50 ${
                          selectedAnchor === null || selectedAnchor === 0 || selectedAnchor === anchors.length - 1 ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                        onClick={removeSelectedAnchor}
                        disabled={selectedAnchor === null || selectedAnchor === 0 || selectedAnchor === anchors.length - 1}
                        title="删除选中锚点（端点不可删）"
                      >
                        <span className="inline-flex items-center gap-1">
                          <Trash2 size={14} /> 删除锚点
                        </span>
                      </AppButton>
                    </div>
                    <div className="text-xs text-gray-600">
                      拖动蓝色锚点可调整曲线（端点锁定）。点击锚点可选中后删除。
                    </div>
                  </div>
                )}
              </AppCard>

              <AppCard>
                <div className="grid grid-cols-2 gap-2 items-end">
                  <div>
                    <div className="text-xs mb-1">打点数 dotcnt（≥5）</div>
                    <input
                      value={dotcntRaw}
                      onChange={(e) => setDotcntRaw(e.target.value)}
                      className="w-full px-2 py-1 border rounded text-sm"
                      placeholder="例如 7 / 9"
                    />
                  </div>
                  <div>
                    <AppButton
                      type="button"
                      className="w-full bg-green-500 text-white px-3 py-1 rounded"
                      onClick={exportPoints}
                      disabled={!P0 || !P1}
                      title="将生成的点序列追加到当前要素控制点末尾"
                    >
                      输出
                    </AppButton>
                  </div>
                </div>
                <div className="mt-2 text-xs text-gray-600">
                  输出精度：0.1；端点锁定：0.5。输出后将按起点→终点顺序追加到当前要素控制点列表末尾。
                </div>
              </AppCard>
            </div>
          </div>
        </DraggablePanel>
      )}
    </div>
  );
});
