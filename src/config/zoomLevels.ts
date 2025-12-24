// RailwayOnline_E/src/config/zoomLevels.ts

/**
 * 统一的“应用缩放等级”定义：
 * - 固定 11 个缩放等级（0..10）
 * - Leaflet 的实际 zoom 可以是负数（用于更进一步缩小视野）
 */
export const APP_ZOOM_LEVEL_COUNT = 11;

/**
 * 根据当前 Leaflet 的 maxZoom 推导 minZoom，使总等级数恒为 APP_ZOOM_LEVEL_COUNT。
 * 例如：maxZoom=5 => minZoom = 5 - (11-1) = -5
 */
export function calcLeafletMinZoom(maxZoom: number): number {
  return maxZoom - (APP_ZOOM_LEVEL_COUNT - 1);
}

/**
 * Leaflet zoom -> 应用缩放等级（0..10）
 * 用于未来做“字段值—可见缩放范围”的配置表时，统一接口层的缩放编号。
 */
export function leafletZoomToAppLevel(leafletZoom: number, maxZoom: number): number {
  const minZoom = calcLeafletMinZoom(maxZoom);
  return Math.round(leafletZoom - minZoom);
}

/**
 * 应用缩放等级（0..10）-> Leaflet zoom
 */
export function appLevelToLeafletZoom(appLevel: number, maxZoom: number): number {
  const minZoom = calcLeafletMinZoom(maxZoom);
  return minZoom + appLevel;
}
