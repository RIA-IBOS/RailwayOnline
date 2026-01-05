// RailwayOnline_E/src/config/zoomNodes.ts

/**
 * 严格 11 档缩放节点（Leaflet zoom 值）。
 * 约束：
 * - 最小缩放 = -3（你要求的“倒数第三级”）
 * - 最大缩放 = 5（保持现有放大上限不变）
 * - 中间用 0.5 级做补档，确保总数=11
 *
 * 你后续做“字段值 -> 可见缩放范围”配置表时，
 * 直接用 level(0..10) 对应这里的索引即可。
 */
export const APP_ZOOM_NODES: number[] = [
  -3, -2, -1, 0, 1, 2, 3,
  3.5, 4, 4.5,
  5
];

export const APP_ZOOM_LEVEL_COUNT = 11;

export function clampZoomToAllowed(z: number): number {
  // 找最近的允许节点
  let best = APP_ZOOM_NODES[0];
  let bestD = Math.abs(z - best);

  for (let i = 1; i < APP_ZOOM_NODES.length; i++) {
    const cand = APP_ZOOM_NODES[i];
    const d = Math.abs(z - cand);
    if (d < bestD) {
      bestD = d;
      best = cand;
    }
  }
  return best;
}

export function appLevelToLeafletZoom(level: number): number {
  const idx = Math.max(0, Math.min(APP_ZOOM_NODES.length - 1, Math.round(level)));
  return APP_ZOOM_NODES[idx];
}
