/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * railNewIndex.ts
 *
 * 目标：为信息卡与跨目录模块提供可复用的“铁路新结构索引”。
 *
 *
 * 覆盖对象：STA / STB / PLF / RLE（同时兼容 SBP 作为 building 参与 station 关系）。
 */

import { RULE_DATA_SOURCES, type WorldRuleDataSource } from '../Rules/ruleDataSources';

// ===== Lines[] 布尔字段过滤开关（true: 字段为 false 则视为“不包含”；false: 忽略该字段） =====
// 说明：此开关用于信息卡/导航等“包含线路”聚合逻辑的过滤策略。
// 未来若需要让其它布尔字段介入“是否显示/是否参与去重”，只需在此处新增键并设为 true。
export const LINE_BOOL_FILTER_SWITCHES: Record<string, boolean> = {
  Avaliable: true,
};

export function passLineBooleanFilters(flags?: Record<string, boolean>): boolean {
  if (!flags) return true;
  for (const [k, enabled] of Object.entries(LINE_BOOL_FILTER_SWITCHES)) {
    if (!enabled) continue;
    if (typeof (flags as any)[k] === 'boolean' && (flags as any)[k] === false) return false;
  }
  return true;
}


// ------------------------------
// Public types
// ------------------------------

export type RailLineRef = {
  id: string;
  bureau?: string;
  line?: string;
  /** lines[] 内布尔字段（如 Avaliable），用于显示/聚合过滤 */
  flags?: Record<string, boolean>;
};

export type RailRle = {
  id: string;
  bureau?: string;
  line?: string;
  color: string; // 规范化后的 CSS color
  direction: number;
  name: string;
};

export type RailPlf = {
  id: string;
  lines: RailLineRef[];
  connect: boolean;
};

export type RailSta = {
  id: string;
  name: string;
  platformIds: string[];
  /** 兼容字段：STA.STBuilding（可能为 STB 或 SBP 的 id） */
  buildingIds: string[];
};

export type RailBuilding = {
  id: string;
  kind: 'STB' | 'SBP';
  name: string;
  height?: string;
  stationIds: string[];
};

export type RailNewIndex = {
  worldId: string;
  stas: Map<string, RailSta>;
  plfs: Map<string, RailPlf>;
  rles: Map<string, RailRle>;
  buildings: Map<string, RailBuilding>;
  /** STA.stationID -> STB/SBP ids */
  stationToBuildings: Map<string, Set<string>>;
  /** STB/SBP id -> STA.stationID */
  buildingToStations: Map<string, Set<string>>;
};

// ------------------------------
// Internal helpers
// ------------------------------

const RULE_ITEMS_CACHE = new Map<string, any[]>();
const RULE_ITEMS_PENDING = new Map<string, Promise<any[]>>();
const RAIL_INDEX_CACHE = new Map<string, RailNewIndex>();

function str(v: any): string {
  return String(v ?? '').trim();
}

function asBool(v: any, fallback = false): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (t === 'true' || t === '1' || t === 'yes') return true;
    if (t === 'false' || t === '0' || t === 'no') return false;
  }
  return fallback;
}

function extractBooleanFlags(obj: any): Record<string, boolean> | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const flags: Record<string, boolean> = {};
  for (const k of Object.keys(obj)) {
    if (typeof (obj as any)[k] === 'boolean') flags[k] = (obj as any)[k];
  }
  return Object.keys(flags).length ? flags : undefined;
}


function pickFirst(obj: any, keys: string[]): any {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return undefined;
}

function pickId(obj: any): string {
  return str(
    pickFirst(obj, [
      'ID',
      'Id',
      'id',
      // STA
      'stationID',
      'stationId',
      'StationID',
      'StationId',
      // PLF
      'platformID',
      'platformId',
      // RLE
      'LineID',
      'lineID',
      'lineId',
      // STB/SBP
      'staBuildingID',
      'staBuildingId',
      'staBuildingPointID',
      'staBuildingPointId',
      'buildingID',
      'buildingId',
    ])
  );
}

function splitIds(v: any): string[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) {
    return v
      .map((x) => {
        if (typeof x === 'string' || typeof x === 'number') return str(x);
        const id = pickId(x);
        return id || str(x);
      })
      .map((s) => str(s))
      .filter(Boolean);
  }
  const s = str(v);
  if (!s) return [];
  return s
    .split(/[,;，；\s]+/g)
    .map((x) => str(x))
    .filter(Boolean);
}

function normalizeWorldId(worldId: string): string {
  const wid = str(worldId);
  if (!wid) return wid;

  if ((RULE_DATA_SOURCES as any)[wid]) return wid;

  // 兼容数字世界：0..3（与 Navigation_RailNewIntegrated.tsx 一致）
  if (/^\d+$/.test(wid)) {
    const n = parseInt(wid, 10);
    if (n === 0) return 'zth';
    if (n === 1) return 'naraku';
    if (n === 2) return 'houtu';
    if (n === 3) return 'eden';
    return wid;
  }

  const map: Record<string, string> = {
    零洲: 'zth',
    奈落: 'naraku',
    后土: 'houtu',
    伊甸: 'eden',
  };
  return map[wid] ?? wid;
}

function makeRuleCacheKey(wid: string, merged: WorldRuleDataSource): string {
  const files = Array.isArray(merged.files) ? merged.files : [];
  return `${wid}::${merged.baseUrl ?? ''}::${files.join('|')}`;
}

async function defaultFetcher(url: string): Promise<any[]> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  const data = await resp.json();
  return Array.isArray(data) ? data : [];
}

async function loadRuleItems(worldId: string): Promise<any[]> {
  const wid = normalizeWorldId(worldId);
  const base = RULE_DATA_SOURCES[wid];
  const merged: WorldRuleDataSource = {
    baseUrl: base?.baseUrl ?? '/data/JSON',
    files: base?.files ?? [],
  };

  const cacheKey = makeRuleCacheKey(wid, merged);
  const cached = RULE_ITEMS_CACHE.get(cacheKey);
  if (cached) return cached;

  const pending = RULE_ITEMS_PENDING.get(cacheKey);
  if (pending) return pending;

  const p = (async () => {
    const items: any[] = [];
    if (!merged.files || merged.files.length === 0) {
      RULE_ITEMS_CACHE.set(cacheKey, items);
      return items;
    }
    const results = await Promise.all(
      merged.files.map(async (file) => {
        const url = `${merged.baseUrl.replace(/\/$/, '')}/${file}`;
        try {
          return await defaultFetcher(url);
        } catch {
          // 单文件失败不中断（与导航/RuleLayer 一致）
          return [];
        }
      })
    );
    for (const arr of results) {
      if (!Array.isArray(arr)) continue;
      for (const it of arr) items.push(it);
    }
    RULE_ITEMS_CACHE.set(cacheKey, items);
    return items;
  })();

  RULE_ITEMS_PENDING.set(cacheKey, p);
  try {
    return await p;
  } finally {
    RULE_ITEMS_PENDING.delete(cacheKey);
  }
}

function normalizeCssColor(input: any, fallback = '#999999'): string {
  const s = str(input);
  if (!s) return fallback;
  if (/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(s)) return s;
  if (/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(s)) return `#${s}`;
  if (/^0x[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(s)) return `#${s.slice(2)}`;
  if (/^(rgb|rgba|hsl|hsla)\(/i.test(s)) return s;
  return fallback;
}

// ------------------------------
// Parsers
// ------------------------------

function parseSta(all: any[]): Map<string, RailSta> {
  const out = new Map<string, RailSta>();
  for (const it of all) {
    if (str(it?.Class) !== 'STA') continue;
    const id = str(it.stationID ?? it.stationId ?? it.ID ?? it.id);
    if (!id) continue;
    const name = str(it.stationName ?? it.name ?? it.Name ?? id) || id;

    const platformsArr = it.platforms ?? it.Platforms ?? it.PLFS ?? it.PLFs ?? [];
    const platformIds: string[] = [];
    if (Array.isArray(platformsArr)) {
      for (const p of platformsArr) {
        const pid = str(p?.ID ?? p?.platformID ?? p?.platformId ?? p);
        if (pid) platformIds.push(pid);
      }
    }

    const buildingIds = splitIds(
      it.STBuilding ?? it.StBuilding ?? it.stBuilding ?? it.stationBuilding ?? it.stationBuildingId ?? ''
    );

    out.set(id, { id, name: name || id, platformIds, buildingIds });
  }
  return out;
}

function parsePlf(all: any[]): Map<string, RailPlf> {
  const out = new Map<string, RailPlf>();
  for (const it of all) {
    if (str(it?.Class) !== 'PLF') continue;
    const id = str(it.platformID ?? it.platformId ?? it.ID ?? it.id);
    if (!id) continue;
    const Connect = asBool(it.Connect, true);

    const linesRaw = it.lines ?? it.Lines ?? [];
    const lines: RailLineRef[] = [];
    if (Array.isArray(linesRaw)) {
      for (const lr of linesRaw) {
        const lid = str(lr?.ID ?? lr?.LineID ?? lr?.lineID ?? lr?.id ?? lr);
        if (!lid) continue;
        lines.push({
          id: lid,
          bureau: lr?.bureau ? str(lr.bureau) : undefined,
          line: lr?.line ? str(lr.line) : undefined,
          flags: extractBooleanFlags(lr),
        });
      }
    }

    out.set(id, { id, lines, connect: Connect });
  }
  return out;
}

function parseRle(all: any[]): Map<string, RailRle> {
  const out = new Map<string, RailRle>();
  for (const it of all) {
    if (str(it?.Class) !== 'RLE') continue;

    // 兼容：RLE 的主键在不同文件中可能是 LineID 或 ID
    const idPrimary = str(it.LineID ?? it.lineID ?? it.lineId ?? '');
    const idAlt = str(it.ID ?? it.Id ?? it.id ?? '');
    const id = idPrimary || idAlt;
    if (!id) continue;

    const nameRaw =
      it.LineName ??
      it.lineName ??
      it.line_name ??
      it.Name ??
      it.name ??
      it.title ??
      it.Title ??
      it.tags?.LineName ??
      it.tags?.lineName ??
      it.tags?.Name ??
      it.tags?.name ??
      it.extensions?.LineName ??
      it.extensions?.lineName ??
      it.extensions?.Name ??
      it.extensions?.name ??
      it.line ??
      it.Line ??
      '';
    const name = str(nameRaw || id) || id;
    const bureau = it.bureau ? str(it.bureau) : undefined;
    const line = it.line ? str(it.line) : undefined;
    const direction = Number.isFinite(Number(it.direction)) ? Number(it.direction) : 0;
    const colorRaw =
      it.color ??
      it.Color ??
      it.colour ??
      it.Colour ??
      it.lineColor ??
      it.LineColor ??
      it.colorHex ??
      it.ColorHex ??
      it.hex ??
      it.Hex ??
      it.colorNo ??
      it.ColorNo ??
      it.tags?.color ??
      it.tags?.Color ??
      it.extensions?.color ??
      it.extensions?.Color ??
      '';
    const color = normalizeCssColor(colorRaw, '#999999');

    const obj: RailRle = { id, name, bureau, line, direction, color };

    // 同一个对象同时用多个 key 建索引，确保 PLF.lines[] 中引用哪种 ID 都能命中
    out.set(id, obj);
    if (idAlt && idAlt !== id) out.set(idAlt, obj);
    if (idPrimary && idPrimary !== id) out.set(idPrimary, obj);
  }
  return out;
}

function parseBuildings(all: any[]): Map<string, RailBuilding> {
  const out = new Map<string, RailBuilding>();

  const parseStationsGroup = (it: any): string[] => {
    const g =
      it?.Stations ??
      it?.stations ??
      it?.stationsgroup ??
      it?.stationsGroup ??
      it?.StationsGroup ??
      it?.Stationsgroup ??
      [];
    const ids: string[] = [];
    if (Array.isArray(g)) {
      for (const x of g) {
        const id = str(x?.ID ?? x?.id ?? x?.stationID ?? x?.stationId ?? x);
        if (id) ids.push(id);
      }
    }
    return ids;
  };

  for (const it of all) {
    const cls = str(it?.Class);
    if (cls !== 'STB' && cls !== 'SBP') continue;

    const id =
      cls === 'SBP'
        ? str(
            it.staBuildingPointID ??
              it.staBuildingPointId ??
              it.stationID ??
              it.stationId ??
              it.staBuildingID ??
              it.staBuildingId ??
              it.ID ??
              it.id
          )
        : str(
            it.staBuildingID ??
              it.staBuildingId ??
              it.buildingID ??
              it.BuildingID ??
              it.buildingId ??
              it.ID ??
              it.id
          );
    if (!id) continue;

    const name =
      cls === 'SBP'
        ? str(
            it.staBuildingPointName ??
              it.stationName ??
              it.staBuildingName ??
              it.buildingName ??
              it.BuildingName ??
              it.name ??
              it.Name ??
              id
          )
        : str(
            it.staBuildingName ??
              it.buildingName ??
              it.BuildingName ??
              it.name ??
              it.Name ??
              id
          );

    const height = cls === 'STB' ? str(it.height ?? it.Height ?? '').trim() : '';
    const stationIds = parseStationsGroup(it);

    out.set(id, {
      id,
      kind: cls as 'STB' | 'SBP',
      name: name || id,
      height: height || undefined,
      stationIds,
    });
  }

  return out;
}

function addMapSet<K, V>(m: Map<K, Set<V>>, k: K, v: V) {
  let s = m.get(k);
  if (!s) {
    s = new Set<V>();
    m.set(k, s);
  }
  s.add(v);
}

function buildStationBuildingIndex(stas: Map<string, RailSta>, buildings: Map<string, RailBuilding>) {
  const stationToBuildings = new Map<string, Set<string>>();
  const buildingToStations = new Map<string, Set<string>>();

  // STA.STBuilding -> building
  for (const sta of stas.values()) {
    for (const b of sta.buildingIds) {
      if (!b) continue;
      addMapSet(stationToBuildings, sta.id, b);
      addMapSet(buildingToStations, b, sta.id);
    }
  }

  // STB/SBP.Stations group -> station
  for (const b of buildings.values()) {
    for (const sid of b.stationIds) {
      if (!sid) continue;
      addMapSet(buildingToStations, b.id, sid);
      addMapSet(stationToBuildings, sid, b.id);
    }
  }

  return { stationToBuildings, buildingToStations };
}

// ------------------------------
// Public API
// ------------------------------

export async function loadRailNewIndex(worldId: string): Promise<RailNewIndex> {
  const wid = normalizeWorldId(worldId);
  const cached = RAIL_INDEX_CACHE.get(wid);
  if (cached) return cached;

  const items = await loadRuleItems(wid);

  const stas = parseSta(items);
  const plfs = parsePlf(items);
  const rles = parseRle(items);
  const buildings = parseBuildings(items);
  const { stationToBuildings, buildingToStations } = buildStationBuildingIndex(stas, buildings);

  const idx: RailNewIndex = {
    worldId: wid,
    stas,
    plfs,
    rles,
    buildings,
    stationToBuildings,
    buildingToStations,
  };

  RAIL_INDEX_CACHE.set(wid, idx);
  return idx;
}
