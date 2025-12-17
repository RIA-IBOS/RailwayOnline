/**
 * RMP SVG 路径渲染工具
 * 将 RMP 边数据转换为 SVG path 字符串
 */

interface Point2D {
  x: number;
  y: number;
}

interface PerpendicularConfig {
  startFrom: 'from' | 'to';
  offsetFrom: number;
  offsetTo: number;
  roundCornerFactor: number;
}

interface DiagonalConfig {
  startFrom: 'from' | 'to';
  offsetFrom: number;
  offsetTo: number;
  roundCornerFactor: number;
}

interface SimpleConfig {
  offset: number;
}

/**
 * 向量归一化
 */
function normalize(v: Point2D): Point2D {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  return len > 0 ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
}

/**
 * 计算垂直向量（逆时针旋转 90 度）
 */
function perpendicular(v: Point2D): Point2D {
  return { x: -v.y, y: v.x };
}

/**
 * 计算两点距离
 */
function distance(p1: Point2D, p2: Point2D): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 应用圆角到转角点
 */
function applyRoundCorner(
  before: Point2D,
  corner: Point2D,
  after: Point2D,
  factor: number
): { cornerStart: Point2D; cornerEnd: Point2D; control: Point2D } {
  const v1 = normalize({ x: before.x - corner.x, y: before.y - corner.y });
  const v2 = normalize({ x: after.x - corner.x, y: after.y - corner.y });

  const dist1 = distance(corner, before);
  const dist2 = distance(corner, after);
  const maxFactor = Math.min(dist1, dist2) * 0.5;
  const clampedFactor = Math.min(factor, maxFactor);

  const cornerStart = {
    x: corner.x + v1.x * clampedFactor,
    y: corner.y + v1.y * clampedFactor,
  };
  const cornerEnd = {
    x: corner.x + v2.x * clampedFactor,
    y: corner.y + v2.y * clampedFactor,
  };

  return { cornerStart, cornerEnd, control: corner };
}

/**
 * 计算 perpendicular 类型的 SVG 路径
 */
export function perpendicularToSVGPath(
  from: Point2D,
  to: Point2D,
  config: PerpendicularConfig
): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  const dir = normalize({ x: dx, y: dy });
  const perpDir = perpendicular(dir);

  const p1: Point2D = {
    x: from.x + perpDir.x * config.offsetFrom,
    y: from.y + perpDir.y * config.offsetFrom,
  };
  const p2: Point2D = {
    x: to.x + perpDir.x * config.offsetTo,
    y: to.y + perpDir.y * config.offsetTo,
  };

  const isHorizontalDominant = Math.abs(dx) >= Math.abs(dy);
  let corner: Point2D;

  if (config.startFrom === 'from') {
    if (isHorizontalDominant) {
      corner = { x: p2.x, y: p1.y };
    } else {
      corner = { x: p1.x, y: p2.y };
    }
  } else {
    if (isHorizontalDominant) {
      corner = { x: p1.x, y: p2.y };
    } else {
      corner = { x: p2.x, y: p1.y };
    }
  }

  const { cornerStart, cornerEnd, control } = applyRoundCorner(
    p1,
    corner,
    p2,
    config.roundCornerFactor
  );

  // 构建 SVG path: M -> L -> Q -> L
  return `M ${p1.x} ${p1.y} L ${cornerStart.x} ${cornerStart.y} Q ${control.x} ${control.y} ${cornerEnd.x} ${cornerEnd.y} L ${p2.x} ${p2.y}`;
}

/**
 * 计算 diagonal 类型的 SVG 路径
 */
export function diagonalToSVGPath(
  from: Point2D,
  to: Point2D,
  config: DiagonalConfig
): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  const dir = normalize({ x: dx, y: dy });
  const perpDir = perpendicular(dir);

  const p1: Point2D = {
    x: from.x + perpDir.x * config.offsetFrom,
    y: from.y + perpDir.y * config.offsetFrom,
  };
  const p2: Point2D = {
    x: to.x + perpDir.x * config.offsetTo,
    y: to.y + perpDir.y * config.offsetTo,
  };

  const newDx = p2.x - p1.x;
  const newDy = p2.y - p1.y;
  const diagonalLen = Math.min(Math.abs(newDx), Math.abs(newDy));

  const signX = Math.sign(newDx) || 1;
  const signY = Math.sign(newDy) || 1;

  let corner1: Point2D, corner2: Point2D;

  if (config.startFrom === 'from') {
    const midX = p1.x + (newDx - signX * diagonalLen) / 2;
    const midY = p1.y;
    corner1 = { x: midX, y: midY };
    corner2 = { x: midX + signX * diagonalLen, y: midY + signY * diagonalLen };
  } else {
    const midX = p2.x - (newDx - signX * diagonalLen) / 2;
    const midY = p2.y;
    corner2 = { x: midX, y: midY };
    corner1 = { x: midX - signX * diagonalLen, y: midY - signY * diagonalLen };
  }

  const round1 = applyRoundCorner(p1, corner1, corner2, config.roundCornerFactor);
  const round2 = applyRoundCorner(corner1, corner2, p2, config.roundCornerFactor);

  // 构建 SVG path: M -> L -> Q -> L -> Q -> L
  return `M ${p1.x} ${p1.y} L ${round1.cornerStart.x} ${round1.cornerStart.y} Q ${round1.control.x} ${round1.control.y} ${round1.cornerEnd.x} ${round1.cornerEnd.y} L ${round2.cornerStart.x} ${round2.cornerStart.y} Q ${round2.control.x} ${round2.control.y} ${round2.cornerEnd.x} ${round2.cornerEnd.y} L ${p2.x} ${p2.y}`;
}

/**
 * 计算 simple 类型的 SVG 路径
 */
export function simpleToSVGPath(
  from: Point2D,
  to: Point2D,
  config: SimpleConfig
): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  const dir = normalize({ x: dx, y: dy });
  const perpDir = perpendicular(dir);

  const p1: Point2D = {
    x: from.x + perpDir.x * config.offset,
    y: from.y + perpDir.y * config.offset,
  };
  const p2: Point2D = {
    x: to.x + perpDir.x * config.offset,
    y: to.y + perpDir.y * config.offset,
  };

  return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
}

/**
 * 计算直线 SVG 路径
 */
export function straightToSVGPath(from: Point2D, to: Point2D): string {
  return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
}

/**
 * RMP 边属性
 */
export interface RMPEdgeAttributes {
  type: string;
  perpendicular?: PerpendicularConfig;
  diagonal?: DiagonalConfig;
  simple?: SimpleConfig;
}

/**
 * 根据边属性计算 SVG 路径
 */
export function edgeToSVGPath(
  from: Point2D,
  to: Point2D,
  attributes: RMPEdgeAttributes
): string {
  const { type } = attributes;

  if (type === 'perpendicular' && attributes.perpendicular) {
    return perpendicularToSVGPath(from, to, attributes.perpendicular);
  }

  if (type === 'diagonal' && attributes.diagonal) {
    return diagonalToSVGPath(from, to, attributes.diagonal);
  }

  if (type === 'simple' && attributes.simple) {
    return simpleToSVGPath(from, to, attributes.simple);
  }

  // 默认直线
  return straightToSVGPath(from, to);
}

/**
 * 获取边的颜色
 */
export function getEdgeColor(edge: {
  attributes: {
    'single-color'?: { color?: string[] };
    'bjsubway-dotted'?: { color?: string[] };
    'mrt-under-constr'?: { color?: string[] };
  };
}): string {
  const singleColor = edge.attributes['single-color'];
  if (singleColor && singleColor.color && singleColor.color.length >= 3) {
    return singleColor.color[2];
  }

  const dottedColor = edge.attributes['bjsubway-dotted'];
  if (dottedColor && dottedColor.color && dottedColor.color.length >= 3) {
    return dottedColor.color[2];
  }

  const underConstrColor = edge.attributes['mrt-under-constr'];
  if (underConstrColor && underConstrColor.color && underConstrColor.color.length >= 3) {
    return underConstrColor.color[2];
  }

  return '#888888';
}

/**
 * 获取站点名称
 */
export function getStationName(node: {
  attributes: {
    type: string;
    'bjsubway-int'?: { names?: string[] };
    'bjsubway-basic'?: { names?: string[] };
    'suzhourt-basic'?: { names?: string[] };
    'shmetro-int'?: { names?: string[] };
  };
}): string | null {
  const attr = node.attributes;
  const typeData =
    attr['bjsubway-int'] ||
    attr['bjsubway-basic'] ||
    attr['suzhourt-basic'] ||
    attr['shmetro-int'];

  if (typeData && typeData.names && typeData.names.length > 0) {
    return typeData.names[0];
  }

  return null;
}

/**
 * 获取站点颜色（用于 suzhourt-basic）
 */
export function getStationColor(node: {
  attributes: {
    type: string;
    'suzhourt-basic'?: { color?: string[] };
  };
}): string | null {
  const suzhourt = node.attributes['suzhourt-basic'];
  if (suzhourt && suzhourt.color && suzhourt.color.length >= 3) {
    return suzhourt.color[2];
  }
  return null;
}

/**
 * 获取线路徽章信息
 */
export function getLineBadgeInfo(node: {
  attributes: {
    type: string;
    'bjsubway-text-line-badge'?: { names?: string[]; color?: string[] };
  };
}): { name: string; color: string } | null {
  const badge = node.attributes['bjsubway-text-line-badge'];
  if (badge && badge.names && badge.names.length > 0 && badge.color && badge.color.length >= 3) {
    return {
      name: badge.names[0],
      color: badge.color[2],
    };
  }
  return null;
}
