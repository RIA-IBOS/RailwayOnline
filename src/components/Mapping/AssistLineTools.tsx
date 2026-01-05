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
import { Link, X } from 'lucide-react';
import AppButton from '@/components/ui/AppButton';

export type WorldPoint = { x: number; z: number };

type AssistLineMode = 'fixedLine' | 'coordSystem' | 'pickFeature';
type FixedAxis = 'x' | 'z';

type GeometryRings = {
  rings: WorldPoint[][];
  closed: boolean[];
};

// ---- 0.5 四舍五入：支持负数对称（避免 0.5 边界在负数方向的偏差） ----
const round05 = (n: number) => {
  if (!Number.isFinite(n)) return n;
  const s = n < 0 ? -1 : 1;
  const a = Math.abs(n);
  return s * (Math.round((a + Number.EPSILON) * 2) / 2);
};

const fmt05 = (n: number) => {
  const v = round05(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

type AssistLineTarget =
  | {
      kind: 'fixedLine';
      axis: FixedAxis;
      value: number; // 支持 0.5
      label: string;
    }
  | {
      kind: 'coordSystem';
      xRef: number; // 支持 0.5
      zRef: number; // 支持 0.5
      label: string;
    }
  | {
      kind: 'leafletFeature';
      label: string;
      geom: GeometryRings;
    };

export type AssistLineSnapResult = {
  point: WorldPoint;
  snapped: boolean;
  dist: number | null;
  targetLabel: string | null;
};

export type AssistLineToolsHandle = {
  /**
   * 通用“辅助线贴附”能力：用于绘制/编辑/控制点移动/控制点插入等。
   * 规则：当距离 <= 阈值时，返回修正后的点；否则原样返回，不拦截。
   */
  transformWorldPoint: (p: WorldPoint) => AssistLineSnapResult;

  /** 便于上层 UI/日志读取（可选用） */
  getThreshold: () => number;
  getTargetLabel: () => string | null;
  isEnabled: () => boolean;
};

type AssistLineToolsProps = {
  mapReady: boolean;
  leafletMapRef: MutableRefObject<L.Map | null>;
  projectionRef: MutableRefObject<DynmapProjection | null>;

  /** 初始阈值（格）；默认 20 */
  defaultThreshold?: number;

  /** DraggablePanel 默认位置（桌面端） */
  defaultPanelPosition?: { x: number; y: number };
};

const Y_FOR_DISPLAY = 64;

// 固定直线参考线显示用：足够大的范围（仅用于可视化，不用于计算“无限”效果）
const VIS_EXTENT = 300000;

/* -------------------- 几何工具：最近点 -------------------- */

function clamp01(n: number) {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function closestPointOnSegment(p: WorldPoint, a: WorldPoint, b: WorldPoint) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const apx = p.x - a.x;
  const apz = p.z - a.z;
  const denom = abx * abx + abz * abz;

  // 退化段
  if (!Number.isFinite(denom) || denom <= 1e-12) {
    const d = Math.hypot(p.x - a.x, p.z - a.z);
    return { point: { ...a }, t: 0, dist: d };
  }

  const t = clamp01((apx * abx + apz * abz) / denom);
  const q = { x: a.x + abx * t, z: a.z + abz * t };
  const d = Math.hypot(p.x - q.x, p.z - q.z);
  return { point: q, t, dist: d };
}

function closestPointOnRings(p: WorldPoint, geom: GeometryRings) {
  let best = {
    point: null as WorldPoint | null,
    dist: Number.POSITIVE_INFINITY,
  };

  for (let r = 0; r < geom.rings.length; r++) {
    const ring = geom.rings[r];
    const closed = geom.closed[r];
    if (!Array.isArray(ring) || ring.length < 2) continue;

    const n = ring.length;
    const lastSeg = closed ? n : n - 1;

    for (let i = 0; i < lastSeg; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      const cand = closestPointOnSegment(p, a, b);
      if (cand.dist < best.dist) {
        best = { point: cand.point, dist: cand.dist };
      }
    }
  }

  return best;
}

/* -------------------- Leaflet rings 解析（polyline/polygon 兼容嵌套结构） -------------------- */

function isLatLngLike(v: any): v is L.LatLng {
  return v && typeof v.lat === 'number' && typeof v.lng === 'number';
}

function collectLatLngArrays(input: any, out: L.LatLng[][]) {
  if (!Array.isArray(input) || input.length === 0) return;

  const first = input[0];
  if (isLatLngLike(first)) {
    out.push(input as L.LatLng[]);
    return;
  }

  for (const child of input) collectLatLngArrays(child, out);
}

function ringsFromLeafletPolyline(poly: L.Polyline): L.LatLng[][] {
  const raw = poly.getLatLngs() as any;
  const out: L.LatLng[][] = [];
  collectLatLngArrays(raw, out);
  return out;
}

/* -------------------- 组件 -------------------- */

export default forwardRef<AssistLineToolsHandle, AssistLineToolsProps>(function AssistLineTools(props, ref) {
  const {
    mapReady,
    leafletMapRef,
    projectionRef,
    defaultThreshold = 20,
    defaultPanelPosition = { x: 16, y: 260 },
  } = props;

  const initThreshold = round05(defaultThreshold);

  const [enabled, setEnabled] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  // 阈值（格）
  const [threshold, setThreshold] = useState<number>(initThreshold);
  const [thresholdInput, setThresholdInput] = useState<string>(fmt05(initThreshold));

  // 模式
  const [mode, setMode] = useState<AssistLineMode>('pickFeature');

  // 固定直线参数
  const [fixedAxis, setFixedAxis] = useState<FixedAxis>('x');
  const [fixedValueInput, setFixedValueInput] = useState<string>('');

  // 参考坐标系参数：两条固定直线（x=... 与 z=...）
  const [csXInput, setCsXInput] = useState<string>('');
  const [csZInput, setCsZInput] = useState<string>('');

  // 目标与状态
  const [target, setTarget] = useState<AssistLineTarget | null>(null);
  const [picking, setPicking] = useState(false);
  const [statusText, setStatusText] = useState<string>('');

  // 高亮组
  const highlightGroupRef = useRef<L.LayerGroup | null>(null);

  // 选择模式：记录绑定的 click handler
  const pickLayersRef = useRef<L.Layer[]>([]);
  const pickHandlerRef = useRef<((e: any) => void) | null>(null);

  const setMapCursor = useCallback(
    (cursor: string | null) => {
      const map = leafletMapRef.current;
      if (!map) return;
      map.getContainer().style.cursor = cursor ?? '';
    },
    [leafletMapRef]
  );

  const toWorld = useCallback(
    (latlng: L.LatLng): WorldPoint | null => {
      const proj = projectionRef.current;
      if (!proj) return null;
      const loc = proj.latLngToLocation(latlng, Y_FOR_DISPLAY);
      return { x: loc.x, z: loc.z };
    },
    [projectionRef]
  );

  const toLatLng = useCallback(
    (p: WorldPoint): L.LatLng | null => {
      const proj = projectionRef.current;
      if (!proj) return null;
      return proj.locationToLatLng(p.x, Y_FOR_DISPLAY, p.z);
    },
    [projectionRef]
  );

  /* -------------------- Leaflet 容器挂载/卸载 -------------------- */
  useEffect(() => {
    if (!mapReady) return;
    const map = leafletMapRef.current;
    if (!map) return;

    if (!highlightGroupRef.current) highlightGroupRef.current = L.layerGroup();
    if (!map.hasLayer(highlightGroupRef.current)) highlightGroupRef.current.addTo(map);

    return () => {
      if (highlightGroupRef.current && map.hasLayer(highlightGroupRef.current)) {
        map.removeLayer(highlightGroupRef.current);
      }
    };
  }, [mapReady, leafletMapRef]);

  /* -------------------- 高亮渲染 -------------------- */
  useEffect(() => {
    const map = leafletMapRef.current;
    const proj = projectionRef.current;
    const hg = highlightGroupRef.current;
    if (!map || !proj || !hg) return;

    hg.clearLayers();
    if (!enabled || !target) return;

    if (target.kind === 'leafletFeature') {
      for (const ring of target.geom.rings) {
        if (!ring || ring.length < 2) continue;
        const latlngs = ring.map((p) => proj.locationToLatLng(p.x, Y_FOR_DISPLAY, p.z)).filter(Boolean) as L.LatLng[];
        if (latlngs.length < 2) continue;

        L.polyline(latlngs, {
          color: '#ffffff',
          weight: 4,
          dashArray: '4 8',
          opacity: 0.85,
          interactive: false,
        }).addTo(hg);
      }
      return;
    }

    if (target.kind === 'fixedLine') {
      const a: WorldPoint =
        target.axis === 'x' ? { x: target.value, z: -VIS_EXTENT } : { x: -VIS_EXTENT, z: target.value };
      const b: WorldPoint =
        target.axis === 'x' ? { x: target.value, z: VIS_EXTENT } : { x: VIS_EXTENT, z: target.value };

      const lla = toLatLng(a);
      const llb = toLatLng(b);
      if (!lla || !llb) return;

      L.polyline([lla, llb], {
        color: '#ffffff',
        weight: 4,
        dashArray: '4 8',
        opacity: 0.85,
        interactive: false,
      }).addTo(hg);

      return;
    }

    if (target.kind === 'coordSystem') {
      // x=常量（竖线）+ z=常量（横线）
      const ax: WorldPoint = { x: target.xRef, z: -VIS_EXTENT };
      const bx: WorldPoint = { x: target.xRef, z: VIS_EXTENT };
      const az: WorldPoint = { x: -VIS_EXTENT, z: target.zRef };
      const bz: WorldPoint = { x: VIS_EXTENT, z: target.zRef };

      const llax = toLatLng(ax);
      const llbx = toLatLng(bx);
      const llaz = toLatLng(az);
      const llbz = toLatLng(bz);
      if (!llax || !llbx || !llaz || !llbz) return;

      L.polyline([llax, llbx], {
        color: '#ffffff',
        weight: 4,
        dashArray: '4 8',
        opacity: 0.85,
        interactive: false,
      }).addTo(hg);

      L.polyline([llaz, llbz], {
        color: '#ffffff',
        weight: 4,
        dashArray: '4 8',
        opacity: 0.85,
        interactive: false,
      }).addTo(hg);

      return;
    }
  }, [enabled, target, leafletMapRef, projectionRef, toLatLng]);

  /* -------------------- 选择模式：取消/开始 -------------------- */
  const cancelPicking = useCallback(() => {
    setPicking(false);
    setMapCursor(null);

    const handler = pickHandlerRef.current;
    if (handler) {
      for (const lyr of pickLayersRef.current) {
        (lyr as any).off?.('click', handler);
      }
    }

    pickLayersRef.current = [];
    pickHandlerRef.current = null;
  }, [setMapCursor]);

  const beginPicking = useCallback(() => {
    if (!mapReady) return;
    if (!enabled) return;

    const map = leafletMapRef.current;
    if (!map) return;

    // 仅“选择要素”模式允许拾取
    if (mode !== 'pickFeature') return;

    cancelPicking();

    setPicking(true);
    setMapCursor('crosshair');
    setStatusText('辅助线目标选择中：请点击任意线/面要素');

    const candidates: L.Layer[] = [];
    map.eachLayer((layer: any) => {
      // Polygon 也属于 Polyline
      if (layer instanceof L.Polyline) {
        const opt = layer.options ?? {};
        if (opt.interactive === false) return;
        candidates.push(layer);
      }
    });

    const handler = (e: any) => {
      const layer = e?.target;
      if (!layer || !(layer instanceof L.Polyline)) return;

      const llRings = ringsFromLeafletPolyline(layer);
      const wRings: WorldPoint[][] = [];

      for (const rr of llRings) {
        const wr: WorldPoint[] = [];
        for (const ll of rr) {
          const w = toWorld(ll);
          if (w) wr.push(w);
        }
        if (wr.length >= 2) wRings.push(wr);
      }

      const isPolygon = layer instanceof L.Polygon;
      const closed = wRings.map(() => Boolean(isPolygon));

      const stamp = L.Util.stamp(layer);

      setTarget({
        kind: 'leafletFeature',
        label: `Leaflet#${stamp}（${isPolygon ? '面' : '线'}）`,
        geom: { rings: wRings, closed },
      });

      setStatusText(`已选择辅助线目标：Leaflet#${stamp}`);
      cancelPicking();
    };

    for (const lyr of candidates) (lyr as any).on?.('click', handler);

    pickLayersRef.current = candidates;
    pickHandlerRef.current = handler;
  }, [mapReady, enabled, mode, leafletMapRef, toWorld, cancelPicking, setMapCursor]);

  // 面板关闭、禁用、或切走模式：自动退出拾取
  useEffect(() => {
    if (!enabled || !panelOpen || mode !== 'pickFeature') {
      if (picking) cancelPicking();
    }
  }, [enabled, panelOpen, mode, picking, cancelPicking]);

  // 组件卸载时保证清理
  useEffect(() => cancelPicking, [cancelPicking]);

  /* -------------------- 阈值应用 -------------------- */
  const applyThreshold = useCallback(() => {
    const v = Number(thresholdInput);
    if (!Number.isFinite(v) || v < 0) {
      setStatusText('阈值无效：请输入 >= 0 的数字');
      return;
    }
    const r = round05(v);
    setThreshold(r);
    setThresholdInput(fmt05(r));
    setStatusText(`已应用阈值：${fmt05(r)} 格`);
  }, [thresholdInput]);

  /* -------------------- 固定直线应用 -------------------- */
  const applyFixedLine = useCallback(() => {
    const raw = fixedValueInput.trim();
    const v = Number(raw);
    if (!Number.isFinite(v)) {
      setStatusText('固定直线无效：请输入有效数字（支持 0.5）');
      return;
    }
    const r = round05(v);

    setTarget({
      kind: 'fixedLine',
      axis: fixedAxis,
      value: r,
      label: `固定直线（${fixedAxis === 'x' ? 'x' : 'z'} = ${fmt05(r)}）`,
    });

    setStatusText(`已设置辅助线：${fixedAxis === 'x' ? 'x' : 'z'} = ${fmt05(r)}`);
  }, [fixedAxis, fixedValueInput]);

  /* -------------------- 参考坐标系应用（两条固定直线） -------------------- */
  const applyCoordSystem = useCallback(() => {
    const x = Number(csXInput.trim());
    const z = Number(csZInput.trim());
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      setStatusText('参考坐标系无效：请输入有效数字（支持 0.5）');
      return;
    }

    const xr = round05(x);
    const zr = round05(z);

    setTarget({
      kind: 'coordSystem',
      xRef: xr,
      zRef: zr,
      label: `参考坐标系（x = ${fmt05(xr)}, z = ${fmt05(zr)}）`,
    });

    setStatusText(`已设置参考坐标系：x=${fmt05(xr)}，z=${fmt05(zr)}`);
  }, [csXInput, csZInput]);

  /* -------------------- 核心：贴附计算（通用能力，向外暴露） -------------------- */
  const transformWorldPoint = useCallback(
    (p: WorldPoint): AssistLineSnapResult => {
      if (!enabled || !target) {
        return { point: p, snapped: false, dist: null, targetLabel: null };
      }

      // 固定直线：无限延伸（算法独立于可视化 extent）
      if (target.kind === 'fixedLine') {
        const d = target.axis === 'x' ? Math.abs(p.x - target.value) : Math.abs(p.z - target.value);
        if (d <= threshold) {
          const snappedPoint: WorldPoint =
            target.axis === 'x' ? { x: target.value, z: p.z } : { x: p.x, z: target.value };
          return { point: snappedPoint, snapped: true, dist: d, targetLabel: target.label };
        }
        return { point: p, snapped: false, dist: d, targetLabel: target.label };
      }

      // 参考坐标系：两条固定直线（xRef 与 zRef）；若距离相同且都在阈值内，优先 x
      if (target.kind === 'coordSystem') {
        const dx = Math.abs(p.x - target.xRef);
        const dz = Math.abs(p.z - target.zRef);

        const xOk = dx <= threshold;
        const zOk = dz <= threshold;

        if (!xOk && !zOk) {
          return { point: p, snapped: false, dist: Math.min(dx, dz), targetLabel: target.label };
        }

        const snapToX = xOk && (!zOk || dx <= dz); // tie -> x

        if (snapToX) {
          return {
            point: { x: target.xRef, z: p.z },
            snapped: true,
            dist: dx,
            targetLabel: `${target.label}（贴附 x）`,
          };
        }

        return {
          point: { x: p.x, z: target.zRef },
          snapped: true,
          dist: dz,
          targetLabel: `${target.label}（贴附 z）`,
        };
      }

      // 选择要素：最近点
      const best = closestPointOnRings(p, target.geom);
      const d = Number.isFinite(best.dist) ? best.dist : null;

      if (best.point && d !== null && d <= threshold) {
        return { point: best.point, snapped: true, dist: d, targetLabel: target.label };
      }

      return { point: p, snapped: false, dist: d, targetLabel: target.label };
    },
    [enabled, target, threshold]
  );

  useImperativeHandle(
    ref,
    () => ({
      transformWorldPoint,
      getThreshold: () => threshold,
      getTargetLabel: () => (target ? target.label : null),
      isEnabled: () => enabled,
    }),
    [transformWorldPoint, threshold, target, enabled]
  );

  /* -------------------- UI：模式按钮样式（对齐 MeasuringModule 点/线/面切换） -------------------- */
  const modeButtons = useMemo(
    () => [
      { key: 'fixedLine' as const, label: '固定直线' },
      { key: 'coordSystem' as const, label: '参考坐标系' },
      { key: 'pickFeature' as const, label: '选择要素' },
    ],
    []
  );

  return (
    <div className="mt-2">
      {/* “辅助线”按钮 */}
      <AppButton
        type="button"
        className={`w-full px-3 py-1.5 rounded text-sm border flex items-center gap-2 ${
          enabled ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-gray-800 border-gray-300'
        }`}
        onClick={() => {
          setEnabled((v) => {
            const next = !v;
            if (next) {
              setPanelOpen(true);
              setStatusText('');
              return next;
            }

            // 关闭：清理目标与拾取
            setTarget(null);
            cancelPicking();
            setStatusText('');
            return next;
          });
        }}
        title="辅助线"
      >
        <Link size={16} />
        {enabled ? `辅助线(启用中), 当前目标: ${target?.label ?? '未选择'}` : '辅助线'}
      </AppButton>

      {/* 状态文本（可选） */}
      {statusText && <div className="mt-2 text-xs text-gray-700">{statusText}</div>}

      {/* 桌面端浮动面板（移动端 DraggablePanel 会返回 null） */}
      {enabled && panelOpen && (
        <DraggablePanel id="assist-line-panel" defaultPosition={defaultPanelPosition}>
          <div className="bg-white border rounded shadow-md w-80">
            <div className="flex items-center justify-between px-3 py-2 border-b">
              <div className="text-sm font-semibold">辅助线</div>
              <AppButton
                type="button"
                className="p-1 rounded hover:bg-gray-100"
                onClick={() => {
                  setPanelOpen(false);
                  cancelPicking();
                }}
                title="关闭"
              >
                <X size={16} />
              </AppButton>
            </div>

            <div className="p-3 space-y-3">
              {/* 说明 */}
              <div className="text-xs text-gray-600">
                选择辅助线目标后，绘制/编辑/控制点修改与添加时：
                <div className="mt-1">
                  当点击点到辅助线距离 <span className="font-semibold">&le; 阈值</span> 时自动贴附；否则不贴附，按实际点击点落点。
                </div>
              </div>

              {/* 阈值输入 + 应用 */}
              <div className="flex items-center gap-2">
                <div className="text-xs text-gray-700 whitespace-nowrap">阈值（格）</div>
                <input
                  type="text"
                  value={thresholdInput}
                  onChange={(e) => setThresholdInput(e.target.value)}
                  className="flex-1 border rounded px-2 py-1 text-xs"
                  placeholder="例如 20"
                  inputMode="decimal"
                />
                <AppButton
                  type="button"
                  className="px-2 py-1 rounded text-xs border bg-white text-gray-800 border-gray-300 hover:bg-gray-50"
                  onClick={applyThreshold}
                  title="应用阈值"
                >
                  应用
                </AppButton>
              </div>

              {/* 模式切换（对齐点/线/面切换样式） */}
              <div>
                <div className="flex gap-2">
                  {modeButtons.map((m) => (
                    <AppButton
                      key={m.key}
                      type="button"
                      className={`flex-1 py-1 border text-sm ${mode === m.key ? 'bg-blue-300' : ''}`}
                      onClick={() => {
                        setMode(m.key);
                        setStatusText('');
                        // 切换非 pick 时直接退出拾取
                        if (m.key !== 'pickFeature') cancelPicking();
                      }}
                    >
                      {m.label}
                    </AppButton>
                  ))}
                </div>

                {/* 模式细节区 */}
                {mode === 'fixedLine' && (
                  <div className="mt-2 space-y-2">
                    <div className="text-xs text-gray-600">设置一条与坐标轴平行的无限长参考线（支持 0.5）。</div>
                    <div className="flex items-center gap-2">
                      <select
                        value={fixedAxis}
                        onChange={(e) => setFixedAxis(e.target.value as FixedAxis)}
                        className="border rounded px-2 py-1 text-xs"
                      >
                        <option value="x">x轴</option>
                        <option value="z">z轴</option>
                      </select>

                      <input
                        type="text"
                        value={fixedValueInput}
                        onChange={(e) => setFixedValueInput(e.target.value)}
                        className="flex-1 border rounded px-2 py-1 text-xs"
                        placeholder="坐标（支持 0.5）"
                        inputMode="decimal"
                      />

                      <AppButton
                        type="button"
                        className="px-2 py-1 rounded text-xs border bg-white text-gray-800 border-gray-300 hover:bg-gray-50"
                        onClick={applyFixedLine}
                        title="应用固定直线"
                      >
                        应用
                      </AppButton>
                    </div>
                  </div>
                )}

                {mode === 'coordSystem' && (
                  <div className="mt-2 space-y-2">
                    <div className="text-xs text-gray-600">
                      输入参考坐标系的 x 与 z，两条固定直线将同时生效（支持 0.5）。当两条线距离相同且都在阈值内时，优先贴附 x 轴。
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="text-xs text-gray-700 whitespace-nowrap">x</div>
                      <input
                        type="text"
                        value={csXInput}
                        onChange={(e) => setCsXInput(e.target.value)}
                        className="w-24 border rounded px-2 py-1 text-xs"
                        placeholder="如 10.5"
                        inputMode="decimal"
                      />

                      <div className="text-xs text-gray-700 whitespace-nowrap">z</div>
                      <input
                        type="text"
                        value={csZInput}
                        onChange={(e) => setCsZInput(e.target.value)}
                        className="w-24 border rounded px-2 py-1 text-xs"
                        placeholder="如 -3.5"
                        inputMode="decimal"
                      />

                      <AppButton
                        type="button"
                        className="px-2 py-1 rounded text-xs border bg-white text-gray-800 border-gray-300 hover:bg-gray-50"
                        onClick={applyCoordSystem}
                        title="应用参考坐标系"
                      >
                        应用
                      </AppButton>
                    </div>
                  </div>
                )}

                {mode === 'pickFeature' && (
                  <div className="mt-2 space-y-2">
                    <div className="text-xs text-gray-600">从地图中选择一条线/面要素作为参考线。</div>

                    <div className="flex items-center gap-2">
                      <AppButton
                        type="button"
                        className={`px-2 py-1 rounded text-xs border ${
                          picking ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-gray-800 border-gray-300'
                        }`}
                        onClick={beginPicking}
                        title="选择图层"
                      >
                        选择图层
                      </AppButton>
                      <div className="text-[11px] text-gray-500">点击地图中的线/面要素即可设为辅助线</div>
                    </div>
                  </div>
                )}
              </div>

              {/* 当前目标 */}
              <div className="text-xs">
                当前目标：<span className="font-semibold">{target ? target.label : '（未选择）'}</span>
              </div>

              {/* 清除/退出：不受模式影响，置于当前目标和说明中间 */}
              <div className="flex items-center gap-2">
                <AppButton
                  type="button"
                  className="px-2 py-1 rounded text-xs bg-gray-200 text-gray-900"
                  onClick={() => {
                    setTarget(null);
                    cancelPicking();
                    setStatusText('已清除辅助线目标');
                  }}
                  title="清除目标"
                >
                  清除目标
                </AppButton>

                <AppButton
                  type="button"
                  className={`px-2 py-1 rounded text-xs bg-gray-200 text-gray-900 ${
                    picking ? '' : 'opacity-50 cursor-not-allowed'
                  }`}
                  onClick={() => {
                    if (!picking) return;
                    cancelPicking();
                    setStatusText('已退出选择模式');
                  }}
                  title={picking ? '退出要素选择模式' : '当前未在选择模式'}
                >
                  退出选择
                </AppButton>
              </div>

              {/* 说明 */}
              <div className="text-[11px] text-gray-500">
                说明：
                <ul className="list-disc pl-5 mt-1 space-y-1">
                  <li>阈值是全局通用参数：任何调用 transformWorldPoint 的操作都会遵循该阈值。</li>
                  <li>当距离大于阈值时，不执行贴附（落点保持为实际点击位置）。</li>
                  <li>“选择要素”会监听地图中可交互的 Polyline/Polygon（包含测绘层与其它展示层）。</li>
                  <li>“固定直线/参考坐标系”支持 0.5，输入会按 0.5 节点四舍五入后应用。</li>
                </ul>
              </div>
            </div>
          </div>
        </DraggablePanel>
      )}
    </div>
  );
});