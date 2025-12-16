/**
 * 玩家详情卡片组件
 * 展示选中玩家的详细信息及附近信息
 */

import { X, User, Heart, Shield, Train, Home } from 'lucide-react';
import type { Player, ParsedStation } from '@/types';
import type { ParsedLandmark } from '@/lib/landmarkParser';

interface PlayerDetailCardProps {
  player: Player;
  nearbyStations: ParsedStation[];
  nearbyLandmarks: ParsedLandmark[];
  onClose: () => void;
  onStationClick?: (station: ParsedStation) => void;
  onLandmarkClick?: (landmark: ParsedLandmark) => void;
}

// 计算两点间距离
function getDistance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function PlayerDetailCard({
  player,
  nearbyStations,
  nearbyLandmarks,
  onClose,
  onStationClick,
  onLandmarkClick,
}: PlayerDetailCardProps) {
  const playerCoord = { x: player.x, z: player.z };

  // 生命值条 (满血20)
  const healthPercent = (player.health / 20) * 100;
  const healthColor = healthPercent > 50 ? 'bg-red-500' : healthPercent > 25 ? 'bg-yellow-500' : 'bg-red-700';

  // 护甲条 (满护甲20)
  const armorPercent = (player.armor / 20) * 100;

  return (
    <div className="bg-white rounded-lg shadow-lg w-72 max-h-[60vh] flex flex-col">
      {/* 头部 */}
      <div className="px-4 py-3 rounded-t-lg flex items-center justify-between bg-cyan-500">
        <div className="text-white">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4" />
            <h3 className="font-bold">{player.name}</h3>
          </div>
          <p className="text-xs opacity-90 mt-1">
            X: {Math.round(player.x)}, Y: {Math.round(player.y)}, Z: {Math.round(player.z)}
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-white/80 hover:text-white p-1"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* 详情内容 */}
      <div className="flex-1 overflow-y-auto">
        {/* 状态信息 */}
        <div className="px-4 py-3 border-b">
          {/* 生命值 */}
          <div className="mb-3">
            <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
              <Heart className="w-4 h-4 text-red-500" />
              <span>生命值</span>
              <span className="ml-auto text-gray-800 font-medium">
                {player.health.toFixed(0)} / 20
              </span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full ${healthColor} transition-all`}
                style={{ width: `${healthPercent}%` }}
              />
            </div>
          </div>

          {/* 护甲值 */}
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
              <Shield className="w-4 h-4 text-blue-500" />
              <span>护甲值</span>
              <span className="ml-auto text-gray-800 font-medium">
                {player.armor} / 20
              </span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{ width: `${armorPercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* 附近站点 */}
        {nearbyStations.length > 0 && (
          <div className="px-4 py-3 border-b">
            <div className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
              <Train className="w-3 h-3" />
              附近站点
            </div>
            <div className="space-y-1">
              {nearbyStations.map((station, idx) => (
                <button
                  key={idx}
                  className="w-full flex items-center justify-between py-1.5 px-2 hover:bg-gray-50 rounded text-left"
                  onClick={() => onStationClick?.(station)}
                >
                  <span className="text-sm text-gray-800 truncate">{station.name}</span>
                  <span className="text-xs text-gray-400 ml-2">
                    {Math.round(getDistance(playerCoord, station.coord))}m
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 附近地标 */}
        {nearbyLandmarks.length > 0 && (
          <div className="px-4 py-3">
            <div className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
              <Home className="w-3 h-3" />
              附近地标
            </div>
            <div className="space-y-1">
              {nearbyLandmarks.map((landmark, idx) => (
                <button
                  key={idx}
                  className="w-full flex items-center justify-between py-1.5 px-2 hover:bg-gray-50 rounded text-left"
                  onClick={() => onLandmarkClick?.(landmark)}
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-gray-800 truncate block">#{landmark.id} {landmark.name}</span>
                    <span className="text-xs text-gray-400">{landmark.grade}</span>
                  </div>
                  <span className="text-xs text-gray-400 ml-2">
                    {landmark.coord ? Math.round(getDistance(playerCoord, landmark.coord)) : '?'}m
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 无附近信息 */}
        {nearbyStations.length === 0 && nearbyLandmarks.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-gray-400">
            附近没有站点或地标
          </div>
        )}
      </div>
    </div>
  );
}

export default PlayerDetailCard;
