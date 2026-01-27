import type { FeatureRecord } from '../renderRules';
import { getValueByPath } from '../renderRules';
import { extractKindTriplet } from './pictureRules';
// 使用相对路径，避免不同构建环境下 @ 别名解析差异导致 TS2307。
import { passLineBooleanFilters, type RailNewIndex } from '../../Navigation/railNewIndex';
import type { CardInteractiveValue } from './cardInteractions';
import { makeExternalLink, makeFeatureLink } from './cardInteractions';

export type CardColorChip = {
  kind: 'colorChip';
  color: string; // "#RRGGBB" 或其他 css color
  text: string; // 显示文本，如 "#FFD200"
};

export type CardLineChips = {
  kind: 'lineChips';
  items: Array<{ name: string; color: string; text?: string }>;
};

export type CardRichValue = CardColorChip | CardLineChips | CardInteractiveValue;

export type CardRow = {
  label: string;
  value: any;
  usedPaths?: string[];
};

export type FieldRule = {
  name: string;
  match: { Kind?: string; SKind?: string; SKind2?: string };
  rows: (feature: FeatureRecord, railIndex?: RailNewIndex | null) => CardRow[];
};

function pickFirstString(fi: any, candidates: string[]): string {
  for (const k of candidates) {
    const s = String(fi?.[k] ?? '').trim();
    if (s) return s;
  }
  return '';
}

function ensureKnown(v: any): string {
  const s = String(v ?? '').trim();
  return s ? s : '未知';
}

function normalizeHexColor(v: any): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^#([0-9a-fA-F]{6})$/.test(s)) return s;
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s}`;
  if (/^#([0-9a-fA-F]{3})$/.test(s)) {
    const m = s.slice(1);
    return `#${m[0]}${m[0]}${m[1]}${m[1]}${m[2]}${m[2]}`;
  }
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
  }
  return s;
}


// ===== 线路 chips item 类型（供去重/合并使用） =====
type LineChipItem = { name: string; color: string; text: string };

// ===== 合并“xxx-上行/xxx-下行”（同 base 且同色号） =====
// 规则：若同时存在 xxx-上行 与 xxx-下行 且色号一致，则仅展示一个 xxx；否则原样保留
function mergeUpDownSameColorLines(items: LineChipItem[]): LineChipItem[] {
  const parseUpDown = (name: string): { base: string; dir: 'up' | 'down' } | null => {
    const s = String(name ?? '').trim();
    if (!s) return null;
    const m = /^(.*?)(?:[-_\uFF0D\u2014\u2013])?(上行|下行)$/.exec(s);
    if (!m) return null;
    const base = String(m[1] ?? '').trim();
    const dir = m[2] === '上行' ? 'up' : 'down';
    if (!base) return null;
    return { base, dir };
  };

  // 统计 (base,color) 是否同时有上/下行
  const has = new Map<string, { up: boolean; down: boolean }>();
  for (const it of items) {
    const p = parseUpDown(it.name);
    if (!p) continue;
    const key = `${p.base}@@${it.color}`;
    const prev = has.get(key) ?? { up: false, down: false };
    if (p.dir === 'up') prev.up = true;
    else prev.down = true;
    has.set(key, prev);
  }

  // 保序输出：满足 up&down 的组只输出一次 base
  const emitted = new Set<string>();
  const out: LineChipItem[] = [];
  for (const it of items) {
    const p = parseUpDown(it.name);
    if (!p) {
      out.push(it);
      continue;
    }
    const key = `${p.base}@@${it.color}`;
    const st = has.get(key);
    if (st?.up && st?.down) {
      if (emitted.has(key)) continue;
      emitted.add(key);
      out.push({ name: p.base, color: it.color, text: it.text });
      continue;
    }
    out.push(it);
  }
  return out;
}

function listTopKeys(fi: any): string[] {
  return Object.keys(fi ?? {});
}
function shouldSkipDefaultKey(k: string): boolean {
  const banned = new Set(['Conpoints', 'Flrpoints', 'PLpoints', 'Linepoints', 'coordinate']);
  return banned.has(k);
}
function isPlainObject(v: any): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function flattenRemainingRows(feature: FeatureRecord, used: Set<string>): CardRow[] {
  const fi: any = feature?.featureInfo ?? {};
  const out: CardRow[] = [];

  const maxDepth = 3;
  const maxArrayLen = 50;

  const walk = (node: any, prefix: string, depth: number) => {
    if (depth > maxDepth) {
      if (prefix && !used.has(prefix)) out.push({ label: prefix, value: node, usedPaths: [prefix] });
      return;
    }

    if (node === null || node === undefined) {
      if (prefix && !used.has(prefix)) out.push({ label: prefix, value: node, usedPaths: [prefix] });
      return;
    }

    if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
      if (prefix && !used.has(prefix)) out.push({ label: prefix, value: node, usedPaths: [prefix] });
      return;
    }

    if (Array.isArray(node)) {
      const topKey = prefix.split('.')[0] || prefix;
      if (shouldSkipDefaultKey(topKey)) return;

      if (node.length > maxArrayLen) {
        if (prefix && !used.has(prefix))
          out.push({ label: prefix, value: `[Array(${node.length})]`, usedPaths: [prefix] });
        return;
      }

      if (prefix && !used.has(prefix)) out.push({ label: prefix, value: node, usedPaths: [prefix] });
      return;
    }

    if (isPlainObject(node)) {
      const keys = Object.keys(node);
      if (keys.length === 0) {
        if (prefix && !used.has(prefix)) out.push({ label: prefix, value: node, usedPaths: [prefix] });
        return;
      }
      for (const k of keys) {
        const p = prefix ? `${prefix}.${k}` : k;
        const topKey = p.split('.')[0] || p;
        if (shouldSkipDefaultKey(topKey)) continue;
        if (used.has(p)) continue;
        walk(node[k], p, depth + 1);
      }
      return;
    }

    if (prefix && !used.has(prefix)) out.push({ label: prefix, value: String(node), usedPaths: [prefix] });
  };

  for (const k of listTopKeys(fi)) {
    if (shouldSkipDefaultKey(k)) continue;
    if (used.has(k)) continue;
    walk(fi?.[k], k, 1);
  }

  return out;
}

// ===== NGF-LAD 示例（保留你已有逻辑） =====
const TYPE_NAME_MAP: Record<string, string> = {
  'NGF|LAD|ISD': '岛屿',
  'NGF|LAD|PNS': '半岛',
};

function buildTypeRow(feature: FeatureRecord): CardRow {
  const { Kind, SKind, SKind2 } = extractKindTriplet(feature);
  const key = `${Kind}|${SKind}|${SKind2}`;
  const typeName = TYPE_NAME_MAP[key] || `${Kind}${SKind}${SKind2}`;
  //const codePart = [Kind, SKind, SKind2].filter(Boolean).join('+');
  return {
    label: '类型',
    value: typeName,
    usedPaths: [
      // 字段解析接口：Kind/SKind/SKind2 三元组（面/线/点）
      'PGonKind',
      'PGonSKind',
      'PGonSKind2',
      'PLineKind',
      'PLineSKind',
      'PLineSKind2',
      'PointKind',
      'PointSKind',
      'PointSKind2',
      'Kind',
      'SKind',
      'SKind2',
      'tags.PGonKind',
      'tags.PGonSKind',
      'tags.PGonSKind2',
      'tags.PLineKind',
      'tags.PLineSKind',
      'tags.PLineSKind2',
      'tags.PointKind',
      'tags.PointSKind',
      'tags.PointSKind2',
      'tags.Kind',
      'tags.SKind',
      'tags.SKind2',
    ],
  };
}

function uniqueLinesFromStationIds(stationIds: string[], railIndex?: RailNewIndex | null) {
  if (!railIndex) return [];
  const lineMap = new Map<string, { name: string; color: string; text: string }>();

  for (const sid of stationIds) {
    const sta = railIndex.stas.get(sid);
    if (!sta) continue;

    for (const pid of sta.platformIds) {
      const plf = railIndex.plfs.get(pid);
      if (!plf) continue;

      for (const lr of plf.lines) {
        if (!passLineBooleanFilters((lr as any)?.flags)) continue;
        const rle = railIndex.rles.get(lr.id);
        if (!rle) continue;

        const color = normalizeHexColor(rle.color) || '#999999';
        const name = rle.name || rle.line || rle.id;
        const text = normalizeHexColor(rle.color) ? normalizeHexColor(rle.color) : '#999999';

        lineMap.set(rle.id, { name, color, text });
      }
    }
  }

  return mergeUpDownSameColorLines(Array.from(lineMap.values()));
}

export const FIELD_RULES: FieldRule[] = [
  // === 已有 NGF-LAD 规则（保持） ===
  {
    name: 'NGF-LAD（陆地单元）信息栏解析',
    match: { Kind: 'NGF', SKind: 'LAD' },
    rows: (feature) => {
      const fi: any = feature?.featureInfo ?? {};
      return [
        buildTypeRow(feature),
        { label: '命名者', value: getValueByPath(fi, 'tags.nomenclator') || '未知', usedPaths: ['tags.nomenclator'] },
        {
          label: 'WIKI链接',
          value: (() => {
            const url = String(getValueByPath(fi, 'extensions.link.wiki') ?? '').trim();
            return url ? makeExternalLink(url) : '未知';
          })(),
          usedPaths: ['extensions.link.wiki'],
        },
        { label: '简介', value: getValueByPath(fi, 'extensions.character.brief') || '未知', usedPaths: ['extensions.character.brief'] },
        { label: '创建时间', value: pickFirstString(fi, ['CreateTime', 'createTime']) || '未知', usedPaths: ['CreateTime', 'createTime'] },
        { label: '修改时间', value: pickFirstString(fi, ['ModifityTime', 'ModifyTime', 'modifyTime']) || '未知', usedPaths: ['ModifityTime', 'ModifyTime', 'modifyTime'] },
      ];
    },
  },

  // === 新增：RLE ===
  {
    name: 'RLE（铁路线）信息栏解析',
    match: { Kind: 'RLE' },
    rows: (feature) => {
      const fi: any = feature?.featureInfo ?? {};
      const colorRaw = fi?.color ?? fi?.Color ?? '';
      const color = normalizeHexColor(colorRaw) || '#999999';
      const colorText = normalizeHexColor(colorRaw) || '#999999';

      return [
        { label: '类型', value: '铁路线', usedPaths: ['Kind', 'Class'] },
        { label: '路局', value: ensureKnown(fi?.bureau), usedPaths: ['bureau'] },
        { label: '线路编号', value: ensureKnown(fi?.line), usedPaths: ['line'] },
        {
          label: '色号',
          value: { kind: 'colorChip', color, text: colorText } as any,
          usedPaths: ['color', 'Color'],
        },
        { label: '方向', value: ensureKnown(fi?.direction), usedPaths: ['direction'] },
        { label: '创建时间', value: pickFirstString(fi, ['CreateTime', 'createTime']) || '未知', usedPaths: ['CreateTime', 'createTime'] },
        { label: '修改时间', value: pickFirstString(fi, ['ModifityTime', 'ModifyTime', 'modifyTime']) || '未知', usedPaths: ['ModifityTime', 'ModifyTime', 'modifyTime'] },
      ];
    },
  },

  // === 新增：PLF ===
  {
    name: 'PLF（站台）信息栏解析',
    match: { Kind: 'PLF' },
    rows: (feature, railIndex) => {
      const fi: any = feature?.featureInfo ?? {};
      const plfId = String(feature?.meta?.idValue ?? fi?.platformID ?? fi?.platformId ?? '').trim();

      // 严格语义：仅展示“该 PLF 自身包含的线路”，并应用 lines[] 布尔过滤（如 Avaliable=false 视为不包含）
      const lineRefs: Array<{ id: string; flags?: Record<string, boolean> }> = [];

      // 优先从 railIndex.plfs 读取（索引更稳定）；若取不到则兜底从 featureInfo.lines 读取
      const plf = railIndex && plfId ? railIndex.plfs.get(plfId) : undefined;
      if (plf?.lines?.length) {
        for (const lr of plf.lines) {
          lineRefs.push({ id: String(lr.id ?? '').trim(), flags: (lr as any)?.flags });
        }
      } else {
        const raw = fi?.lines ?? fi?.Lines ?? fi?.LINES ?? [];
        const arr = Array.isArray(raw) ? raw : [];
        for (const x of arr) {
          const id = String(x?.ID ?? x?.LineID ?? x?.lineID ?? x?.id ?? x ?? '').trim();
          if (!id) continue;
          // 兜底侧只取布尔字段用于过滤
          const flags: Record<string, boolean> = {};
          if (x && typeof x === 'object' && !Array.isArray(x)) {
            for (const k of Object.keys(x)) {
              if (typeof (x as any)[k] === 'boolean') flags[k] = (x as any)[k];
            }
          }
          lineRefs.push({ id, flags: Object.keys(flags).length ? flags : undefined });
        }
      }

      const rawItems: LineChipItem[] = [];
      for (const lr of lineRefs) {
        if (!lr.id) continue;
        if (!passLineBooleanFilters(lr.flags)) continue;

        const rle = railIndex?.rles.get(lr.id);

        // 若 RLE 映射缺失：至少显示 lineId，便于排查数据/索引问题
        const color = normalizeHexColor(rle?.color) || '#999999';
        const name = (rle?.name || rle?.line || rle?.id || lr.id) as string;
        const text = normalizeHexColor(rle?.color) || '#999999';

        rawItems.push({ name, color, text });
      }

      const lineItems = mergeUpDownSameColorLines(rawItems);

      const chips: CardLineChips = {
        kind: 'lineChips',
        items: lineItems.length > 0 ? lineItems : [{ name: '未知', color: '#999999', text: '#999999' }],
      };

      return [
        { label: '类型', value: '站台', usedPaths: ['Kind', 'Class'] },
        { label: '包含线路', value: chips, usedPaths: ['lines', 'Lines', 'LINES'] },
        { label: '创建时间', value: pickFirstString(fi, ['CreateTime', 'createTime']) || '未知', usedPaths: ['CreateTime', 'createTime'] },
        { label: '修改时间', value: pickFirstString(fi, ['ModifityTime', 'ModifyTime', 'modifyTime']) || '未知', usedPaths: ['ModifityTime', 'ModifyTime', 'modifyTime'] },
      ];
    },
  },
  

  // === 新增：STA ===
  {
    name: 'STA（站场）信息栏解析',
    match: { Kind: 'STA' },
    rows: (feature, railIndex) => {
      const fi: any = feature?.featureInfo ?? {};
      const stationId = String(feature?.meta?.idValue ?? '').trim();

      const lineItems = uniqueLinesFromStationIds(stationId ? [stationId] : [], railIndex);
      const chips: CardLineChips = {
        kind: 'lineChips',
        items: lineItems.length > 0 ? lineItems : [{ name: '未知', color: '#999999', text: '#999999' }],
      };

      return [
        { label: '类型', value: '站场', usedPaths: ['Kind', 'Class'] },
        {
          label: '所属车站',
          value: (() => {
            const id = String(fi?.STBuilding ?? fi?.StBuilding ?? fi?.stationBuilding ?? '').trim();
            return id ? makeFeatureLink(id) : '未知';
          })(),
          usedPaths: ['STBuilding', 'StBuilding', 'stationBuilding'],
        },
        { label: '包含线路', value: chips, usedPaths: [] },
        { label: '创建时间', value: pickFirstString(fi, ['CreateTime', 'createTime']) || '未知', usedPaths: ['CreateTime', 'createTime'] },
        { label: '修改时间', value: pickFirstString(fi, ['ModifityTime', 'ModifyTime', 'modifyTime']) || '未知', usedPaths: ['ModifityTime', 'ModifyTime', 'modifyTime'] },
      ];
    },
  },

  // === 新增：STB ===
  {
    name: 'STB（车站建筑）信息栏解析',
    match: { Kind: 'STB' },
    rows: (feature, railIndex) => {
      const fi: any = feature?.featureInfo ?? {};
      const buildingId = String(feature?.meta?.idValue ?? '').trim();

      const height = ensureKnown(fi?.height ?? fi?.Height);

      const stationIds = buildingId && railIndex?.buildingToStations.get(buildingId)
        ? Array.from(railIndex!.buildingToStations.get(buildingId)!)
        : [];

      const lineItems = uniqueLinesFromStationIds(stationIds, railIndex);
      const chips: CardLineChips = {
        kind: 'lineChips',
        items: lineItems.length > 0 ? lineItems : [{ name: '未知', color: '#999999', text: '#999999' }],
      };

      return [
        { label: '类型', value: '车站', usedPaths: ['Kind', 'Class'] },
        { label: '高度', value: height, usedPaths: ['height', 'Height'] },
        { label: '包含线路', value: chips, usedPaths: [] },
        { label: '创建时间', value: pickFirstString(fi, ['CreateTime', 'createTime']) || '未知', usedPaths: ['CreateTime', 'createTime'] },
        { label: '修改时间', value: pickFirstString(fi, ['ModifityTime', 'ModifyTime', 'modifyTime']) || '未知', usedPaths: ['ModifityTime', 'ModifyTime', 'modifyTime'] },
      ];
    },
  },
];

export type InfoSections = {
  /** 主要信息（默认直接展示） */
  mainRows: CardRow[];
  /** 其他信息（默认收起，用户可展开） */
  otherRows: CardRow[];
};


const SYSTEM_META_KEYS = {
  CreateTime: { label: '创建时间', keys: ['CreateTime', 'createTime'] },
  CreateBy: { label: '创建者', keys: ['CreateBy', 'createBy'] },
  ModifityTime: { label: '最后编辑时间', keys: ['ModifityTime', 'ModifyTime', 'modifityTime', 'modifyTime'] },
  ModifityBy: { label: '编辑者', keys: ['ModifityBy', 'ModifyBy', 'modifityBy', 'modifyBy'] },
} as const;

function pickFirstStringFromKeys(fi: any, keys: string[]): string {
  for (const k of keys) {
    const v = fi?.[k];
    const s = v === null || v === undefined ? '' : String(v).trim();
    if (s) return s;
  }
  return '';
}

function buildSystemMetaRows(feature: FeatureRecord): CardRow[] {
  const fi: any = feature?.featureInfo ?? {};
  const out: CardRow[] = [];
  for (const v of Object.values(SYSTEM_META_KEYS)) {
    const val = pickFirstStringFromKeys(fi, v.keys as any);
    if (!val) continue;
    out.push({ label: v.label, value: val, usedPaths: [...(v.keys as any)] });
  }
  return out;
}

function isSystemMetaRow(row: CardRow): boolean {
  // Widen to Set<string> so callers can pass any string label safely.
  const labels = new Set<string>(Object.values(SYSTEM_META_KEYS).map((v) => v.label));
  if (labels.has(row.label)) return true;
  const paths = row.usedPaths ?? [];
  const allKeys = new Set<string>();
  for (const v of Object.values(SYSTEM_META_KEYS)) for (const k of v.keys as any) allKeys.add(k);
  return paths.some((p) => allKeys.has(p) || allKeys.has(p.split('.')?.[0] ?? ''));
}

function removeSystemMetaRows(rows: CardRow[]): CardRow[] {
  return rows.filter((r) => !isSystemMetaRow(r));
}

function mergeRowsDedupByLabel(a: CardRow[], b: CardRow[]): CardRow[] {
  const seen = new Set<string>();
  const out: CardRow[] = [];
  for (const r of [...a, ...b]) {
    const key = String(r.label ?? '').trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export function buildInfoSectionsForFeature(
  feature: FeatureRecord,
  railIndex?: RailNewIndex | null,
): InfoSections {
  const { Kind, SKind, SKind2 } = extractKindTriplet(feature);

  let chosen: FieldRule | null = null;
  for (const r of FIELD_RULES) {
    if (r.match.Kind && r.match.Kind !== Kind) continue;
    if (r.match.SKind && r.match.SKind !== SKind) continue;
    if (r.match.SKind2 && r.match.SKind2 !== SKind2) continue;
    chosen = r;
    if (r.match.SKind2) break;
  }

  const primaryRowsFull = chosen ? chosen.rows(feature, railIndex) : [];

  // 系统元信息：无论是否定义规则，都要求在“其他信息”中显示（用于快速定位）
  const systemMetaRows = buildSystemMetaRows(feature);

  // 对“已定义规则”的种类：主信息展示规则行（但不在主信息重复展示系统元信息字段）
  if (primaryRowsFull.length > 0) {
    const primaryRows = removeSystemMetaRows(primaryRowsFull);

    const used = new Set<string>();
    for (const row of primaryRows) {
      for (const p of row.usedPaths ?? []) used.add(p);
    }

    // 规则未覆盖的字段：全部进入“其他信息”
    const remainingRaw = flattenRemainingRows(feature, used);

    // “其他信息” = 系统元信息 + 其他剩余字段（去重）
    const otherRows = mergeRowsDedupByLabel(systemMetaRows, remainingRaw);

    return { mainRows: primaryRows, otherRows };
  }

  // 对“未定义规则”的种类：
  // - 正页（主信息）展示全部字段（不再按数量拆分），确保“未定义种类”不会隐藏信息；
  // - “其他信息”仅展示系统四字段（便于快速定位）。
  const remainingAll = flattenRemainingRows(feature, new Set<string>());
  return { mainRows: remainingAll, otherRows: systemMetaRows };
}

// 兼容旧调用：仍保留拼接后的版本
export function buildInfoRowsForFeature(feature: FeatureRecord): CardRow[] {
  const { mainRows, otherRows } = buildInfoSectionsForFeature(feature, null);
  return [...mainRows, ...otherRows];
}

// =========================
// 标题（Name 字段）解析
// =========================

export function pickFeatureDisplayName(feature?: FeatureRecord | null): string {
  if (!feature) return '';
  const fi: any = feature.featureInfo ?? {};

  const direct = pickFirstString(fi, ['Name', 'name', 'PGonName', 'PLineName', 'PointName', 'staName']);
  if (direct) return direct;

  for (const k of Object.keys(fi)) {
    if (!/name$/i.test(k)) continue;
    const s = String(fi?.[k] ?? '').trim();
    if (s) return s;
  }

  const cls = String(feature?.meta?.Class ?? '').trim();
  const id = String(feature?.meta?.idValue ?? '').trim();
  if (cls || id) return `${cls || 'Feature'}${id ? `: ${id}` : ''}`;
  return '';
}
