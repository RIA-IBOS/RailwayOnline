/**
 * 图片目录规则（信息卡 - 照片报幕）。
 *
 * 设计目标：
 * - 以 Kind/SKind/SKind2 等字段映射到 public/pictures 下的子目录。
 * - 图片命名：<xxxID>_<n>.(png|jpg|jpeg|webp)
 * - 若无任何匹配或未找到图片：回退到 public/pictures/normal.png。
 */

import type { FeatureRecord } from '../renderRules';

export type PictureDirRule = {
  /** 规则名（便于维护） */
  name: string;
  /** 以 Kind/SKind/SKind2 三元组匹配；允许只写部分 */
  match: {
    Kind?: string;
    SKind?: string;
    SKind2?: string;
  };
  /** 相对 public/pictures 的目录，例如 "NGF/LAD/ISD"；空字符串表示 pictures 根目录 */
  dir: string;
};

// =========================
// 目录对照表（示例/可扩展）
// =========================

export const PICTURE_DIR_RULES: PictureDirRule[] = [
  // 案例 1：NGF-LAD-ISD → public/pictures/NGF/LAD/ISD
  {
    name: 'NGF-LAD-ISD（岛屿）',
    match: { Kind: 'NGF', SKind: 'LAD', SKind2: 'ISD' },
    dir: 'NGF/LAD/ISD',
  },

  // 案例 2：NGF-LAD-PNS → public/pictures/NGF/LAD/PNS（半岛；示例便于你后续扩展）
  {
    name: 'NGF-LAD-PNS（半岛）',
    match: { Kind: 'NGF', SKind: 'LAD', SKind2: 'PNS' },
    dir: 'NGF/LAD/PNS',
  },

  // 案例 2（模板）：你后续可以新增更多 Kind/SKind/SKind2 的目录映射
  // {
  //   name: 'NGF-WTR-LKE（湖泊）',
  //   match: { Kind: 'NGF', SKind: 'WTR', SKind2: 'LKE' },
  //   dir: 'NGF/WTR/LKE',
  // },
// 新增：RLE / PLF / STA / STB 的图片目录
{ name: 'RLE（铁路线）', match: { Kind: 'RLE' }, dir: 'RLE' },
{ name: 'PLF（站台）', match: { Kind: 'PLF' }, dir: 'PLF' },
{ name: 'STA（站场）', match: { Kind: 'STA' }, dir: 'STA' },
{ name: 'STB（车站建筑）', match: { Kind: 'STB' }, dir: 'STB' },

];

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'] as const;

function readString(fi: any, keys: string[]): string {
  for (const k of keys) {
    const s = String(fi?.[k] ?? '').trim();
    if (s) return s;
  }
  return '';
}

export function extractKindTriplet(feature?: FeatureRecord | null): {
  Kind: string;
  SKind: string;
  SKind2: string;
} {
  const fi: any = feature?.featureInfo ?? {};

  /**
   * 字段解析接口（Kind/SKind/SKind2 三元组）
   *
   * 说明：通用要素集包含面(ISD/ISG...)、线(ISL)、点(ISP)。
   * 不同几何类型在 featureInfo 中使用不同字段命名（同时允许写入 tags 回退）：
   * - 面（Polygon）：PGonKind / PGonSKind / PGonSKind2
   * - 线（Polyline）：PLineKind / PLineSKind / PLineSKind2
   * - 点（Point）：PointKind / PointSKind / PointSKind2
   * - 兼容旧/杂项：Kind / SKind / SKind2
   *
   * 后续如需新增解析来源（例如其它 workflow 写入字段），优先在此处集中扩展，
   * 避免在各处散落“只支持 PGon”的判断。
   */

  // 兼容不同命名：Kind / PGonKind / PLineKind / PointKind / tags.* 等。
  // 重要：铁路 STA/STB/PLF/RLE 等对象通常没有 Kind 字段，而是使用 meta.Class / featureInfo.Class。
  // 因此这里必须做回退，否则目录规则与字段解析规则都不会命中。
  const Kind =
    readString(fi, ['Kind', 'PGonKind', 'PLineKind', 'PointKind']) ||
    readString(fi?.tags, ['Kind', 'PGonKind', 'PLineKind', 'PointKind']) ||
    readString(fi, ['Class']) ||
    String(feature?.meta?.Class ?? '').trim();
  const SKind =
    readString(fi, ['SKind', 'PGonSKind', 'PLineSKind', 'PointSKind']) ||
    readString(fi?.tags, ['SKind', 'PGonSKind', 'PLineSKind', 'PointSKind']) ||
    '';
  const SKind2 =
    readString(fi, ['SKind2', 'PGonSKind2', 'PLineSKind2', 'PointSKind2']) ||
    readString(fi?.tags, ['SKind2', 'PGonSKind2', 'PLineSKind2', 'PointSKind2']) ||
    '';

  return { Kind, SKind, SKind2 };
}

export function resolvePictureDir(feature?: FeatureRecord | null): string {
  const { Kind, SKind, SKind2 } = extractKindTriplet(feature);

  for (const r of PICTURE_DIR_RULES) {
    if (r.match.Kind && r.match.Kind !== Kind) continue;
    if (r.match.SKind && r.match.SKind !== SKind) continue;
    if (r.match.SKind2 && r.match.SKind2 !== SKind2) continue;
    return r.dir || '';
  }

  // 兜底：无目录规则 → pictures 根目录（不包含子目录）
  return '';
}

function tryLoad(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

/**
 * 探测并返回当前要素可用的图片 URL 列表。
 * - 优先按目录规则（public/pictures/<dir>/...）
 * - 若目录规则不命中：在 public/pictures 根目录探测
 * - 若未找到任何图片：返回空数组（由调用方回退 normal.png）
 */
export async function buildPictureUrlsForFeature(
  feature?: FeatureRecord | null,
  opts?: { maxImages?: number },
): Promise<string[]> {
  const id = String(feature?.meta?.idValue ?? '').trim();
  if (!id) return [];

  const dir = resolvePictureDir(feature);
  const dirPrefix = dir ? `/pictures/${dir}` : '/pictures';

  const maxImages = Math.max(1, Math.min(30, opts?.maxImages ?? 12));
  const out: string[] = [];

  // 约定：<id>_1, <id>_2 ... 连续编号；遇到断档即停止。
  for (let n = 1; n <= maxImages; n += 1) {
    let found: string | null = null;
    for (const ext of IMAGE_EXTS) {
      const url = `${dirPrefix}/${id}_${n}${ext}`;
      // eslint-disable-next-line no-await-in-loop
      const ok = await tryLoad(url);
      if (ok) {
        found = url;
        break;
      }
    }

    if (!found) {
      // n=1 没找到：允许直接返回空数组，让外层走 normal.png
      // n>1 断档：认为编号结束
      break;
    }
    out.push(found);
  }

  return out;
}
