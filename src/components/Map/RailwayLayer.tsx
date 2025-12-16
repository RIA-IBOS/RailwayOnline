/**
 * 铁路图层组件
 * 在地图上渲染铁路线路和站点
 */

import { useEffect, useState } from 'react';
import * as L from 'leaflet';
import type { ParsedLine, ParsedStation } from '@/types';
import { fetchRailwayData, parseRailwayData } from '@/lib/railwayParser';
import { DynmapProjection } from '@/lib/DynmapProjection';

interface RailwayLayerProps {
  map: L.Map;
  projection: DynmapProjection;
  worldId: string;
  visible?: boolean;
  onStationClick?: (station: ParsedStation) => void;
}

export function RailwayLayer({
  map,
  projection,
  worldId,
  visible = true,
  onStationClick,
}: RailwayLayerProps) {
  const [lines, setLines] = useState<ParsedLine[]>([]);
  const [layerGroup, setLayerGroup] = useState<L.LayerGroup | null>(null);

  // 加载铁路数据
  useEffect(() => {
    async function loadData() {
      const stations = await fetchRailwayData(worldId);
      const { lines } = parseRailwayData(stations);
      setLines(lines);
    }
    loadData();
  }, [worldId]);

  // 渲染铁路图层
  useEffect(() => {
    if (!map || lines.length === 0) return;

    // 清除旧图层
    if (layerGroup) {
      map.removeLayer(layerGroup);
    }

    const group = L.layerGroup();

    // 渲染每条线路
    for (const line of lines) {
      // 转换坐标
      const latLngs = line.stations.map(station =>
        projection.locationToLatLng(station.coord.x, station.coord.y, station.coord.z)
      );

      // 绘制线路
      const polyline = L.polyline(latLngs, {
        color: line.color,
        weight: 3,
        opacity: 0.8,
      });

      polyline.bindTooltip(`${line.bureau}-${line.line}`, {
        permanent: false,
        direction: 'center',
      });

      group.addLayer(polyline);

      // 绘制站点
      for (const station of line.stations) {
        const latLng = projection.locationToLatLng(
          station.coord.x,
          station.coord.y,
          station.coord.z
        );

        // 换乘站用更大的圆圈
        const radius = station.isTransfer ? 6 : 4;
        const fillColor = station.isTransfer ? '#ffffff' : line.color;
        const borderWidth = station.isTransfer ? 3 : 2;

        const marker = L.circleMarker(latLng, {
          radius,
          color: line.color,
          weight: borderWidth,
          fillColor,
          fillOpacity: 1,
        });

        // 站点 tooltip
        const tooltipContent = station.isTransfer
          ? `<b>${station.name}</b><br/>换乘站: ${station.lines.join(', ')}`
          : `<b>${station.name}</b><br/>${line.bureau}-${line.line}`;

        marker.bindTooltip(tooltipContent, {
          permanent: false,
          direction: 'top',
          offset: [0, -5],
        });

        // 站点点击事件
        if (onStationClick) {
          marker.on('click', () => {
            onStationClick(station);
          });
        }

        // 创建站点弹窗
        const popupContent = `
          <div class="station-popup">
            <h3 style="margin: 0 0 8px 0; font-size: 14px;">${station.name}</h3>
            <p style="margin: 0; font-size: 12px; color: #666;">
              坐标: X ${Math.round(station.coord.x)}, Z ${Math.round(station.coord.z)}
            </p>
            <p style="margin: 4px 0 0 0; font-size: 12px;">
              线路: ${station.lines.join(', ')}
            </p>
          </div>
        `;
        marker.bindPopup(popupContent);

        group.addLayer(marker);
      }
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
  }, [map, lines, projection, onStationClick, visible]);

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

/**
 * 铁路图层控制面板
 */
interface RailwayControlProps {
  lines: ParsedLine[];
  visibleLines: Set<string>;
  onToggleLine: (lineId: string) => void;
  onToggleAll: (visible: boolean) => void;
}

export function RailwayControl({
  lines,
  visibleLines,
  onToggleLine,
  onToggleAll,
}: RailwayControlProps) {
  // 按管理局分组
  const groupedLines = lines.reduce((acc, line) => {
    if (!acc[line.bureau]) {
      acc[line.bureau] = [];
    }
    acc[line.bureau].push(line);
    return acc;
  }, {} as Record<string, ParsedLine[]>);

  const bureauNames: Record<string, string> = {
    R: '铁路局',
    H: '华铁局',
    T: '铁运局',
    G: '高铁局',
  };

  return (
    <div className="railway-control bg-white rounded-lg shadow-lg p-3 max-h-80 overflow-y-auto">
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-bold text-sm">铁路线路</h3>
        <div className="flex gap-1">
          <button
            className="text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
            onClick={() => onToggleAll(true)}
          >
            全选
          </button>
          <button
            className="text-xs px-2 py-1 bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
            onClick={() => onToggleAll(false)}
          >
            全不选
          </button>
        </div>
      </div>

      {Object.entries(groupedLines).map(([bureau, bureauLines]) => (
        <div key={bureau} className="mb-2">
          <div className="text-xs font-medium text-gray-500 mb-1">
            {bureauNames[bureau] || bureau}
          </div>
          <div className="flex flex-wrap gap-1">
            {bureauLines.map(line => (
              <button
                key={line.lineId}
                className={`text-xs px-2 py-1 rounded transition-colors ${
                  visibleLines.has(line.lineId)
                    ? 'text-white'
                    : 'bg-gray-200 text-gray-500'
                }`}
                style={{
                  backgroundColor: visibleLines.has(line.lineId)
                    ? line.color
                    : undefined,
                }}
                onClick={() => onToggleLine(line.lineId)}
              >
                {line.lineId}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default RailwayLayer;
