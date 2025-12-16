/**
 * 路径高亮图层组件
 * 在地图上显示导航路径
 */

import { useEffect, useRef } from 'react';
import * as L from 'leaflet';
import type { DynmapProjection } from '@/lib/DynmapProjection';
import type { Coordinate } from '@/types';

interface RouteHighlightLayerProps {
  map: L.Map;
  projection: DynmapProjection;
  path: Array<{ coord: Coordinate }>;
}

export function RouteHighlightLayer({
  map,
  projection,
  path,
}: RouteHighlightLayerProps) {
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    // 创建图层组
    const layerGroup = L.layerGroup().addTo(map);
    layerGroupRef.current = layerGroup;

    // 转换坐标
    const latLngs = path.map(p =>
      projection.locationToLatLng(p.coord.x, p.coord.y || 64, p.coord.z)
    );

    if (latLngs.length < 2) return;

    // 绘制路径底层（更粗的白色描边）
    const outlinePath = L.polyline(latLngs, {
      color: '#ffffff',
      weight: 8,
      opacity: 0.8,
      lineCap: 'round',
      lineJoin: 'round',
    });
    layerGroup.addLayer(outlinePath);

    // 绘制路径主体（蓝色）
    const mainPath = L.polyline(latLngs, {
      color: '#2196F3',
      weight: 5,
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round',
    });
    layerGroup.addLayer(mainPath);

    // 添加起点标记
    const startLatLng = latLngs[0];
    const startMarker = L.circleMarker(startLatLng, {
      radius: 10,
      fillColor: '#4CAF50',
      fillOpacity: 1,
      color: '#ffffff',
      weight: 3,
    });
    startMarker.bindTooltip('起点', {
      permanent: false,
      direction: 'top',
      className: 'route-tooltip',
    });
    layerGroup.addLayer(startMarker);

    // 添加终点标记
    const endLatLng = latLngs[latLngs.length - 1];
    const endMarker = L.circleMarker(endLatLng, {
      radius: 10,
      fillColor: '#F44336',
      fillOpacity: 1,
      color: '#ffffff',
      weight: 3,
    });
    endMarker.bindTooltip('终点', {
      permanent: false,
      direction: 'top',
      className: 'route-tooltip',
    });
    layerGroup.addLayer(endMarker);

    // 清理函数
    return () => {
      if (layerGroupRef.current) {
        layerGroupRef.current.remove();
        layerGroupRef.current = null;
      }
    };
  }, [map, projection, path]);

  return null;
}

export default RouteHighlightLayer;
