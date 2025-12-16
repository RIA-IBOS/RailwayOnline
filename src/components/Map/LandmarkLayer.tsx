/**
 * 地标图层组件
 * 在地图上渲染地标点
 */

import { useEffect, useState } from 'react';
import * as L from 'leaflet';
import type { ParsedLandmark } from '@/lib/landmarkParser';
import {
  fetchLandmarkData,
  parseLandmarkData,
  getLandmarkColor,
  getLandmarkSize,
} from '@/lib/landmarkParser';
import { DynmapProjection } from '@/lib/DynmapProjection';

interface LandmarkLayerProps {
  map: L.Map;
  projection: DynmapProjection;
  worldId: string;
  visible?: boolean;
  onLandmarkClick?: (landmark: ParsedLandmark) => void;
}

export function LandmarkLayer({
  map,
  projection,
  worldId,
  visible = true,
  onLandmarkClick,
}: LandmarkLayerProps) {
  const [landmarks, setLandmarks] = useState<ParsedLandmark[]>([]);
  const [layerGroup, setLayerGroup] = useState<L.LayerGroup | null>(null);

  // 加载地标数据
  useEffect(() => {
    async function loadData() {
      const rawData = await fetchLandmarkData(worldId);
      const parsed = parseLandmarkData(rawData);
      setLandmarks(parsed);
    }
    loadData();
  }, [worldId]);

  // 渲染地标图层
  useEffect(() => {
    if (!map || landmarks.length === 0) return;

    // 清除旧图层
    if (layerGroup) {
      map.removeLayer(layerGroup);
    }

    const group = L.layerGroup();

    // 渲染每个地标
    for (const landmark of landmarks) {
      if (!landmark.coord) continue;
      if (
        !Number.isFinite(landmark.coord.x) ||
        !Number.isFinite(landmark.coord.y) ||
        !Number.isFinite(landmark.coord.z)
      ) continue;

      const latLng = projection.locationToLatLng(
        landmark.coord.x,
        landmark.coord.y,
        landmark.coord.z
      );

      const color = getLandmarkColor(landmark.grade);
      const size = getLandmarkSize(landmark.grade);

      // 使用菱形标记
      const marker = L.circleMarker(latLng, {
        radius: size,
        color: color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.6,
      });

      // 地标 tooltip
      marker.bindTooltip(`<b>${landmark.name}</b><br/>${landmark.grade}`, {
        permanent: false,
        direction: 'top',
        offset: [0, -5],
      });

      // 地标点击事件
      if (onLandmarkClick) {
        marker.on('click', () => {
          onLandmarkClick(landmark);
        });
      }

      // 创建地标弹窗
      const popupContent = `
        <div class="landmark-popup">
          <h3 style="margin: 0 0 8px 0; font-size: 14px;">${landmark.name}</h3>
          <p style="margin: 0; font-size: 12px;">
            等级: <span style="color: ${color}; font-weight: bold;">${landmark.grade}</span>
          </p>
          <p style="margin: 4px 0 0 0; font-size: 12px; color: #666;">
            坐标: X ${Math.round(landmark.coord.x)}, Z ${Math.round(landmark.coord.z)}
          </p>
        </div>
      `;
      marker.bindPopup(popupContent);

      group.addLayer(marker);
    }

    setLayerGroup(group);

    // 根据 visible 决定是否添加到地图
    if (visible) {
      group.addTo(map);
    }

    return () => {
      if (group) {
        map.removeLayer(group);
      }
    };
  }, [map, landmarks, projection, onLandmarkClick, visible]);

  // 控制图层可见性
  useEffect(() => {
    if (!layerGroup || !map) return;

    if (visible) {
      if (!map.hasLayer(layerGroup)) {
        layerGroup.addTo(map);
      }
    } else {
      if (map.hasLayer(layerGroup)) {
        map.removeLayer(layerGroup);
      }
    }
  }, [visible, layerGroup, map]);

  return null;
}

export default LandmarkLayer;
