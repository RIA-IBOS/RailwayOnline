/**
 * 地标图层组件
 * 在地图上渲染地标点
 */

import { useEffect, useRef, useState } from 'react';
import * as L from 'leaflet';
import type { ParsedLandmark } from '@/lib/landmarkParser';
import {
  fetchLandmarkData,
  parseLandmarkData,
  getLandmarkColor,
  getLandmarkSize,
} from '@/lib/landmarkParser';
import { DynmapProjection } from '@/lib/DynmapProjection';
import { createMapMarkerHtml } from '@/components/Icons';

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
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  // 加载地标数据
  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      // 先清空旧数据，避免切换世界时短暂显示上一世界的地标
      setLandmarks([]);
      const rawData = await fetchLandmarkData(worldId);
      const parsed = parseLandmarkData(rawData);
      if (!cancelled) setLandmarks(parsed);
    }
    loadData();
    return () => {
      cancelled = true;
    };
  }, [worldId]);

  // 创建图层组（仅一次）
  useEffect(() => {
    if (!map) return;

    const group = L.layerGroup();
    layerGroupRef.current = group;
    if (visible) group.addTo(map);

    return () => {
      group.remove();
      if (layerGroupRef.current === group) layerGroupRef.current = null;
    };
  }, [map]);

  // 渲染地标图层内容（复用同一个图层组）
  useEffect(() => {
    const group = layerGroupRef.current;
    if (!group) return;

    group.clearLayers();
    if (landmarks.length === 0) return;

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

      // 创建圆形图标 + 中心 Home 图标
      const markerSize = size * 4;
      const markerIcon = L.divIcon({
        className: 'landmark-marker-icon',
        html: createMapMarkerHtml('landmark', color, markerSize),
        iconSize: [markerSize, markerSize],
        iconAnchor: [markerSize / 2, markerSize / 2],
      });

      const marker = L.marker(latLng, { icon: markerIcon });

      // 地标 tooltip
      marker.bindTooltip(`<b>#${landmark.id} ${landmark.name}</b><br/>${landmark.grade}`, {
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
          <h3 style="margin: 0 0 8px 0; font-size: 14px;">#${landmark.id} ${landmark.name}</h3>
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
  }, [landmarks, projection, onLandmarkClick]);

  // 控制图层可见性
  useEffect(() => {
    const group = layerGroupRef.current;
    if (!group || !map) return;

    if (visible) {
      if (!map.hasLayer(group)) {
        group.addTo(map);
      }
    } else {
      if (map.hasLayer(group)) {
        map.removeLayer(group);
      }
    }
  }, [visible, map]);

  return null;
}

export default LandmarkLayer;
