import { DynmapProjection } from './DynmapProjection';
import { DynmapLatLngTileResult, DynmapTileLayer } from './DynmapTileLayer';

export interface MinecraftLocation {
  x: number;
  y: number;
  z: number;
}

/**
 * 计算某个 MC 坐标在指定 zoom 下对应的 Dynmap 瓦片（文件名/URL 规则与实际取瓦片一致）。
 */
export function mcToDynmapTile(
  projection: DynmapProjection,
  tileLayer: DynmapTileLayer,
  location: MinecraftLocation,
  zoom: number
): DynmapLatLngTileResult {
  const latLng = projection.locationToLatLng(location.x, location.y, location.z);
  return tileLayer.getDynmapTileForLatLng(latLng, zoom);
}

