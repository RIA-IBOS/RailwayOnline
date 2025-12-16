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

      // 创建房子形状的自定义图标
      const houseIcon = L.divIcon({
        className: 'landmark-house-icon',
        html: `<svg width="${size * 3}" height="${size * 3}" viewBox="0 0 24 24" fill="${color}" stroke="${color}" stroke-width="1">
          <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
        </svg>`,
        iconSize: [size * 3, size * 3],
        iconAnchor: [size * 1.5, size * 3],
      });

      const marker = L.marker(latLng, { icon: houseIcon });

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
