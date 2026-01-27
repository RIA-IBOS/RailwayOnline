import type { FeatureStore } from './featureStore';
import type { FeatureRecord, RenderRule } from './renderRules';
import { DEFAULT_FLOOR_VIEW, fmtFloorLabel } from './ruleHelpers';

/**
 * 具体要素渲染规则（从 renderRules.ts 分离）。
 *
 * 注意：本文件只使用 type import，避免与 renderRules.ts 产生运行时循环依赖。
 */

function normalizeColor(c: any): string | null {
  const s = String(c ?? '').trim();
  if (!s) return null;
  if (s.startsWith('#')) return s;
  // 6位HEX：补 #
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s}`;
  return s; // 其他情况原样返回（例如 'red' / 'rgba(...)'）
}

function getFirstLineIdFromPlatformFi(fi: any): string | null {
  const arr = (fi as any)?.lines;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const id = String(arr[0]?.ID ?? arr[0]?.LineID ?? arr[0]?.id ?? '').trim();
  return id || null;
}

function getLineColorByLineId(lineId: string, store: FeatureStore): string | null {
  const id = String(lineId ?? '').trim();
  if (!id) return null;

  // 1) 优先：FeatureStore 若有 lineColorIndex（你 v3 方案里是 public 字段）
  const idx = (store as any)?.lineColorIndex as Record<string, string> | undefined;
  const c1 = idx?.[id];
  const n1 = normalizeColor(c1);
  if (n1) return n1;

  // 2) 兜底：若 store 有 all（v3 里有），线性扫 RLE 找 LineID/ID 对应的 color
  const all = (store as any)?.all as any[] | undefined;
  if (Array.isArray(all)) {
    for (const r of all) {
      const fid = String((r?.featureInfo as any)?.LineID ?? (r?.featureInfo as any)?.ID ?? '').trim();
      if (fid !== id) continue;
      const cc = String((r?.featureInfo as any)?.color ?? (r?.featureInfo as any)?.Color ?? '').trim();
      const nn = normalizeColor(cc);
      if (nn) return nn;
    }
  }

  return null;
}

function getPlatformPointColor(r: FeatureRecord, store: FeatureStore): string | null {
  const lineId = getFirstLineIdFromPlatformFi(r.featureInfo);
  if (!lineId) return null;
  return getLineColorByLineId(lineId, store);
}

function getStationPointColorFromPlatforms(sta: FeatureRecord, store: FeatureStore): string | null {
  const pArr = (sta.featureInfo as any)?.platforms;
  if (!Array.isArray(pArr) || pArr.length === 0) return null;

  const pid = String(pArr[0]?.ID ?? pArr[0]?.platformID ?? '').trim();
  if (!pid) return null;

  // 1) 优先：store.byClassId['PLF'][pid][0]
  const byClassId = (store as any)?.byClassId as Record<string, Record<string, FeatureRecord[]>> | undefined;
  const hit = byClassId?.['PLF']?.[pid]?.[0];
  if (hit) return getPlatformPointColor(hit, store);

  // 2) 兜底：线性扫找平台
  const all = (store as any)?.all as FeatureRecord[] | undefined;
  if (Array.isArray(all)) {
    for (const r of all) {
      if (r?.meta?.Class !== 'PLF') continue;
      if (String(r?.meta?.idValue ?? '').trim() !== pid) continue;
      return getPlatformPointColor(r, store);
    }
  }

  return null;
}

// ------------------------------
// STA/PLF 点位重合索引（用于“重合排除/兜底显示”）
// - 以 XZ 为主判断重合（2D 地图视觉上重合即可）
// - 对浮点做轻微 round，避免误差导致 key 不一致
// ------------------------------

type StaPlfPointIndex = {
  staKeys: Set<string>;
  /** 仅统计 Connect !== false 的 PLF，用于“STA 在高 zoom 的兜底显示” */
  plfConnectKeys: Set<string>;
};

const __staPlfIndexCache = new WeakMap<FeatureStore, StaPlfPointIndex>();

function roundCoord(n: number, prec = 1000) {
  // prec=1000 => 0.001 精度
  return Math.round(n * prec) / prec;
}

function pointKeyXZ(p3?: { x: number; y: number; z: number }): string | null {
  if (!p3) return null;
  const x = roundCoord(Number(p3.x));
  const z = roundCoord(Number(p3.z));
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return `${x},${z}`;
}

function getStaPlfPointIndex(store: FeatureStore): StaPlfPointIndex {
  const cached = __staPlfIndexCache.get(store);
  if (cached) return cached;

  const staKeys = new Set<string>();
  const plfConnectKeys = new Set<string>();

  const sta = store.byClass['STA'] ?? [];
  for (const r of sta) {
    const k = pointKeyXZ(r.p3);
    if (k) staKeys.add(k);
  }

  const plf = store.byClass['PLF'] ?? [];
  for (const r of plf) {
    const k = pointKeyXZ(r.p3);
    if (!k) continue;

    const connect = (r.featureInfo as any)?.Connect;
    if (connect !== false) plfConnectKeys.add(k);
  }

  const idx: StaPlfPointIndex = { staKeys, plfConnectKeys };
  __staPlfIndexCache.set(store, idx);
  return idx;
}

// ------------------------------
// 通用：点集包含（忽略顺序）+ 全局互斥选择
// 用途：在 zoom>=阈值 时，让两类要素“二选一”显示
// 规则：只要 overlay 存在任意一条“不被 base 包含”，则选择 overlay（隐藏 base）；否则选择 base（隐藏 overlay）
// ------------------------------

type Coord3 = { x: number; y: number; z: number };

function __roundN(n: number, prec = 1000) {
  // 0.001 精度（可按需调）
  return Math.round(n * prec) / prec;
}

function __coordKeyXZ(p: { x: number; z: number }, prec = 1000): string | null {
  const x = __roundN(Number(p.x), prec);
  const z = __roundN(Number(p.z), prec);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return `${x},${z}`;
}

/** polyline 的控制点 -> “去重 + 排序”的 key 列表（忽略顺序） */
function __polyPointKeyListXZ(coords3?: Coord3[], prec = 1000): string[] | null {
  if (!coords3 || coords3.length < 2) return null;

  const set = new Set<string>();
  for (const p of coords3) {
    const k = __coordKeyXZ({ x: p.x, z: p.z }, prec);
    if (!k) return null;
    set.add(k);
  }
  const arr = Array.from(set);
  arr.sort();
  return arr;
}

/** a ⊆ b（aKeys/bKeys 为排序数组） */
function __isSubsetSortedKeys(aKeys: string[], bKeys: string[]): boolean {
  let i = 0, j = 0;
  while (i < aKeys.length && j < bKeys.length) {
    const a = aKeys[i];
    const b = bKeys[j];
    if (a === b) { i++; j++; continue; }
    if (a > b) { j++; continue; }  // b 追赶
    return false;                  // a < b => b 缺少 a
  }
  return i === aKeys.length;
}

/**
 * 全局互斥选择：
 * - overlay 中只要存在任意一条“不被任何 base 包含”，则选择 overlay
 * - 否则选择 base
 */
function chooseExclusiveByContainment(
  baseKeyLists: string[][],
  overlayKeyLists: string[][],
): 'base' | 'overlay' {
  if (overlayKeyLists.length === 0) return 'base';
  if (baseKeyLists.length === 0) return 'overlay';

  const overlayHasUncontained = overlayKeyLists.some(ok => !baseKeyLists.some(bk => __isSubsetSortedKeys(ok, bk)));
  return overlayHasUncontained ? 'overlay' : 'base';
}

// ------------------------------
// RLE 专用：zoom>=6 时，决定显示 dir3 还是显示 alt(0/1/2/4)
// ------------------------------

type RleExclusiveChoice = { choice: 'dir3' | 'alt' };
const __rleChoiceCache = new WeakMap<FeatureStore, RleExclusiveChoice>();

function getRleExclusiveChoice(store: FeatureStore): RleExclusiveChoice {
  const cached = __rleChoiceCache.get(store);
  if (cached) return cached;

  const rles = store.byClass['RLE'] ?? [];

  const dir3Keys: string[][] = [];
  const altKeys: string[][] = [];

  for (const r of rles) {
    if (r.type !== 'Polyline') continue;

    const raw = (r.featureInfo as any)?.direction;
    const dir = raw === '' || raw === null || raw === undefined ? NaN : Number(raw);

    const keys = __polyPointKeyListXZ(r.coords3);
    if (!keys) continue;

    if (dir === 3) dir3Keys.push(keys);
    else if (dir === 0 || dir === 1 || dir === 2 || dir === 4) altKeys.push(keys);
  }

  const pick = chooseExclusiveByContainment(dir3Keys, altKeys);
  const choice: RleExclusiveChoice = { choice: pick === 'base' ? 'dir3' : 'alt' };
  __rleChoiceCache.set(store, choice);
  return choice;
}



export const FEATURE_RENDER_RULES: RenderRule[] = [
  // ------------------------------------------------------------------
  // (1) 铁路 RLE：direction 缩放控制 + 沿线 label
  // - direction=3：zoomLevel 0..99 都显示
  // - direction=0/1/2/4：仅 zoomLevel>=5 显示
  // (2) label：附着在铁路线上（依赖 RuleDrivenLayer.tsx 的 Polyline label 补丁）
  // ------------------------------------------------------------------
  {
    name: '铁路 RLE：direction 缩放控制',
    match: { Class: 'RLE', Type: 'Polyline' },
    zoom: [0, 99],
visible: (r, ctx, store) => {
  const raw = (r.featureInfo as any)?.direction;
  const dir = raw === '' || raw === null || raw === undefined ? NaN : Number(raw);

  // zoom < 6：只显示展示线 dir=3
  if (ctx.zoomLevel < 6) return dir === 3;

  // zoom >= 6：进入互斥选择
  const choice = getRleExclusiveChoice(store).choice;

  if (choice === 'dir3') {
    // 只有当“所有 alt 都能被某条 dir3 包含”时，才显示 dir3，alt 全隐藏
    return dir === 3;
  } else {
    // 只要存在任意 alt 不被包含，则 dir3 全隐藏，显示 alt
    return dir === 0 || dir === 1 || dir === 2 || dir === 4;
  }
},

    symbol: {
      pathStyle: (r) => {
        const c = normalizeColor((r.featureInfo as any)?.color) ?? '#111827';
        return {
          color: c,
          opacity: 0.9,
          weight: 3,
        };
      },
label: {
  enabled: true,
  minLevel: 5,
  placement: 'center',
        textFrom: (r) => {
          return (
            String((r.featureInfo as any)?.LineName ?? '').trim() ||
            String((r.featureInfo as any)?.LineID ?? '').trim()
          );
        },
  offsetY: 10,
  withDot: true,
  declutter: {
    priority: 10,
    minSpacingPx: 6,
    candidates: ['N', 'NE', 'NW', 'E', 'W', 'SE', 'SW', 'S'],
    allowHide: true,
    allowAbbrev: true,
    abbrev: (s) => (s.length > 6 ? s.slice(0, 6) + '…' : s),
  },
},
    labelClick: {
      enabled: true,
      mode: 'normal',
      openCard: true,
      // 与导航 RouteHighlightLayer 保持一致：白色描边 + 主色加粗
      highlightStyleKey: 'nav-outline',
        // 新增：几何点击开关（按要素自由组合）
  geom: {
    point: true, // 点要素本体可点击
  },

    },
    },
  },

  // ------------------------------------------------------------------
  // (3) 站台轮廓 PFB：按关联线路色渲染（补 #）
  // ------------------------------------------------------------------
  {
    name: '站台轮廓 PFB：按线路色渲染（补#）',
    match: { Class: 'PFB', Type: 'Polygon' },
    zoom: [5, 99],
    symbol: {
      pathStyle: (r, _ctx, store) => {
        const c = normalizeColor(store.findRelatedLineColor(r)) ?? '#2563eb';
        return {
          color: c,
          opacity: 0.95,
          weight: 0,
          fillColor: c,
          fillOpacity: 0.22,
        };
      },
    },
  },

  // ------------------------------------------------------------------
  // (4) 车站建筑 STB：
  // - zoomLevel<4：仅显示“中心点+label”（这里用 label 自带 dot 的方式实现）
  // - zoomLevel>=4：完全不显示（由于 findFirstRule 机制，直接用 zoom=[0,3] 即可）
  // - 且仅当 Stations.length>=2 才显示
  // ------------------------------------------------------------------
{
  name: '车站建筑 STB：zoom<4 中心点+label（Stations>=2）；zoom>=4 显示面；楼层视角激活建筑变淡',
  match: { Class: 'STB', Type: 'Polygon' },
  zoom: [0, 99],
  symbol: {
    pathStyle: (r, ctx) => {
      // zoom<4：不画面（只留 label+dot）
      if (ctx.zoomLevel < 4) return { opacity: 0, fillOpacity: 0, weight: 0 };

      const base: L.PathOptions = {
        color: '#111827',
        opacity: 0.2,
        weight: 2,
        fillColor: '#9ca3af',
        fillOpacity: 0.05,
      };

      // 楼层视角：激活建筑变淡
      if (ctx.inFloorView && ctx.activeBuildingUid && ctx.activeBuildingUid === r.uid) {
        return { ...base, opacity: 0.25, fillOpacity: 0.06 };
      }
      return base;
    },
label: {
  enabled: true,
  minLevel: 0,
  placement: 'center',
      textFrom: (r, ctx) => {
        // zoom>=4：不显示中心点 label
        if (ctx.zoomLevel >= 4) return '';

        // zoom<4：仅 Stations>=2 才显示
        const stations = (r.featureInfo as any)?.Stations;
        const n = Array.isArray(stations) ? stations.length : 0;
        if (n < 2) return '';

        return String((r.featureInfo as any)?.staBuildingName ?? '').trim();
      },
  offsetY: 10,
  withDot: true,
  declutter: {
    priority: 10,
    minSpacingPx: 6,
    candidates: ['N', 'NE', 'NW', 'E', 'W', 'SE', 'SW', 'S'],
    allowHide: true,
    allowAbbrev: true,
    abbrev: (s) => (s.length > 6 ? s.slice(0, 6) + '…' : s),
  },
  
},
    labelClick: {
      enabled: true,
      mode: 'normal',
      openCard: true,
        // 新增：几何点击开关（按要素自由组合）
  geom: {
    point: true, // 点要素本体可点击
  },

    },

  },
},




  // ------------------------------------------------------------------
  // (4.5) 建筑 BUD：
  // - zoomLevel<4：仅显示“中心点+label”
  // - zoomLevel>=4：显示面
  // - 楼层视角激活建筑变淡（与 STB 一致）
  // ------------------------------------------------------------------
  {
    name: '建筑 BUD：zoom<4 中心点+label；zoom>=4 显示面；楼层视角激活建筑变淡',
    match: { Class: 'BUD', Type: 'Polygon' },
    zoom: [0, 99],
    symbol: {
      pathStyle: (r, ctx) => {
        // zoom<4：不画面（只留 label+dot）
        if (ctx.zoomLevel < 4) return { opacity: 0, fillOpacity: 0, weight: 0 };

        const base: L.PathOptions = {
          color: '#111827',
          opacity: 0.2,
          weight: 2,
          fillColor: '#9ca3af',
          fillOpacity: 0.05,
        };

        // 楼层视角：激活建筑变淡
        if (ctx.inFloorView && ctx.activeBuildingUid && ctx.activeBuildingUid === r.uid) {
          return { ...base, opacity: 0.25, fillOpacity: 0.06 };
        }
        return base;
      },
      label: {
        enabled: true,
        minLevel: 0,
        placement: 'center',
        textFrom: (r, ctx) => {
          if (ctx.zoomLevel >= 4) return '';
          return String((r.featureInfo as any)?.BuildingName ?? '').trim();
        },
        offsetY: 10,
        withDot: true,
        declutter: {
          priority: 10,
          minSpacingPx: 6,
          candidates: ['N', 'NE', 'NW', 'E', 'W', 'SE', 'SW', 'S'],
          allowHide: true,
          allowAbbrev: true,
          abbrev: (s) => (s.length > 6 ? s.slice(0, 6) + '…' : s),
        },
      },
    },
  },

  // (5) 车站点 STA：
  // - zoomLevel<4：不显示
  // - zoomLevel 4..6：显示固定图标
  // - zoomLevel>6：不显示（由 findFirstRule + zoom 裁剪自然实现）
  // ------------------------------------------------------------------

{
  name: '车站点 STA：zoom 4-5 正常显示；zoom>=6 若与可显示 PLF 重合则兜底显示',
  match: { Class: 'STA', Type: 'Points' },
  zoom: [4, 99],
  visible: (r, ctx, store) => {
    // zoom 4-5：保持原逻辑（正常显示）
    if (ctx.zoomLevel >= 4 && ctx.zoomLevel <= 7) return true;

    // zoom>=6：仅当“该 STA 与 Connect!==false 的 PLF 坐标重合”时显示
    if (ctx.zoomLevel >= 6) {
      const idx = getStaPlfPointIndex(store);
      const k = pointKeyXZ(r.p3);
      return !!k && idx.plfConnectKeys.has(k);
    }

    return false;
  },
  symbol: {

    pane: 'ria-point-top',
    point: (r, ctx, store) => {
      void ctx;

      const c = getStationPointColorFromPlatforms(r, store) ?? '#0ea5e9';
      return {
        kind: 'circle',
        radius: 4,
        style: {
          color: '#111827',
          opacity: 0.9,
          weight: 2,
          fillColor: c,
          fillOpacity: 0.85,
        },
      };
    },
    label: {
      enabled: true,
      minLevel: 4,
      placement: 'center',
      textFrom: (r) => String((r.featureInfo as any)?.stationName ?? '').trim(),
      offsetY: 0,
      withDot: false,
      declutter: {
        priority: 10,
        minSpacingPx: 6,
        candidates: ['N', 'NE', 'NW', 'E', 'W', 'SE', 'SW', 'S'],
        allowHide: true,
        allowAbbrev: true,
        abbrev: (s) => (s.length > 6 ? s.slice(0, 6) + '…' : s),
      },
    },
    // Google Map 风格：仅 label 可交互；点击后显示图钉，并触发通用卡片
    labelClick: {
      enabled: true,
      mode: 'normal',
      openCard: true,
        // 新增：几何点击开关（按要素自由组合）
  geom: {
    point: true, // 点要素本体可点击
  },

    },

  },
},

  // ------------------------------------------------------------------
  // (6) 站台点 PLF：
  // - zoomLevel<6：不显示
  // - zoomLevel>=6：显示固定图标
  // ------------------------------------------------------------------
{
  name: '站台点 PLF：zoom>=6 点颜色读取所属第一个线路 color',
  match: { Class: 'PLF', Type: 'Points' },
  zoom: [8, 99],
  visible: (r, _ctx, store) => {
  // 1) Connect=false 永不显示
  const connect = (r.featureInfo as any)?.Connect;
  if (connect === false) return false;

  // 2) 与 STA 坐标重合则 PLF 不显示（地理关系排除）
  const idx = getStaPlfPointIndex(store);
  const k = pointKeyXZ(r.p3);
  if (k && idx.staKeys.has(k)) return false;

  return true;
},
  symbol: {
    pane: 'ria-point-top',
    point: (r, ctx, store) => {
      void ctx;

      const c = getPlatformPointColor(r, store) ?? '#0ea5e9';
      return {
        kind: 'circle',
        radius: 4,
        style: {
          color: '#111827',
          opacity: 0.9,
          weight: 2,
          fillColor: c,     
          fillOpacity: 0.85,
        },
      };
    },
label: {
  enabled: true,
  minLevel: 8, 
  placement: 'near',
  textFrom: (r) => String((r.featureInfo as any)?.platformName ?? '').trim(),
  offsetY: 10,
  withDot: true,
  declutter: {
    priority: 10,
    minSpacingPx: 6,
    candidates: ['N', 'NE', 'NW', 'E', 'W', 'SE', 'SW', 'S'],
    allowHide: true,
    // 可选：放不下时缩略
    allowAbbrev: true,
    abbrev: (s) => (s.length > 6 ? s.slice(0, 6) + '…' : s),
  },
},
    labelClick: {
      enabled: true,
      mode: 'normal',
      openCard: true,
        // 新增：几何点击开关（按要素自由组合）
  geom: {
    point: true, // 点要素本体可点击
  },

    },

  },
},

  // ------------------------------
  // 楼层（STF）
  // ------------------------------
  {
    name: '楼层 STF：楼层视角下按 NofFloor 选择（同 NofFloor 允许多面同时显示）',
    match: { Class: DEFAULT_FLOOR_VIEW.floorClass, Type: 'Polygon' },
    zoom: [DEFAULT_FLOOR_VIEW.minLevel, 99],
    visible: (r, ctx) => {
      if (!ctx.inFloorView) return false;
      if (!ctx.activeFloorSelector) return false;

      // 必须属于当前激活建筑的 Floors 引用集合
      const ref = String((r.featureInfo as any)?.[DEFAULT_FLOOR_VIEW.floorRefTargetField] ?? '').trim();
      if (ctx.activeBuildingFloorRefSet && ref) {
        if (!ctx.activeBuildingFloorRefSet.has(ref)) return false;
      }

      // 使用 floorSelectorField（NofFloor）匹配
      const selector = String((r.featureInfo as any)?.[DEFAULT_FLOOR_VIEW.floorSelectorField] ?? '').trim();
      return selector === String(ctx.activeFloorSelector).trim();
    },
    symbol: {
      pathStyle: (r, ctx, store) => {
        void ctx;
        // 楼层用轻量颜色，支持关联线路色（如果有）
        const c = store.findRelatedLineColor(r) ?? '#4b5563';
        return {
          color: c,
          opacity: 0.85,
          weight: 2,
          fillColor: c,
          fillOpacity: 0.28,
        };
      },
      label: {
        enabled: true,
        placement: 'center',
        textFrom: (r) => {
          const name = String((r.featureInfo as any)?.staBFloorName ?? '').trim();
          if (name) return name;
          return fmtFloorLabel((r.featureInfo as any)?.[DEFAULT_FLOOR_VIEW.floorSelectorField]);
        },
        minLevel: DEFAULT_FLOOR_VIEW.minLevel,
      },
    },
  },





  // ------------------------------
  // 楼层（FLR）
  // ------------------------------
  {
    name: '楼层 FLR：楼层视角下按 NofFloor 选择（兼容 STF/FLR 上行索引）',
    match: { Class: 'FLR', Type: 'Polygon' },
    zoom: [DEFAULT_FLOOR_VIEW.minLevel, 99],
    visible: (r, ctx) => {
      if (!ctx.inFloorView) return false;
      if (!ctx.activeFloorSelector) return false;

      // 必须属于当前激活建筑的楼层集合（FloorID）
      const ref = String((r.featureInfo as any)?.FloorID ?? (r.featureInfo as any)?.ID ?? '').trim();
      if (ctx.activeBuildingFloorRefSet && ref) {
        if (!ctx.activeBuildingFloorRefSet.has(ref)) return false;
      }

      const selector = String((r.featureInfo as any)?.[DEFAULT_FLOOR_VIEW.floorSelectorField] ?? '').trim();
      return selector === String(ctx.activeFloorSelector).trim();
    },
    symbol: {
      pathStyle: (r, ctx, store) => {
        void ctx;
        const c = store.findRelatedLineColor(r) ?? '#4b5563';
        return {
          color: c,
          opacity: 0.85,
          weight: 2,
          fillColor: c,
          fillOpacity: 0.28,
        };
      },
      label: {
        enabled: true,
        placement: 'center',
        textFrom: (r) => {
          const name = String((r.featureInfo as any)?.FloorName ?? '').trim();
          if (name) return name;
          return fmtFloorLabel((r.featureInfo as any)?.[DEFAULT_FLOOR_VIEW.floorSelectorField]);
        },
        minLevel: DEFAULT_FLOOR_VIEW.minLevel,
      },
    },
  },

  // 车站建筑点（示例：SBP）
  // - 展示外部图标
  // - 若同 idValue 的 STB 存在，则不渲染 SBP（示例：“若xxx存在则不渲染xxx”）
  // ------------------------------
  {
    name: '车站建筑点 SBP：外部图标 + 存在性隐藏（示例，可按需改写）',
    match: { Class: 'SBP', Type: 'Points' },
    zoom: [0, 99],
    hideIfSameIdExistsInClasses: ['STB'],
    symbol: {
      point: {
        pane: 'ria-point-top',
        kind: 'icon',
        iconUrlFrom: 'iconUrl',
        iconSize: [24, 24],
        iconAnchor: [12, 24],
      },
      label: {
        enabled: true,
        placement: 'near',
        minLevel: 6,
        textFrom: (r) => String((r.featureInfo as any)?.staBuildingPointName ?? (r.featureInfo as any)?.staBuildingName ?? (r.featureInfo as any)?.stationName ?? '').trim(),
      },
    },
  },

  // ------------------------------


  // ------------------------------
  // 地物点 ISP
  // ------------------------------
  {
    name: '地物点 ISP：圆点 + label',
    match: { Class: 'ISP', Type: 'Points' },
    zoom: [0, 99],
    symbol: {
      point: {
        pane: 'ria-point-top',
        kind: 'circle',
        radius: 4,
        style: {
          color: '#111827',
          opacity: 0.9,
          weight: 2,
          fillColor: '#f97316',
          fillOpacity: 0.75,
        },
      },
      label: {
        enabled: true,
        styleKey: 'gm-outline',
        minLevel: 4,
        placement: 'center',
        textFrom: (r) => String((r.featureInfo as any)?.PointName ?? '').trim(),
        offsetY: 0,
        withDot: false,
        declutter: {
          priority: 10,
          minSpacingPx: 6,
          candidates: ['N', 'NE', 'NW', 'E', 'W', 'SE', 'SW', 'S'],
          allowHide: true,
          allowAbbrev: true,
          abbrev: (s) => (s.length > 10 ? s.slice(0, 10) + '…' : s),
        },
      },
      labelClick: { enabled: true, mode: 'labelOnly', labelStyleKey: 'gm-outline', pointPinStyleKey: 'pin-red', openCard: true },
    },
  },

  // ------------------------------
  // 地物线 ISL
  // ------------------------------
  {
    name: '地物线 ISL：线 + label',
    match: { Class: 'ISL', Type: 'Polyline' },
    zoom: [0, 99],
    symbol: {
      pathStyle: { color: '#111827', opacity: 0.85, weight: 1 },
      label: {
        enabled: true,
        styleKey: 'gm-outline',
        placement: 'center',
        minLevel: 0,
        textFrom: (r) => String((r.featureInfo as any)?.PLineName ?? '').trim(),
        declutter: {
          priority: 10,
          minSpacingPx: 6,
          candidates: ['N', 'NE', 'NW', 'E', 'W', 'SE', 'SW', 'S'],
          allowHide: true,
          allowAbbrev: true,
          abbrev: (s) => (s.length > 10 ? s.slice(0, 10) + '…' : s),
        },
      },
      labelClick: { enabled: true, mode: 'labelOnly', labelStyleKey: 'gm-outline', highlightStyleKey: 'dash', openCard: true },
    },
  },

  // ------------------------------
  // 地物面 ISG
  // ------------------------------
  {
    name: '地物面 ISG：面 + label',
    match: { Class: 'ISG', Type: 'Polygon' },
    zoom: [0, 99],
    // 字段解析接口：Kind / SKind / SKind2 的组合（用于对“通用要素集”的子类细分）
    // - 约定优先读取 featureInfo.PGonKind / PGonSKind / PGonSKind2
    // - 允许从 tags.* 兜底（便于后续扩展/兼容旧数据）
    visible: (r, ctx) => {
      const fi: any = r.featureInfo ?? {};
      const tags: any = fi.tags ?? fi.Tags ?? {};
      const kind = String(fi.PGonKind ?? fi.Kind ?? tags.PGonKind ?? tags.Kind ?? '').trim();
      const skind = String(fi.PGonSKind ?? fi.SKind ?? tags.PGonSKind ?? tags.SKind ?? '').trim();
      const sk2 = String(fi.PGonSKind2 ?? fi.SKind2 ?? tags.PGonSKind2 ?? tags.SKind2 ?? '').trim();

      const zoom = Number(ctx.zoomLevel ?? 0);
      const isNGF_LAD = kind === 'NGF' && skind === 'LAD';
      const isNGF_WTB = kind === 'NGF' && skind === 'WTB';
      const isADM_DBZ = kind === 'ADM' && skind === 'DBZ';
      const isADM_PLZ = kind === 'ADM' && skind === 'PLZ';

      if (isNGF_LAD) {
        if (sk2 === 'CON') return zoom <= 4;
        if (sk2 === 'PEN' || sk2 === 'ISD' || sk2 === 'IST') return zoom > 2;
        // 未定义 SKind2：默认按“大于4显示”处理，避免低缩放过密；后续可按需要细分。
        return zoom > 4;
      }

      if (isNGF_WTB) {
        if (sk2 === 'SEA') return zoom < 4;
        return zoom > 4;
      }

      if (isADM_DBZ || isADM_PLZ) {
        if (sk2 === 'L1') return zoom > 3 && zoom < 5;
        if (sk2 === 'L2') return zoom > 5 && zoom < 7;
        if (sk2 === 'L3') return zoom > 7 && zoom < 9;
        return false;
      }

      return true;
    },
    symbol: {
      pathStyle: { color: '#111827', opacity: 0.65, weight: 1, fillColor: '#60a5fa', fillOpacity: 0.10 },
      // label 允许动态返回 styleKey / minLevel（避免因 findFirstRule 的“单规则”机制导致无法细分子类样式）
      label: (r) => {
        const fi: any = r.featureInfo ?? {};
        const tags: any = fi.tags ?? fi.Tags ?? {};
        const kind = String(fi.PGonKind ?? fi.Kind ?? tags.PGonKind ?? tags.Kind ?? '').trim();
        const skind = String(fi.PGonSKind ?? fi.SKind ?? tags.PGonSKind ?? tags.SKind ?? '').trim();

        const isNGF_LAD = kind === 'NGF' && skind === 'LAD';
        const isNGF_WTB = kind === 'NGF' && skind === 'WTB';
        const isADM_DBZ = kind === 'ADM' && skind === 'DBZ';
        const isADM_PLZ = kind === 'ADM' && skind === 'PLZ';

        const styleKey = isNGF_LAD ? 'gm-bw-15' : isNGF_WTB ? 'gm-wtb-15' : (isADM_DBZ || isADM_PLZ) ? 'gm-bw-9' : 'gm-outline';
        const minLevel = (isADM_DBZ || isADM_PLZ) ? 0 : (isNGF_LAD || isNGF_WTB) ? 0 : 2;

        return {
          enabled: true,
          styleKey: styleKey as any,
          placement: 'center',
          minLevel,
          textFrom: (rr) => String((rr.featureInfo as any)?.PGonName ?? '').trim(),
          declutter: {
            priority: 10,
            minSpacingPx: 6,
            candidates: ['N', 'NE', 'NW', 'E', 'W', 'SE', 'SW', 'S'],
            allowHide: true,
            allowAbbrev: true,
            abbrev: (s) => (s.length > 10 ? s.slice(0, 10) + '…' : s),
          },
        };
      },
      labelClick: (r) => {
        const fi: any = r.featureInfo ?? {};
        const tags: any = fi.tags ?? fi.Tags ?? {};
        const kind = String(fi.PGonKind ?? fi.Kind ?? tags.PGonKind ?? tags.Kind ?? '').trim();
        const skind = String(fi.PGonSKind ?? fi.SKind ?? tags.PGonSKind ?? tags.SKind ?? '').trim();

        const isNGF_LAD = kind === 'NGF' && skind === 'LAD';
        const isNGF_WTB = kind === 'NGF' && skind === 'WTB';
        const isADM_DBZ = kind === 'ADM' && skind === 'DBZ';
        const isADM_PLZ = kind === 'ADM' && skind === 'PLZ';

        const labelStyleKey = isNGF_LAD ? 'gm-bw-15' : isNGF_WTB ? 'gm-wtb-15' : (isADM_DBZ || isADM_PLZ) ? 'gm-bw-9' : 'gm-outline';
        return { enabled: true, mode: 'labelOnly', labelStyleKey: labelStyleKey as any, highlightStyleKey: 'dash', openCard: true };
      },
    },
  },

  // 点要素：外部图标 + label（示例）
  // ------------------------------
  {
    name: '点要素（示例）：若 featureInfo.iconUrl 存在则使用外部图标，并在附近显示 name label',
    match: { Type: 'Points' },
    zoom: [0, 99],
    symbol: {
      point: (r) => {
        const url = String((r.featureInfo as any)?.iconUrl ?? '').trim();
        if (url) {
          return {
            kind: 'icon',
            iconUrl: url,
            iconSize: [24, 24],
            iconAnchor: [12, 24],
          };
        }
        return {
          kind: 'circle',
          radius: 5,
          style: { color: '#111827', opacity: 0.9, weight: 2, fillColor: '#f97316', fillOpacity: 0.6 },
        };
      },
      label: {
        enabled: true,
        placement: 'near',
        minLevel: 6,
        textFrom: (r) => String((r.featureInfo as any)?.name ?? (r.featureInfo as any)?.staName ?? '').trim(),
      },
    },
  },

  // ------------------------------
  // 通用 fallback：线/面
  // ------------------------------
  {
    name: '通用：Polyline 默认样式',
    match: { Type: 'Polyline' },
    zoom: [0, 99],
    symbol: {
      pathStyle: { color: '#111827', opacity: 0.85, weight: 3 },
    },
  },
  {
    name: '通用：Polygon 默认样式',
    match: { Type: 'Polygon' },
    zoom: [0, 99],
    symbol: {
      pathStyle: { color: '#111827', opacity: 0.85, weight: 2, fillColor: '#60a5fa', fillOpacity: 0.08 },
    },
  },
];
