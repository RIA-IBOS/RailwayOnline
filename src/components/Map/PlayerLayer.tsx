/**
 * 玩家图层组件
 * 在地图上渲染在线玩家位置
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import * as L from 'leaflet';
import type { Player } from '@/types';
import { fetchPlayers } from '@/lib/playerApi';
import { DynmapProjection } from '@/lib/DynmapProjection';
import { createMapMarkerHtml } from '@/components/Icons';

// 玩家图标颜色
const PLAYER_COLOR = '#06b6d4'; // cyan-500

interface PlayerLayerProps {
  map: L.Map;
  projection: DynmapProjection;
  worldId: string;
  visible?: boolean;
  onPlayerClick?: (player: Player) => void;
}

export function PlayerLayer({
  map,
  projection,
  worldId,
  visible = true,
  onPlayerClick,
}: PlayerLayerProps) {
  const [players, setPlayers] = useState<Player[]>([]);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const intervalRef = useRef<number | null>(null);

  // 加载玩家数据
  const loadPlayers = useCallback(async () => {
    const data = await fetchPlayers(worldId);
    setPlayers(data);
  }, [worldId]);

  // 初始加载和定时刷新
  useEffect(() => {
    // 立即加载一次
    loadPlayers();

    // 设置定时刷新 (5秒)
    intervalRef.current = window.setInterval(() => {
      loadPlayers();
    }, 5000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [loadPlayers]);

  // 世界切换时清空玩家列表
  useEffect(() => {
    setPlayers([]);
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

  // 渲染玩家图层内容
  useEffect(() => {
    const group = layerGroupRef.current;
    if (!group) return;

    group.clearLayers();
    if (players.length === 0) return;

    // 渲染每个玩家
    for (const player of players) {
      if (
        !Number.isFinite(player.x) ||
        !Number.isFinite(player.y) ||
        !Number.isFinite(player.z)
      ) continue;

      const latLng = projection.locationToLatLng(player.x, player.y, player.z);

      // 创建玩家图标
      const markerSize = 28;
      const markerIcon = L.divIcon({
        className: 'player-marker-icon',
        html: createMapMarkerHtml('player', PLAYER_COLOR, markerSize),
        iconSize: [markerSize, markerSize],
        iconAnchor: [markerSize / 2, markerSize / 2],
      });

      const marker = L.marker(latLng, { icon: markerIcon });

      // 玩家 tooltip
      const healthBar = `${'❤'.repeat(Math.ceil(player.health / 2))}`;
      marker.bindTooltip(
        `<b>${player.name}</b><br/><span style="color: #ef4444;">${healthBar}</span>`,
        {
          permanent: false,
          direction: 'top',
          offset: [0, -8],
        }
      );

      // 玩家点击事件
      if (onPlayerClick) {
        marker.on('click', () => {
          onPlayerClick(player);
        });
      }

      group.addLayer(marker);
    }
  }, [players, projection, onPlayerClick]);

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

export default PlayerLayer;
