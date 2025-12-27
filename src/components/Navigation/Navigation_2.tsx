/**
 * Navigation_2.tsx
 * 基于 PLF(站台) + RLE(线路) 的“有向边”导航：
 * - 边权重来自 RLE polyline 上站台点的“里程差”
 * - 换乘按 STB/SBP 归属判定，同站台(同 STA)换乘 cost=0，否则 cost=STA 距离 / 10
 * - 支持：时间优先 / 最少换乘（次级按时间）
 *
 * 实现说明：
 * - 仅从规则驱动图层（Rule）同源 JSON 中读取并解析 STA/PLF/STB/SBP/RLE
 * - 数据源入口可在 NAV2_DATA_SOURCES 覆盖（见下方常量）
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, ChevronDown, ChevronUp, Loader2, MapPin, Train, X } from 'lucide-react';
import type { Coordinate } from '@/types';
import { RULE_DATA_SOURCES, type WorldRuleDataSource } from '@/components/Rules/ruleDataSources';
import { calculateRailTime, calculateWalkTime } from '@/lib/pathfinding';

type Objective = 'time' | 'transfer';

type P3 = { x: number; y: number; z: number };

type Nav2Input =
  | { kind: 'building'; name: string; buildingId: string; coord: Coordinate } // coord = building center
  | { kind: 'coord'; name: string; coord: Coordinate };

type GeoLine = {
  id: string;
  direction: number;
  name: string;
  color: string;
  points: P3[];
  cumDist: number[]; // points cumulative distance (xz)
};

type Station = {
  id: string;
  name: string;
  coord: P3;
  platformIds: string[];
};

type Building = {
  id: string;
  name: string;
  center: P3;
  stationIds: string[];
};

type PlatformLineRef = {
  lineId: string;
  /**
   * 可选：站台在该线路上的里程提示（用于提升相邻站距离精度；若缺失则按几何投影计算）。
   * 对应字段：stationDistance / distance / m。
   */
  mHint?: number;
  available: boolean;
  overtaking: boolean;
  nextOT: boolean;
  getin: boolean;
  getout: boolean;
};

type Platform = {
  id: string;
  name: string;
  coord: P3;
  stationId?: string;
  situation: boolean;
  connect: boolean; // false => 连接节点（隐藏，不参与“途经站/换乘站”展示，但仍可参与图计算）
  lines: PlatformLineRef[];
};

type Nav2WorldData = {
  lines: Record<string, GeoLine>; // lineKey => line
  stations: Record<string, Station>;
  buildings: Building[];
  platforms: Record<string, Platform>;
  // 派生索引
  stationToBuildingIds: Record<string, string[]>;
  platformToBuildingIds: Record<string, string[]>;
  platformLineInfo: Record<string, Record<string, PlatformLineDerived>>; // plfId -> lineKey -> derived
  lineStops: Record<string, string[]>; // lineKey -> ordered platformIds (按该线 PLpoints 的里程顺序)
  lineStopIndex: Record<string, Record<string, number>>; // lineKey -> plfId -> stop index
};

type PlatformLineDerived = {
  ref: PlatformLineRef;
  m: number; // distance along polyline
  nodeEnabled: boolean; // 节点可用（Situation & Available）
  stopAllowed: boolean; // 是否可作为停站（非越行且未被 prev.nextOT 强制越行）
};

type StateKey = string; // `${plfId}@@${lineKey}`

type Edge =
  | {
      kind: 'rail';
      to: StateKey;
      lineKey: string;
      fromPlfId: string;
      toPlfId: string;
      distance: number; // xz distance
      geometry: P3[]; // sliced polyline
    }
  | {
      kind: 'transfer';
      to: StateKey;
      fromPlfId: string;
      toPlfId: string;
      rawDistance: number; // STA 距离（原始）
      weightDistance: number; // 权重距离（raw/10 或 0）
      fromStaId?: string;
      toStaId?: string;
      hidden?: boolean;
    };

type PathResult = {
  found: boolean;
  objective: Objective;
  totalRailDistance: number;
  totalTransferDistance: number;
  totalAccessDistance: number;
  totalTimeSeconds: number;
  transfers: number;
  pathStates: StateKey[];
  edges: Edge[];
  // 用于 UI
  segments: Array<
    | {
        kind: 'access';
        mode: 'elytra' | 'walk';
        from: Coordinate;
        to: Coordinate;
        distance: number;
        timeSeconds: number;
      }
    | {
        kind: 'rail';
        lineKey: string;
        lineName: string;
        color: string;
        fromStation: string;
        toStation: string;
        viaStations: string[]; // 途经站（可见站名）
        distance: number;
        timeSeconds: number;
      }
    | {
        kind: 'transfer';
        at: string; // 换乘发生地（可见；若为隐藏节点则给出占位）
        rawDistance: number;
        timeSeconds: number;
      }
    | {
        kind: 'egress';
        mode: 'elytra' | 'walk';
        from: Coordinate;
        to: Coordinate;
        distance: number;
        timeSeconds: number;
      }
  >;
  highlightPath: Array<{ coord: Coordinate }>;
};

/**
 * 可维护入口：导航数据源覆盖（默认复用 RULE_DATA_SOURCES）。
 * - 若你希望“仅加载导航相关 JSON”，可在这里为 worldId 指定 files 列表；
 * - files 为空时，会回退使用 RULE_DATA_SOURCES[worldId] 的 files（即与规则图层同源）。
 */
const NAV2_DATA_SOURCES: Partial<Record<string, WorldRuleDataSource>> = {
  // zth: { baseUrl: '/data/Mapping/zth', files: ['Your_STA.json', 'Your_PLF.json', ...] },
};

const Y_FOR_DISPLAY = 64;

/* ----------------------------- 基础工具 ----------------------------- */

function safeString(v: any): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function pickString(obj: any, keys: string[], fallback = ''): string {
  for (const k of keys) {
    const v = obj?.[k];
    const s = safeString(v);
    if (s) return s;
  }
  return fallback;
}

function pickNumber(obj: any, keys: string[], fallback = 0): number {
  for (const k of keys) {
    const v = Number(obj?.[k]);
    if (Number.isFinite(v)) return v;
  }
  return fallback;
}

function pickBoolean(obj: any, keys: string[], fallback = true): boolean {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
      const s = v.toLowerCase().trim();
      if (s === 'true' || s === '1' || s === 'yes') return true;
      if (s === 'false' || s === '0' || s === 'no') return false;
    }
  }
  return fallback;
}

function toP3(v: any): P3 | null {
  if (!v) return null;
  if (Array.isArray(v)) {
    const x = Number(v[0]);
    const y = Number(v[1]);
    const z = Number(v[2]);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return { x, y, z };
    if (Number.isFinite(x) && Number.isFinite(z)) return { x, y: Y_FOR_DISPLAY, z };
    return null;
  }
  if (typeof v === 'object') {
    const x = Number((v as any).x ?? (v as any).X);
    const y = Number((v as any).y ?? (v as any).Y ?? Y_FOR_DISPLAY);
    const z = Number((v as any).z ?? (v as any).Z);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) return { x, y, z };
  }
  return null;
}

function toP3Array(v: any): P3[] {
  if (!Array.isArray(v)) return [];
  const out: P3[] = [];
  for (const item of v) {
    const p = toP3(item);
    if (p) out.push(p);
  }
  return out;
}

function distanceXZ(a: P3, b: P3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function cumDistances(points: P3[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    if (i === 0) {
      out.push(0);
      continue;
    }
    acc += distanceXZ(points[i - 1], points[i]);
    out.push(acc);
  }
  return out;
}

/**
 * 计算点到 polyline 的投影位置（xz），返回其沿线里程 m。
 */
function projectPointToPolylineM(point: P3, line: GeoLine): { m: number; snapped: P3 } | null {
  const pts = line.points;
  if (pts.length < 2) return null;

  let bestD2 = Number.POSITIVE_INFINITY;
  let bestM = 0;
  let bestSnap: P3 = pts[0];

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const apx = point.x - a.x;
    const apz = point.z - a.z;

    const ab2 = abx * abx + abz * abz;
    if (ab2 <= 1e-9) continue;

    let t = (apx * abx + apz * abz) / ab2;
    if (t < 0) t = 0;
    if (t > 1) t = 1;

    const sx = a.x + abx * t;
    const sz = a.z + abz * t;
    const dx = point.x - sx;
    const dz = point.z - sz;
    const d2 = dx * dx + dz * dz;

    if (d2 < bestD2) {
      bestD2 = d2;
      const segLen = Math.sqrt(ab2);
      bestM = line.cumDist[i] + segLen * t;
      bestSnap = { x: sx, y: point.y ?? Y_FOR_DISPLAY, z: sz };
    }
  }

  return { m: bestM, snapped: bestSnap };
}

function slicePolylineByM(line: GeoLine, m0: number, m1: number): P3[] {
  const pts = line.points;
  const cum = line.cumDist;
  if (pts.length < 2) return pts.slice();

  const total = cum[cum.length - 1];
  let a = Math.max(0, Math.min(total, m0));
  let b = Math.max(0, Math.min(total, m1));
  if (b < a) [a, b] = [b, a];

  const out: P3[] = [];

  const pushInterp = (i: number, t: number) => {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    out.push({
      x: p0.x + (p1.x - p0.x) * t,
      y: p0.y + (p1.y - p0.y) * t,
      z: p0.z + (p1.z - p0.z) * t,
    });
  };

  // 找到 start segment
  let i = 0;
  while (i < cum.length - 1 && cum[i + 1] < a) i++;

  // start point
  if (i >= cum.length - 1) return [pts[pts.length - 1]];
  const segLenA = cum[i + 1] - cum[i];
  const tA = segLenA <= 1e-9 ? 0 : (a - cum[i]) / segLenA;
  pushInterp(i, tA);

  // 中间完整点
  while (i < cum.length - 1 && cum[i + 1] <= b) {
    out.push(pts[i + 1]);
    i++;
  }

  // end point（若 b 落在段内）
  if (i < cum.length - 1 && cum[i] < b && cum[i + 1] > b) {
    const segLenB = cum[i + 1] - cum[i];
    const tB = segLenB <= 1e-9 ? 0 : (b - cum[i]) / segLenB;
    // 若 end 刚好等于最后已 push 的点，则不重复 push
    const last = out[out.length - 1];
    const end = {
      x: pts[i].x + (pts[i + 1].x - pts[i].x) * tB,
      y: pts[i].y + (pts[i + 1].y - pts[i].y) * tB,
      z: pts[i].z + (pts[i + 1].z - pts[i].z) * tB,
    };
    if (!last || distanceXZ(last, end) > 1e-6) out.push(end);
  }

  return out;
}

function polygonCentroidXZ(poly: Array<{ x: number; z: number }>): { x: number; z: number } | null {
  if (poly.length < 3) return null;
  let area = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const x0 = poly[j].x;
    const z0 = poly[j].z;
    const x1 = poly[i].x;
    const z1 = poly[i].z;
    const f = x0 * z1 - x1 * z0;
    area += f;
    cx += (x0 + x1) * f;
    cz += (z0 + z1) * f;
  }
  if (Math.abs(area) < 1e-12) return null;
  area *= 0.5;
  cx /= 6 * area;
  cz /= 6 * area;
  return { x: cx, z: cz };
}

function parseDirectionCode(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}


function stateKey(plfId: string, lineKey: string): StateKey {
  return `${plfId}@@${lineKey}`;
}

function parseCoordFromText(text: string): Coordinate | null {
  const s = text.trim();
  // 允许 "x,z" 或 "x z" 或 "x, y, z"
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)(?:\s*[, ]\s*(-?\d+(?:\.\d+)?))?/);
  if (!m) return null;
  const x = Number(m[1]);
  const a2 = Number(m[2]);
  const a3raw = m[3];

  // 2 个数：默认 x,z
  if (Number.isFinite(x) && Number.isFinite(a2) && a3raw === undefined) {
    return { x, y: Y_FOR_DISPLAY, z: a2 };
  }

  // 3 个数：x,y,z
  if (a3raw !== undefined) {
    const z = Number(a3raw);
    if (Number.isFinite(x) && Number.isFinite(a2) && Number.isFinite(z)) {
      return { x, y: a2, z };
    }
  }

  return null;
}

/* ----------------------------- 数据加载/解析 ----------------------------- */

async function fetchJsonArray(url: string): Promise<any[]> {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  return Array.isArray(data) ? data : [];
}

function getNav2DataSource(worldId: string): WorldRuleDataSource | null {
  const override = NAV2_DATA_SOURCES[worldId];
  if (override) {
    // files 为空则回退到 RULE
    if (override.files?.length) return override;
    const fallback = RULE_DATA_SOURCES[worldId];
    return fallback ? { baseUrl: override.baseUrl || fallback.baseUrl, files: fallback.files } : override;
  }
  return RULE_DATA_SOURCES[worldId] ?? null;
}

function parseWorldItems(items: any[]): {
  lines: GeoLine[];
  stations: Station[];
  buildings: Building[];
  platforms: Platform[];
} {
  const lines: GeoLine[] = [];
  const stations: Station[] = [];
  const buildings: Building[] = [];
  const platforms: Platform[] = [];

  for (const it of items) {
    const cls = safeString(it?.Class);
    if (!cls) continue;

    if (cls === 'RLE') {
      const dir = parseDirectionCode(it?.direction ?? it?.Direction);
      if (dir === null || dir === 3) continue; // 展示主线/无方向线不参与计算：直接跳过
      const id = pickString(it, ['lineID', 'lineId', 'LineID', 'ID', 'id']);
      if (!id) continue;

      const name = pickString(it, ['lineName', 'LineName', 'name', 'Name'], id);
      const color = pickString(it, ['color', 'Color'], '#2196F3');

      const pts = toP3Array(it?.PLpoints ?? it?.PLPoints ?? it?.points ?? it?.Points);
      if (pts.length < 2) continue;

      const cum = cumDistances(pts);

      lines.push({
        id,
        direction: dir,
        name,
        color,
        points: pts,
        cumDist: cum,
      });
      continue;
    }

    if (cls === 'STA') {
      const id = pickString(it, ['stationID', 'stationId', 'StationID', 'ID', 'id']);
      if (!id) continue;
      const name = pickString(it, ['stationName', 'StationName', 'name', 'Name'], id);

      const coord =
        toP3(it?.coordinate) ??
        toP3({ x: it?.x ?? it?.X, y: it?.y ?? it?.Y ?? Y_FOR_DISPLAY, z: it?.z ?? it?.Z });
      if (!coord) continue;

      const platformsArr = Array.isArray(it?.platforms)
        ? it.platforms
        : Array.isArray(it?.Platforms)
          ? it.Platforms
          : Array.isArray(it?.Platform)
            ? it.Platform
            : [];
      const platformIds: string[] = [];
      for (const p of platformsArr) {
        const pid = pickString(p, ['ID', 'id', 'plfID', 'platformID', 'platformId']);
        if (pid) platformIds.push(pid);
      }

      stations.push({ id, name, coord, platformIds });
      continue;
    }

    if (cls === 'PLF') {
      const id = pickString(it, ['plfID', 'platformID', 'platformId', 'platformID', 'PlatformID', 'ID', 'id', 'platformName']);
      if (!id) continue;
      // 注意：部分旧格式可能将 platformName 同时用于“ID/名称”，因此 name 采用多候选 + fallback。
      const name = pickString(it, ['plfName', 'platformLabel', 'platformTitle', 'platformName', 'name', 'Name'], id);

      const coord =
        toP3(it?.coordinate) ??
        toP3({ x: it?.x ?? it?.X, y: it?.y ?? it?.Y ?? Y_FOR_DISPLAY, z: it?.z ?? it?.Z });
      if (!coord) continue;

      const situation = pickBoolean(it, ['Situation', 'situation', 'Enable', 'enable'], true);
      const connect = pickBoolean(it, ['Connect', 'connect'], true);

      const stationId = pickString(it, ['stationID', 'stationId', 'StationID'], '');

      const linesArr = Array.isArray(it?.lines) ? it.lines : Array.isArray(it?.Lines) ? it.Lines : Array.isArray(it?.Line) ? it.Line : [];
      const refs: PlatformLineRef[] = [];
      for (const r of linesArr) {
        const lineId = pickString(r, ['lineID', 'lineId', 'LineID', 'ID', 'id']);
        if (!lineId) continue;

        // distance/m：若站台侧提供“到区间起点的长度”，优先使用（用于停站排序与切片）
        const mHint = pickNumber(r, ['stationDistance', 'distance', 'Distance', 'm', 'M'], Number.NaN);
        // 可用性字段兼容：Avaliable/Available 或 NotAvaliable/NotAvailable
        // 说明：你的文档中存在 "NotAvaliable" 但语义写为 "true:可用"，因此这里按“字段值本身”为准。
        const available = pickBoolean(r, ['Avaliable', 'Available', 'available', 'NotAvaliable', 'NotAvailable'], true);

        refs.push({
          lineId,
          ...(Number.isFinite(mHint) ? { mHint } : {}),
          available,
          overtaking: pickBoolean(r, ['Overtaking', 'overtaking'], false),
          getin: pickBoolean(r, ['getin', 'GetIn', 'board', 'Board'], true),
          getout: pickBoolean(r, ['getout', 'GetOut', 'alight', 'Alight'], true),
          nextOT: pickBoolean(r, ['NextOT', 'nextOT', 'NextOvertaking'], false),
        });
      }

      platforms.push({
        id,
        name,
        coord,
        stationId: stationId || undefined,
        situation,
        connect,
        lines: refs,
      });
      continue;
    }

    if (cls === 'STB') {
      const id = pickString(it, ['staBuildingID', 'buildingID', 'BuildingID', 'ID', 'id']);
      if (!id) continue;
      const name = pickString(it, ['staBuildingName', 'buildingName', 'name', 'Name'], id);

      // STB 通常为 Polygon：中心可由 centroid 计算；也允许直接给 coordinate
      const coordPoint = toP3(it?.coordinate);
      let center: P3 | null = coordPoint;

      if (!center) {
        const polyPts = toP3Array(it?.Conpoints ?? it?.Flrpoints ?? it?.points);
        const polyXZ = polyPts.map(p => ({ x: p.x, z: p.z }));
        const c = polygonCentroidXZ(polyXZ);
        if (c) center = { x: c.x, y: Y_FOR_DISPLAY, z: c.z };
      }
      if (!center) continue;

      const stationsArr = Array.isArray(it?.stations)
        ? it.stations
        : Array.isArray(it?.Stations)
          ? it.Stations
          : Array.isArray(it?.Station)
            ? it.Station
            : [];
      const stationIds: string[] = [];
      for (const s of stationsArr) {
        const sid = pickString(s, ['ID', 'id', 'stationID', 'stationId']);
        if (sid) stationIds.push(sid);
      }

      buildings.push({ id, name, center, stationIds });
      continue;
    }

    if (cls === 'SBP') {
      const id = pickString(it, ['staBuildingID', 'buildingID', 'BuildingID', 'ID', 'id']);
      if (!id) continue;
      const name = pickString(it, ['staBuildingName', 'buildingName', 'name', 'Name'], id);

      const center =
        toP3(it?.coordinate) ??
        toP3({ x: it?.x ?? it?.X, y: it?.y ?? it?.Y ?? Y_FOR_DISPLAY, z: it?.z ?? it?.Z });
      if (!center) continue;

      const stationsArr = Array.isArray(it?.stations)
        ? it.stations
        : Array.isArray(it?.Stations)
          ? it.Stations
          : Array.isArray(it?.Station)
            ? it.Station
            : [];
      const stationIds: string[] = [];
      for (const s of stationsArr) {
        const sid = pickString(s, ['ID', 'id', 'stationID', 'stationId']);
        if (sid) stationIds.push(sid);
      }

      buildings.push({ id, name, center, stationIds });
      continue;
    }
  }

  return { lines, stations, buildings, platforms };
}

function buildWorldData(parsed: {
  lines: GeoLine[];
  stations: Station[];
  buildings: Building[];
  platforms: Platform[];
}): Nav2WorldData {
  const lineMap: Record<string, GeoLine> = {};
  for (const l of parsed.lines) {
    const k = l.id;
    // 若重复，保留更长的（更可能是完整线）
    const prev = lineMap[k];
    if (!prev || (prev.cumDist[prev.cumDist.length - 1] ?? 0) < (l.cumDist[l.cumDist.length - 1] ?? 0)) {
      lineMap[k] = l;
    }
  }

  // lineId -> lineKeys（通常 lineId 唯一；若同 ID 有多条线，则在此展开）
  const lineKeysById: Record<string, string[]> = {};
  for (const lk of Object.keys(lineMap)) {
    const lineId = lk;
    if (!lineKeysById[lineId]) lineKeysById[lineId] = [];
    lineKeysById[lineId].push(lk);
  }

  const stationMap: Record<string, Station> = {};
  for (const s of parsed.stations) stationMap[s.id] = s;

  const platformMap: Record<string, Platform> = {};
  for (const p of parsed.platforms) platformMap[p.id] = p;

  // stationId 补全：优先 PLF.stationId，其次 STA.platformIds 反查
  const plfToSta: Record<string, string> = {};
  for (const p of parsed.platforms) {
    if (p.stationId) plfToSta[p.id] = p.stationId;
  }
  for (const s of parsed.stations) {
    for (const pid of s.platformIds) {
      if (!plfToSta[pid]) plfToSta[pid] = s.id;
    }
  }
  for (const pid of Object.keys(plfToSta)) {
    const p = platformMap[pid];
    if (p) p.stationId = plfToSta[pid];
  }

  // station <-> building 关系
  const stationToBuildingIds: Record<string, string[]> = {};
  for (const b of parsed.buildings) {
    for (const sid of b.stationIds) {
      if (!stationToBuildingIds[sid]) stationToBuildingIds[sid] = [];
      if (!stationToBuildingIds[sid].includes(b.id)) stationToBuildingIds[sid].push(b.id);
    }
  }

  const platformToBuildingIds: Record<string, string[]> = {};
  for (const p of parsed.platforms) {
    const sid = p.stationId;
    if (!sid) continue;
    const bids = stationToBuildingIds[sid] ?? [];
    platformToBuildingIds[p.id] = bids.slice();
  }

  // platformLineInfo：计算站台投影里程 m，并处理 prev.nextOT -> stopAllowed
  const platformLineInfo: Record<string, Record<string, PlatformLineDerived>> = {};
  for (const p of parsed.platforms) {
    const per: Record<string, PlatformLineDerived> = {};
    for (const lr of p.lines) {
      // 1) PLF.lines 通过 lineId 直连到 RLE（若一个 lineId 映射多条线，则会展开）
      const candidates: string[] = lineKeysById[lr.lineId] ?? [];

      for (const lk of candidates) {
        const line = lineMap[lk];
        if (!line) continue;

        // 2) 里程 m：优先使用站台侧给出的 mHint（distance），否则投影估计
        const lineLen = line.cumDist[line.cumDist.length - 1] ?? 0;
        let m = Number.isFinite(lr.mHint) ? Math.min(Math.max(lr.mHint as number, 0), lineLen) : NaN;
        if (!Number.isFinite(m)) {
          const proj = projectPointToPolylineM(p.coord, line);
          if (!proj) continue;
          m = proj.m;
        }
        const nodeEnabled = !!p.situation && !!lr.available;
        per[lk] = {
          ref: lr,
          m,
          nodeEnabled,
          stopAllowed: nodeEnabled && !lr.overtaking,
        };
      }
    }
    if (Object.keys(per).length) platformLineInfo[p.id] = per;
  }

  // lineStops：按 polyline 里程 m 升序排序；并应用 prev.nextOT 强制越行（只影响 stopAllowed）
  const lineStops: Record<string, string[]> = {};
  const lineStopIndex: Record<string, Record<string, number>> = {};

  for (const [lk, line] of Object.entries(lineMap)) {
    // 收集所有包含该 lineKey 的平台
    const all: Array<{ plfId: string; m: number; ref: PlatformLineRef }> = [];
    for (const [plfId, per] of Object.entries(platformLineInfo)) {
      const d = per[lk];
      if (!d) continue;
      all.push({ plfId, m: d.m, ref: d.ref });
    }
    if (all.length < 2) continue;

    // 线路行车方向固定为 polyline 点序（m 递增）
    all.sort((a, b) => a.m - b.m);

    // 计算 stopAllowed（应用 prev.nextOT）
    for (let i = 0; i < all.length; i++) {
      const cur = all[i];
      const prev = i > 0 ? all[i - 1] : null;
      const derived = platformLineInfo[cur.plfId]?.[lk];
      if (!derived) continue;

      const forcedPass = prev ? prev.ref.nextOT : false;
      derived.stopAllowed = derived.stopAllowed && !forcedPass;
    }
    void line

    // rail 节点：只要该点在此线路上可用（Situation & Available），即可参与线路连通性
    const stops = all
      .filter(x => platformLineInfo[x.plfId]?.[lk]?.nodeEnabled)
      .map(x => x.plfId);

    if (stops.length < 2) continue;

    lineStops[lk] = stops;
    const idxMap: Record<string, number> = {};
    stops.forEach((pid, idx) => (idxMap[pid] = idx));
    lineStopIndex[lk] = idxMap;
  }

  return {
    lines: lineMap,
    stations: stationMap,
    buildings: parsed.buildings,
    platforms: platformMap,
    stationToBuildingIds,
    platformToBuildingIds,
    platformLineInfo,
    lineStops,
    lineStopIndex,
  };
}

/* ----------------------------- 图构建 + 最短路 ----------------------------- */

function buildGraph(data: Nav2WorldData): Record<StateKey, Edge[]> {
  const adj: Record<StateKey, Edge[]> = {};

  const ensure = (k: StateKey) => {
    if (!adj[k]) adj[k] = [];
  };

  // 1) Rail edges：按 lineStops 顺序连接相邻节点（有向：沿 polyline 从前到后）
  for (const [lk, stops] of Object.entries(data.lineStops)) {
    const line = data.lines[lk];
    if (!line) continue;

    // 需要 stop 对应的 m，用于切片几何和距离
    const mOf = (plfId: string) => data.platformLineInfo[plfId]?.[lk]?.m ?? 0;

    for (let i = 0; i < stops.length - 1; i++) {
      const aPlf = stops[i];
      const bPlf = stops[i + 1];
      const aM = mOf(aPlf);
      const bM = mOf(bPlf);
      const dist = Math.abs(bM - aM); // 沿线距离（累计里程差）

      const geom = slicePolylineByM(line, aM, bM);
      const geometry = geom;

      // rail edge 在“同 lineKey 状态”之间
      const from = stateKey(aPlf, lk);
      const to = stateKey(bPlf, lk);

      ensure(from);
      ensure(to);

      adj[from].push({
        kind: 'rail',
        to,
        lineKey: lk,
        fromPlfId: aPlf,
        toPlfId: bPlf,
        distance: dist,
        geometry,
      });
    }
  }

  // 2) Transfer edges
  // 2.0) 连接节点（Connect=false）允许在“同一站台点”上无成本切换线路状态（用于联络线/正线衔接）。
  //      该切换不计入“换乘次数”，也不在 UI 中展示。
  for (const [plfId, p] of Object.entries(data.platforms)) {
    if (!p || !p.situation) continue;
    if (p.connect !== false) continue;
    const per = data.platformLineInfo[plfId];
    if (!per) continue;
    const lks = Object.keys(per).filter(lk => per[lk]?.ref.available);
    if (lks.length < 2) continue;

    for (const fromLk of lks) {
      const fromState = stateKey(plfId, fromLk);
      ensure(fromState);
      for (const toLk of lks) {
        if (toLk === fromLk) continue;
        const toState = stateKey(plfId, toLk);
        ensure(toState);
        adj[fromState].push({
          kind: 'transfer',
          to: toState,
          fromPlfId: plfId,
          toPlfId: plfId,
          rawDistance: 0,
          weightDistance: 0,
          fromStaId: p.stationId,
          toStaId: p.stationId,
          hidden: true,
        });
      }
    }
  }

  // 2.1) 乘客换乘：
  // - 同 STA 内换乘 cost=0（不依赖 STB/SBP 配置）
  // - 同 STB/SBP（building）内跨 STA 换乘 cost=dist(STA_A, STA_B)/10
  // - 换乘条件：下车(getout) + 上车(getin) 且 stopAllowed=true（越行/NextOT 强制通过则不可作为换乘点）

  const staDist = (sa?: string, sb?: string) => {
    if (!sa || !sb) return 0;
    if (sa === sb) return 0;
    const a = data.stations[sa]?.coord;
    const b = data.stations[sb]?.coord;
    if (!a || !b) return 0;
    return distanceXZ(a, b);
  };

  const addPassengerTransfersForPlatforms = (plfIds: string[], rawFn: (sa?: string, sb?: string) => number) => {
    if (plfIds.length < 2) return;

    const alightStates: Array<{ plfId: string; lk: string; staId?: string }> = [];
    const boardStates: Array<{ plfId: string; lk: string; staId?: string }> = [];

    for (const plfId of plfIds) {
      const p = data.platforms[plfId];
      if (!p || !p.situation) continue;
      const per = data.platformLineInfo[plfId];
      if (!per) continue;

      for (const [lk, d] of Object.entries(per)) {
        const ref = d.ref;
        if (!ref.available) continue;
        if (!d.stopAllowed) continue;
        if (ref.getout) alightStates.push({ plfId, lk, staId: p.stationId });
        if (ref.getin) boardStates.push({ plfId, lk, staId: p.stationId });
      }
    }

    if (!alightStates.length || !boardStates.length) return;

    for (const a of alightStates) {
      const fromState = stateKey(a.plfId, a.lk);
      ensure(fromState);

      for (const b of boardStates) {
        if (a.plfId === b.plfId && a.lk === b.lk) continue;

        const toState = stateKey(b.plfId, b.lk);
        ensure(toState);

        const raw = rawFn(a.staId, b.staId);
        const weight = raw / 10;

        adj[fromState].push({
          kind: 'transfer',
          to: toState,
          fromPlfId: a.plfId,
          toPlfId: b.plfId,
          rawDistance: raw,
          weightDistance: weight,
          fromStaId: a.staId,
          toStaId: b.staId,
        });
      }
    }
  };

  // STA group transfers (cost=0)
  const stationToPlatforms: Record<string, string[]> = {};
  for (const [plfId, p] of Object.entries(data.platforms)) {
    if (!p) continue;
    const sid = p.stationId;
    if (!sid) continue;
    (stationToPlatforms[sid] ??= []).push(plfId);
  }
  for (const plfIds of Object.values(stationToPlatforms)) {
    addPassengerTransfersForPlatforms(plfIds, () => 0);
  }

  // building group transfers (cost=staDist)
  const buildingToPlatforms: Record<string, string[]> = {};
  for (const [plfId, bids] of Object.entries(data.platformToBuildingIds)) {
    for (const bid of bids) {
      (buildingToPlatforms[bid] ??= []).push(plfId);
    }
  }
  for (const plfIds of Object.values(buildingToPlatforms)) {
    addPassengerTransfersForPlatforms(plfIds, staDist);
  }

  return adj;
}

/**
 * 二叉堆（最小堆）优先队列
 */
class MinHeap<T> {
  private a: T[] = [];
  constructor(private less: (x: T, y: T) => boolean) {}
  get size() {
    return this.a.length;
  }
  push(v: T) {
    this.a.push(v);
    this.up(this.a.length - 1);
  }
  pop(): T | undefined {
    if (!this.a.length) return undefined;
    const top = this.a[0];
    const last = this.a.pop()!;
    if (this.a.length) {
      this.a[0] = last;
      this.down(0);
    }
    return top;
  }
  private up(i: number) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(this.a[i], this.a[p])) break;
      [this.a[i], this.a[p]] = [this.a[p], this.a[i]];
      i = p;
    }
  }
  private down(i: number) {
    const n = this.a.length;
    while (true) {
      let m = i;
      const l = i * 2 + 1;
      const r = l + 1;
      if (l < n && this.less(this.a[l], this.a[m])) m = l;
      if (r < n && this.less(this.a[r], this.a[m])) m = r;
      if (m === i) break;
      [this.a[i], this.a[m]] = [this.a[m], this.a[i]];
      i = m;
    }
  }
}

function nearestBuilding(coord: P3, buildings: Building[]): Building | null {
  let best: Building | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const b of buildings) {
    const d = distanceXZ(coord, b.center);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

function uniqueStationsInOrder(names: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of names) {
    if (!n) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function computePath(
  data: Nav2WorldData,
  adj: Record<StateKey, Edge[]>,
  start: Nav2Input,
  end: Nav2Input,
  objective: Objective,
  useElytra: boolean
): PathResult {
  // 1) 解析起终点到 building（若输入为 building，则直接使用；若为坐标，则找最近 building）
  const startCoord: P3 = { x: start.coord.x, y: start.coord.y ?? Y_FOR_DISPLAY, z: start.coord.z };
  const endCoord: P3 = { x: end.coord.x, y: end.coord.y ?? Y_FOR_DISPLAY, z: end.coord.z };

  const startBuilding =
    start.kind === 'building'
      ? data.buildings.find(b => b.id === start.buildingId) ?? null
      : nearestBuilding(startCoord, data.buildings);

  const endBuilding =
    end.kind === 'building' ? data.buildings.find(b => b.id === end.buildingId) ?? null : nearestBuilding(endCoord, data.buildings);

  if (!startBuilding || !endBuilding) {
    return {
      found: false,
      objective,
      totalRailDistance: 0,
      totalTransferDistance: 0,
      totalAccessDistance: 0,
      totalTimeSeconds: 0,
      transfers: 0,
      pathStates: [],
      edges: [],
      segments: [],
      highlightPath: [],
    };
  }

  const accessDist = distanceXZ(startCoord, startBuilding.center);
  const egressDist = distanceXZ(endCoord, endBuilding.center);
  const accessTime = calculateWalkTime(accessDist, useElytra);
  const egressTime = calculateWalkTime(egressDist, useElytra);

  // 2) 生成 startStates / endStates（节点为 platform+lineKey 状态）
  const stationPlatforms = (stationIds: string[]) => {
    const out: string[] = [];
    for (const sid of stationIds) {
      const sta = data.stations[sid];
      if (!sta) continue;
      for (const pid of sta.platformIds) out.push(pid);
    }
    return out;
  };

  const startPlfs = stationPlatforms(startBuilding.stationIds);
  const endPlfs = stationPlatforms(endBuilding.stationIds);

  const startStates: StateKey[] = [];
  for (const pid of startPlfs) {
    const p = data.platforms[pid];
    if (!p || !p.situation) continue;
    const per = data.platformLineInfo[pid];
    if (!per) continue;
    for (const [lk, d] of Object.entries(per)) {
      if (!d.ref.available) continue;
      if (!d.stopAllowed) continue;
      if (!d.ref.getin) continue;
      startStates.push(stateKey(pid, lk));
    }
  }

  const endStatesSet = new Set<StateKey>();
  for (const pid of endPlfs) {
    const p = data.platforms[pid];
    if (!p || !p.situation) continue;
    const per = data.platformLineInfo[pid];
    if (!per) continue;
    for (const [lk, d] of Object.entries(per)) {
      if (!d.ref.available) continue;
      if (!d.stopAllowed) continue;
      if (!d.ref.getout) continue;
      endStatesSet.add(stateKey(pid, lk));
    }
  }

  if (!startStates.length || !endStatesSet.size) {
    return {
      found: false,
      objective,
      totalRailDistance: 0,
      totalTransferDistance: 0,
      totalAccessDistance: accessDist + egressDist,
      totalTimeSeconds: accessTime + egressTime,
      transfers: 0,
      pathStates: [],
      edges: [],
      segments: [
        {
          kind: 'access',
          mode: useElytra ? 'elytra' : 'walk',
          from: start.coord,
          to: { x: startBuilding.center.x, y: startBuilding.center.y, z: startBuilding.center.z },
          distance: accessDist,
          timeSeconds: accessTime,
        },
        {
          kind: 'egress',
          mode: useElytra ? 'elytra' : 'walk',
          from: { x: endBuilding.center.x, y: endBuilding.center.y, z: endBuilding.center.z },
          to: end.coord,
          distance: egressDist,
          timeSeconds: egressTime,
        },
      ],
      highlightPath: [
        { coord: start.coord },
        { coord: { x: startBuilding.center.x, y: startBuilding.center.y, z: startBuilding.center.z } },
        { coord: { x: endBuilding.center.x, y: endBuilding.center.y, z: endBuilding.center.z } },
        { coord: end.coord },
      ],
    };
  }

  // 3) Dijkstra
  // time objective: weight = edgeTimeSeconds
  // transfer objective: weight = transfers * PENALTY + timeSeconds
  const TRANSFER_PENALTY = 1_000_000; // 秒级别大惩罚，保证 transfer 优先级
  const dist: Record<StateKey, number> = {};
  const prev: Record<StateKey, { from: StateKey; edge: Edge } | null> = {};

  const heap = new MinHeap<{ k: StateKey; d: number; transfers: number }>((a, b) => a.d < b.d);

  const getEdgeTime = (e: Edge) => {
    if (e.kind === 'rail') return calculateRailTime(e.distance);
    // transfer：按原始距离换算步行时间，再 /10 作为权重；隐藏 transfer 视为 0
    return e.hidden ? 0 : calculateWalkTime(e.rawDistance, false) / 10;
  };

  const getEdgeTransferInc = (e: Edge) => (e.kind === 'transfer' && !e.hidden ? 1 : 0);

  // init
  for (const s of startStates) {
    dist[s] = objective === 'time' ? accessTime : accessTime; // access 不计 transfer
    prev[s] = null;
    heap.push({ k: s, d: dist[s], transfers: 0 });
  }

  // 记录 transfers 以支持 transfer objective 的“实际换乘数”输出
  const bestTransfers: Record<StateKey, number> = {};
  for (const s of startStates) bestTransfers[s] = 0;

  let bestEnd: StateKey | null = null;
  let bestEndScalar = Number.POSITIVE_INFINITY;

  while (heap.size) {
    const cur = heap.pop()!;
    const u = cur.k;

    const curDist = dist[u];
    if (curDist === undefined) continue;

    // 已有更优解
    if (cur.d !== curDist) continue;

    // 命中终点
    if (endStatesSet.has(u)) {
      const scalar = objective === 'time' ? curDist + egressTime : curDist + egressTime;
      if (scalar < bestEndScalar) {
        bestEndScalar = scalar;
        bestEnd = u;
      }
      // time objective：第一个到达即可最优（所有边权非负）
      if (objective === 'time') break;
      // transfer objective：仍可能存在更少 transfer 的路径？由于 penalty 极大，已 pop 的即为最优
      break;
    }

    const edges = adj[u] ?? [];
    for (const e of edges) {
      const v = e.to;
      const eTime = getEdgeTime(e);
      const incT = getEdgeTransferInc(e);

      const uTransfers = bestTransfers[u] ?? 0;
      const vTransfers = uTransfers + incT;

      const weight = objective === 'time' ? eTime : incT * TRANSFER_PENALTY + eTime;
      const alt = curDist + weight;

      if (dist[v] === undefined || alt < dist[v]) {
        dist[v] = alt;
        prev[v] = { from: u, edge: e };
        bestTransfers[v] = vTransfers;
        heap.push({ k: v, d: alt, transfers: vTransfers });
      }
    }
  }

  if (!bestEnd) {
    return {
      found: false,
      objective,
      totalRailDistance: 0,
      totalTransferDistance: 0,
      totalAccessDistance: accessDist + egressDist,
      totalTimeSeconds: accessTime + egressTime,
      transfers: 0,
      pathStates: [],
      edges: [],
      segments: [
        {
          kind: 'access',
          mode: useElytra ? 'elytra' : 'walk',
          from: start.coord,
          to: { x: startBuilding.center.x, y: startBuilding.center.y, z: startBuilding.center.z },
          distance: accessDist,
          timeSeconds: accessTime,
        },
        {
          kind: 'egress',
          mode: useElytra ? 'elytra' : 'walk',
          from: { x: endBuilding.center.x, y: endBuilding.center.y, z: endBuilding.center.z },
          to: end.coord,
          distance: egressDist,
          timeSeconds: egressTime,
        },
      ],
      highlightPath: [
        { coord: start.coord },
        { coord: { x: startBuilding.center.x, y: startBuilding.center.y, z: startBuilding.center.z } },
        { coord: { x: endBuilding.center.x, y: endBuilding.center.y, z: endBuilding.center.z } },
        { coord: end.coord },
      ],
    };
  }

  // 4) 反向重建状态路径与边
  const states: StateKey[] = [];
  const edges: Edge[] = [];
  let cur: StateKey | null = bestEnd;
  while (cur) {
    states.push(cur);
    // 显式类型标注：避免在 strict/noImplicitAny 环境下出现 TS7022 推断失败
    const prevStep: { from: StateKey; edge: Edge } | null = prev[cur];
    if (prevStep) {
      edges.push(prevStep.edge);
      cur = prevStep.from;
    } else {
      cur = null;
    }
  }
  states.reverse();
  edges.reverse();

  const transfers = bestTransfers[bestEnd] ?? 0;

  // 5) 输出 segments（合并连续 rail）
  const getStationNameOfPlatform = (plfId: string) => {
    const p = data.platforms[plfId];
    const staId = p?.stationId;
    const sta = staId ? data.stations[staId] : null;
    return sta?.name ?? (p?.name || plfId);
  };

  const isVisiblePlatform = (plfId: string, lk?: string) => {
    const p = data.platforms[plfId];
    if (!p) return true;
    if (p.connect === false) return false;
    if (lk) {
      const d = data.platformLineInfo[plfId]?.[lk];
      if (d && !d.stopAllowed) return false;
    }
    return true;
  };

  const segments: PathResult['segments'] = [];

  // access segment
  if (accessDist > 1e-6) {
    segments.push({
      kind: 'access',
      mode: useElytra ? 'elytra' : 'walk',
      from: start.coord,
      to: { x: startBuilding.center.x, y: startBuilding.center.y, z: startBuilding.center.z },
      distance: accessDist,
      timeSeconds: accessTime,
    });
  }

  let totalRailDistance = 0;
  let totalTransferDistance = 0;

  // rail grouping
  let i = 0;
  while (i < edges.length) {
    const e = edges[i];
    if (e.kind === 'rail') {
      const lk = e.lineKey;
      const line = data.lines[lk];
      let j = i;
      let distAcc = 0;
      const viaStations: string[] = [];

      const firstFrom = e.fromPlfId;
      let lastTo = e.toPlfId;

      // collect stops in order using lineStopIndex
      const stopIds: string[] = [firstFrom];
      distAcc += e.distance;
      stopIds.push(e.toPlfId);

      j++;
      while (j < edges.length && edges[j].kind === 'rail' && (edges[j] as any).lineKey === lk) {
        const ee = edges[j] as any as Extract<Edge, { kind: 'rail' }>;
        distAcc += ee.distance;
        lastTo = ee.toPlfId;
        stopIds.push(ee.toPlfId);
        j++;
      }

      // 途经站：按 stopIds 的 stationName（去重；过滤 Connect=false 或 stopAllowed=false）
      for (const pid of stopIds) {
        if (!isVisiblePlatform(pid, lk)) continue;
        viaStations.push(getStationNameOfPlatform(pid));
      }

      totalRailDistance += distAcc;

      const fromStation = getStationNameOfPlatform(firstFrom);
      const toStation = getStationNameOfPlatform(lastTo);
      const tRail = calculateRailTime(distAcc);

      segments.push({
        kind: 'rail',
        lineKey: lk,
        lineName: line?.name ?? lk,
        color: line?.color ?? '#2196F3',
        fromStation,
        toStation,
        viaStations: uniqueStationsInOrder(viaStations),
        distance: distAcc,
        timeSeconds: tRail,
      });

      i = j;
      continue;
    }

    if (e.kind === 'transfer') {
      totalTransferDistance += e.rawDistance;
      const t = calculateWalkTime(e.rawDistance, false) / 10;

      // 转乘发生站：尽量显示可见站名
      const aName = isVisiblePlatform(e.fromPlfId) ? getStationNameOfPlatform(e.fromPlfId) : '';
      const bName = isVisiblePlatform(e.toPlfId) ? getStationNameOfPlatform(e.toPlfId) : '';
      const at = aName || bName || '（联络节点换乘）';

      segments.push({
        kind: 'transfer',
        at,
        rawDistance: e.rawDistance,
        timeSeconds: t,
      });

      i++;
      continue;
    }

    i++;
  }

  // egress
  if (egressDist > 1e-6) {
    segments.push({
      kind: 'egress',
      mode: useElytra ? 'elytra' : 'walk',
      from: { x: endBuilding.center.x, y: endBuilding.center.y, z: endBuilding.center.z },
      to: end.coord,
      distance: egressDist,
      timeSeconds: egressTime,
    });
  }

  // 6) highlight path（用于 RouteHighlightLayer）：access -> rail geometry -> transfer -> egress
  const highlight: Array<{ coord: Coordinate }> = [];

  const pushCoord = (c: Coordinate) => {
    const last = highlight[highlight.length - 1]?.coord;
    if (last && Math.abs(last.x - c.x) < 1e-6 && Math.abs((last.y ?? 0) - (c.y ?? 0)) < 1e-6 && Math.abs(last.z - c.z) < 1e-6) return;
    highlight.push({ coord: c });
  };

  pushCoord(start.coord);
  pushCoord({ x: startBuilding.center.x, y: startBuilding.center.y, z: startBuilding.center.z });

  for (const e of edges) {
    if (e.kind === 'rail') {
      for (const p of e.geometry) pushCoord({ x: p.x, y: p.y, z: p.z });
    } else if (e.kind === 'transfer') {
      if (e.hidden) continue;
      if (e.rawDistance <= 1e-6) continue;
      const sa = e.fromStaId ? data.stations[e.fromStaId]?.coord : undefined;
      const sb = e.toStaId ? data.stations[e.toStaId]?.coord : undefined;
      if (sa && sb) {
        pushCoord({ x: sa.x, y: sa.y, z: sa.z });
        pushCoord({ x: sb.x, y: sb.y, z: sb.z });
      }
    }
  }

  pushCoord({ x: endBuilding.center.x, y: endBuilding.center.y, z: endBuilding.center.z });
  pushCoord(end.coord);

  // 7) 估算总时间（按 segments 汇总，transfer 以 distance 已 /10 的步行时间为准）
  const segTime = segments.reduce((acc, s) => acc + (s as any).timeSeconds, 0);

  return {
    found: true,
    objective,
    totalRailDistance,
    totalTransferDistance,
    totalAccessDistance: accessDist + egressDist,
    totalTimeSeconds: segTime,
    transfers,
    pathStates: states,
    edges,
    segments,
    highlightPath: highlight,
  };
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)}秒`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return secs > 0 ? `${mins}分${secs}秒` : `${mins}分钟`;
}

function formatDistance(d: number): string {
  if (!Number.isFinite(d)) return '—';
  if (d < 1000) return `${Math.round(d)}m`;
  return `${(d / 1000).toFixed(2)}km`;
}

/* ----------------------------- UI: SearchInput ----------------------------- */

type Suggestion = { id: string; name: string; center: Coordinate };

function SearchInput(props: {
  label: string;
  value: Nav2Input | null;
  suggestions: Suggestion[];
  placeholder?: string;
  onChange: (v: Nav2Input | null) => void;
}) {
  const { label, value, suggestions, placeholder, onChange } = props;
  const [query, setQuery] = useState(value?.name ?? '');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => setQuery(value?.name ?? ''), [value?.name]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target as any)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return suggestions.slice(0, 20);
    return suggestions
      .filter(s => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
      .slice(0, 20);
  }, [query, suggestions]);

  const commit = (text: string) => {
    const c = parseCoordFromText(text);
    if (c) {
      onChange({ kind: 'coord', name: `坐标 ${Math.round(c.x)}, ${Math.round(c.z)}`, coord: c });
      setOpen(false);
      return;
    }
    // 若完全匹配 building 名称，则选中
    const exact = suggestions.find(s => s.name === text);
    if (exact) {
      onChange({ kind: 'building', buildingId: exact.id, name: exact.name, coord: exact.center });
      setOpen(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <label className="text-xs text-gray-500 mb-1 block">{label}</label>
      <div className="relative">
        <input
          type="text"
          value={query}
          placeholder={placeholder ?? '输入车站建筑名，或坐标 x,z'}
          className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          onChange={e => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit(query);
            }
            if (e.key === 'Escape') setOpen(false);
          }}
        />
        {value && (
          <button
            type="button"
            className="absolute right-2 top-2 text-gray-400 hover:text-gray-600"
            onClick={() => {
              onChange(null);
              setQuery('');
            }}
            title="清除"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {open && filtered.length > 0 && (
        <div className="absolute z-50 w-full bg-white border rounded-md shadow-lg mt-1 max-h-48 overflow-auto">
          {filtered.map(s => (
            <button
              key={s.id}
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm flex items-center gap-2"
              onClick={() => {
                onChange({ kind: 'building', buildingId: s.id, name: s.name, coord: s.center });
                setOpen(false);
              }}
            >
              <MapPin className="w-4 h-4 text-gray-400" />
              <span className="flex-1 truncate">{s.name}</span>
              <span className="text-xs text-gray-400">{s.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ----------------------------- 主组件 ----------------------------- */

export function NavigationPanel2(props: {
  worldId: string;
  onRouteFound?: (path: Array<{ coord: Coordinate }>) => void;
  onClose: () => void;
}) {
  const { worldId, onRouteFound, onClose } = props;

  const [objective, setObjective] = useState<Objective>('time');
  const [useElytra, setUseElytra] = useState(true);

  const [start, setStart] = useState<Nav2Input | null>(null);
  const [end, setEnd] = useState<Nav2Input | null>(null);

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [data, setData] = useState<Nav2WorldData | null>(null);
  const graphRef = useRef<Record<StateKey, Edge[]> | null>(null);

  const [result, setResult] = useState<PathResult | null>(null);
  const [showVia, setShowVia] = useState(false);

  // 数据加载（仅一次/随 worldId 切换）
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoadError(null);
      setData(null);
      graphRef.current = null;
      setResult(null);

      const ds = getNav2DataSource(worldId);
      if (!ds || !ds.baseUrl || !ds.files?.length) {
        setLoadError('未配置可用的数据源（NAV2_DATA_SOURCES 或 RULE_DATA_SOURCES）');
        return;
      }

      try {
        const items: any[] = [];
        for (const f of ds.files) {
          const url = `${ds.baseUrl}/${f}`;
          try {
            const arr = await fetchJsonArray(url);
            items.push(...arr);
          } catch {
            // 忽略单文件错误，避免因为个别文件缺失导致整体不可用
          }
        }

        // 只保留导航相关 Class
        const navItems = items.filter(it => {
          const c = safeString(it?.Class);
          return c === 'STA' || c === 'PLF' || c === 'STB' || c === 'SBP' || c === 'RLE';
        });

        const parsed = parseWorldItems(navItems);
        const built = buildWorldData(parsed);
        const graph = buildGraph(built);

        if (cancelled) return;
        setData(built);
        graphRef.current = graph;
      } catch (e: any) {
        if (cancelled) return;
        setLoadError(e?.message ?? '数据加载失败');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [worldId]);

  const buildingSuggestions = useMemo<Suggestion[]>(() => {
    if (!data) return [];
    return data.buildings.map(b => ({
      id: b.id,
      name: b.name,
      center: { x: b.center.x, y: b.center.y, z: b.center.z },
    }));
  }, [data]);

  const canCompute = !!data && !!graphRef.current && !!start && !!end && !loading;

  const handleSwap = () => {
    setStart(end);
    setEnd(start);
    setResult(null);
  };

  const handleCompute = () => {
    if (!canCompute || !data || !graphRef.current || !start || !end) return;
    setLoading(true);
    setLoadError(null);

    try {
      const r = computePath(data, graphRef.current, start, end, objective, useElytra);
      setResult(r);
      if (r.found && onRouteFound) onRouteFound(r.highlightPath);
      setShowVia(false);
    } catch (e: any) {
      setLoadError(e?.message ?? '路径计算失败');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg w-full sm:w-80 max-h-[70vh] flex flex-col">
      {/* 标题 */}
      <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
        <div className="flex items-center gap-2">
          <Train className="w-5 h-5 text-gray-700" />
          <h3 className="font-bold text-gray-800">平台导航</h3>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600" type="button">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* 选项 */}
      <div className="px-4 py-3 border-b space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setObjective('time')}
            className={`px-3 py-2 rounded text-sm border ${
              objective === 'time' ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            时间优先
          </button>
          <button
            type="button"
            onClick={() => setObjective('transfer')}
            className={`px-3 py-2 rounded text-sm border ${
              objective === 'transfer'
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            最少换乘
          </button>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-700 select-none">
          <input type="checkbox" checked={useElytra} onChange={e => setUseElytra(e.target.checked)} />
          起终点使用鞘翅（非车站时）
        </label>

        <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
          <SearchInput label="起点" value={start} suggestions={buildingSuggestions} onChange={setStart} />
          <button
            type="button"
            onClick={handleSwap}
            className="h-10 px-2 border rounded-md hover:bg-gray-50 text-gray-600"
            title="交换起终点"
          >
            <ArrowLeftRight className="w-4 h-4" />
          </button>
        </div>

        <SearchInput label="终点" value={end} suggestions={buildingSuggestions} onChange={setEnd} />

        {loadError && <div className="text-xs text-red-600">{loadError}</div>}

        <button
          type="button"
          disabled={!canCompute}
          onClick={handleCompute}
          className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium ${
            canCompute ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-200 text-gray-500 cursor-not-allowed'
          }`}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Train className="w-4 h-4" />}
          计算路线
        </button>

        {!data && !loadError && (
          <div className="text-xs text-gray-500 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            正在加载规则数据…
          </div>
        )}
      </div>

      {/* 结果 */}
      <div className="px-4 py-3 overflow-auto">
        {!result && <div className="text-sm text-gray-500">请选择起终点后计算路线。</div>}

        {result && !result.found && (
          <div className="text-sm text-gray-600">
            未找到可行路线（请检查：站台 Situation/Available、线路方向、换乘归属 STB/SBP 等）。
          </div>
        )}

        {result && result.found && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="px-2 py-1 rounded bg-gray-100 text-gray-700">总耗时 {formatTime(result.totalTimeSeconds)}</span>
              <span className="px-2 py-1 rounded bg-gray-100 text-gray-700">换乘 {result.transfers} 次</span>
              <span className="px-2 py-1 rounded bg-gray-100 text-gray-700">铁路 {formatDistance(result.totalRailDistance)}</span>
              <span className="px-2 py-1 rounded bg-gray-100 text-gray-700">步行/鞘翅 {formatDistance(result.totalAccessDistance)}</span>
            </div>

            {/* 分段展示 */}
            <div className="space-y-2">
              {result.segments.map((s, idx) => {
                if (s.kind === 'rail') {
                  return (
                    <div key={idx} className="border rounded-md p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-gray-800 truncate">{s.lineName}</div>
                            <div className="text-xs text-gray-500 truncate">
                              {s.fromStation} → {s.toStation}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-gray-700">{formatTime(s.timeSeconds)}</div>
                          <div className="text-xs text-gray-400">{formatDistance(s.distance)}</div>
                        </div>
                      </div>
                    </div>
                  );
                }

                if (s.kind === 'transfer') {
                  return (
                    <div key={idx} className="border rounded-md p-3 bg-yellow-50 border-yellow-200">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium text-yellow-900">换乘：{s.at}</div>
                        <div className="text-right">
                          <div className="text-xs text-yellow-900">{formatTime(s.timeSeconds)}</div>
                          <div className="text-xs text-yellow-700">{formatDistance(s.rawDistance)}</div>
                        </div>
                      </div>
                    </div>
                  );
                }

                // access / egress
                return (
                  <div key={idx} className="border rounded-md p-3 bg-gray-50">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium text-gray-700">
                        {s.kind === 'access' ? '前往车站' : '离开车站'}（{s.mode === 'elytra' ? '鞘翅' : '步行'}）
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-700">{formatTime(s.timeSeconds)}</div>
                        <div className="text-xs text-gray-400">{formatDistance(s.distance)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 途经站列表（下拉） */}
            <div className="border rounded-md">
              <button
                type="button"
                className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50"
                onClick={() => setShowVia(v => !v)}
              >
                <span className="font-medium text-gray-800">途经车站</span>
                {showVia ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
              </button>

              {showVia && (
                <div className="px-3 pb-3 space-y-2">
                  {result.segments
                    .filter(s => s.kind === 'rail')
                    .map((s, idx) => {
                      const seg = s as Extract<PathResult['segments'][number], { kind: 'rail' }>;
                      return (
                        <div key={idx} className="text-sm">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: seg.color }} />
                            <span className="text-xs text-gray-600 truncate">{seg.lineName}</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {seg.viaStations.map((n, j) => (
                              <span key={j} className="px-2 py-1 rounded bg-gray-100 text-gray-700 text-xs">
                                {n}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default NavigationPanel2;
