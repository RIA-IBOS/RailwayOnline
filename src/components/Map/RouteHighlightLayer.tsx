/**
 * 路径高亮图层组件（增强版）
 *
 * 支持：
 * - 旧版单一路径：path: Array<{ coord: Coordinate }>
 * - 新版结构化高亮：route: RouteHighlightData
 *   - overlay 多段、不同 color
 *   - transfer/access 虚线（dashed）
 *   - 站点 marker 分段上色
 *
 * 兼容性：
 * - 若仅提供 path，则渲染行为与旧版一致。
 * - 若同时提供 route 与 path，则优先使用 route。
 */

import { useEffect, useMemo, useRef } from 'react';
import * as L from 'leaflet';
import type { DynmapProjection } from '@/lib/DynmapProjection';
import type { Coordinate } from '@/types';

export type RouteStyledSegmentKind = 'rail' | 'transfer' | 'access' | 'generic';

export type RouteStyledSegment = {
  kind?: RouteStyledSegmentKind;
  coords: Coordinate[];
  color?: string;
  dashed?: boolean;

  /** 可选：覆盖默认线宽/透明度 */
  weight?: number;
  opacity?: number;
  outlineWeight?: number;
  outlineOpacity?: number;

  /** 可选：鼠标悬停提示 */
  tooltip?: string;
};

export type RouteStationMarkerKind = 'start' | 'end' | 'station' | 'transfer' | 'generic';

export type RouteStationMarker = {
  coord: Coordinate;
  label?: string;
  color?: string;
  kind?: RouteStationMarkerKind;
  radius?: number;
};

export type RouteHighlightData = {
  styledSegments: RouteStyledSegment[];
  stationMarkers?: RouteStationMarker[];

  /** 可选：显式指定起终点（否则从 segments 推断） */
  startCoord?: Coordinate;
  endCoord?: Coordinate;
  startLabel?: string;
  endLabel?: string;
};

interface RouteHighlightLayerProps {
  map: L.Map;
  projection: DynmapProjection;

  /** 新接口（优先） */
  route?: RouteHighlightData | null;

  /** 旧接口（兼容） */
  path?: Array<{ coord: Coordinate }>;
}

const DEFAULT_Y = 64;

function toLatLng(projection: DynmapProjection, c: Coordinate): L.LatLng {
  return projection.locationToLatLng(c.x, c.y ?? DEFAULT_Y, c.z);
}

function segmentPriority(kind: RouteStyledSegmentKind | undefined): number {
  // 保证 rail 在底层、transfer 在顶层（虚线更清晰）
  if (kind === 'rail') return 0;
  if (kind === 'access') return 1;
  if (kind === 'transfer') return 2;
  return 0;
}

function defaultMainStyle(seg: RouteStyledSegment): L.PolylineOptions {
  const kind = seg.kind ?? 'generic';
  const weight =
    seg.weight ??
    (kind === 'rail' ? 5 : kind === 'transfer' ? 4 : kind === 'access' ? 4 : 5);
  const opacity = seg.opacity ?? 1;

  const dashed = !!seg.dashed;
  return {
    color: seg.color ?? '#2196F3',
    weight,
    opacity,
    lineCap: 'round',
    lineJoin: 'round',
    dashArray: dashed ? '8 8' : undefined,
  };
}

function defaultOutlineStyle(seg: RouteStyledSegment, main: L.PolylineOptions): L.PolylineOptions {
  const mainWeight = Number(main.weight ?? 5);
  const ow = seg.outlineWeight ?? (mainWeight + 3);
  const oo = seg.outlineOpacity ?? 0.85;
  const dashed = !!seg.dashed;

  return {
    color: '#ffffff',
    weight: ow,
    opacity: oo,
    lineCap: 'round',
    lineJoin: 'round',
    dashArray: dashed ? '8 8' : undefined,
  };
}

function hasStartEndMarkers(markers: RouteStationMarker[] | undefined): { hasStart: boolean; hasEnd: boolean } {
  let hasStart = false;
  let hasEnd = false;
  for (const m of markers ?? []) {
    if (m.kind === 'start') hasStart = true;
    if (m.kind === 'end') hasEnd = true;
  }
  return { hasStart, hasEnd };
}

export function RouteHighlightLayer({ map, projection, route, path }: RouteHighlightLayerProps) {
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  const normalized = useMemo(() => {
    // 1) segments
    let segments: RouteStyledSegment[] = [];
    if (route?.styledSegments?.length) {
      segments = route.styledSegments.filter(s => Array.isArray(s.coords) && s.coords.length >= 2);
    } else if (Array.isArray(path) && path.length >= 2) {
      const coords = path.map(p => p.coord).filter(Boolean);
      if (coords.length >= 2) {
        segments = [
          {
            kind: 'generic',
            coords,
            color: '#2196F3',
            dashed: false,
          },
        ];
      }
    }

    // 2) start/end
    const startCoord = route?.startCoord ?? segments[0]?.coords?.[0] ?? null;
    const endCoord =
      route?.endCoord ??
      (segments.length ? segments[segments.length - 1].coords[segments[segments.length - 1].coords.length - 1] : null);

    // 3) markers
    const stationMarkers = route?.stationMarkers ?? [];

    return {
      segments,
      startCoord,
      endCoord,
      startLabel: route?.startLabel ?? '起点',
      endLabel: route?.endLabel ?? '终点',
      stationMarkers,
    };
  }, [route, path]);

  useEffect(() => {
    // 清空旧图层
    if (layerGroupRef.current) {
      layerGroupRef.current.remove();
      layerGroupRef.current = null;
    }

    const { segments, startCoord, endCoord, stationMarkers, startLabel, endLabel } = normalized;
    if (!segments.length) return;

    const layerGroup = L.layerGroup().addTo(map);
    layerGroupRef.current = layerGroup;

    // --- 绘制 polyline（分两遍：先 outline 再 main；并按优先级排序保证 transfer 在最上层）
    const ordered = [...segments].sort((a, b) => segmentPriority(a.kind) - segmentPriority(b.kind));

    // outlines
    for (const seg of ordered) {
      const latLngs = seg.coords.map(c => toLatLng(projection, c));
      if (latLngs.length < 2) continue;

      const mainStyle = defaultMainStyle(seg);
      const outlineStyle = defaultOutlineStyle(seg, mainStyle);
      const outline = L.polyline(latLngs, outlineStyle);
      if (seg.tooltip) outline.bindTooltip(seg.tooltip, { direction: 'top', className: 'route-tooltip' });
      layerGroup.addLayer(outline);
    }

    // mains
    for (const seg of ordered) {
      const latLngs = seg.coords.map(c => toLatLng(projection, c));
      if (latLngs.length < 2) continue;

      const mainStyle = defaultMainStyle(seg);
      const line = L.polyline(latLngs, mainStyle);
      if (seg.tooltip) line.bindTooltip(seg.tooltip, { direction: 'top', className: 'route-tooltip' });
      layerGroup.addLayer(line);
    }

    // --- 站点 marker（需要在 polyline 之后添加，保证在上层）
    const { hasStart, hasEnd } = hasStartEndMarkers(stationMarkers);

    const renderMarker = (m: RouteStationMarker) => {
      const latLng = toLatLng(projection, m.coord);
      const kind = m.kind ?? 'generic';

      let fillColor = m.color ?? '#ffffff';
      let radius = m.radius ?? 7;
      let weight = 2;
      let stroke = '#ffffff';

      if (kind === 'start') {
        fillColor = '#4CAF50';
        radius = m.radius ?? 10;
        weight = 3;
      } else if (kind === 'end') {
        fillColor = '#F44336';
        radius = m.radius ?? 10;
        weight = 3;
      } else if (kind === 'transfer') {
        radius = m.radius ?? 6;
      }

      const mk = L.circleMarker(latLng, {
        radius,
        fillColor,
        fillOpacity: 1,
        color: stroke,
        weight,
      });

      if (m.label) {
        mk.bindTooltip(m.label, {
          permanent: false,
          direction: 'top',
          className: 'route-tooltip',
        });
      }

      layerGroup.addLayer(mk);
    };

    // 自带 markers
    for (const m of stationMarkers) {
      if (!m?.coord) continue;
      renderMarker(m);
    }

    // 默认起终点（若调用方未提供 start/end marker）
    if (startCoord && !hasStart) {
      renderMarker({ coord: startCoord, kind: 'start', label: startLabel });
    }
    if (endCoord && !hasEnd) {
      renderMarker({ coord: endCoord, kind: 'end', label: endLabel });
    }

    // 清理
    return () => {
      if (layerGroupRef.current) {
        layerGroupRef.current.remove();
        layerGroupRef.current = null;
      }
    };
  }, [map, projection, normalized]);

  return null;
}

export default RouteHighlightLayer;
