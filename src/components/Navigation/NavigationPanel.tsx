/**
 * 导航面板组件
 * 提供起终点搜索和路径规划功能
 * 支持站点和地标作为起终点
 * 支持多种交通模式：铁路、传送、步行、自动
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { X, ArrowUpDown, Train, Home, Footprints, User, Zap, Clock, Rocket, Shield } from 'lucide-react';
import type { ParsedStation, ParsedLine, Coordinate, Player, TravelMode } from '@/types';
import type { ParsedLandmark } from '@/lib/landmarkParser';
import {
  buildRailwayGraph,
  simplifyPath,
  findAutoPath,
  findRailOnlyPath,
  findWalkPath,
  calculateEstimatedTime,
  calculateElytraConsumption,
  calculateWalkTime,
  calculateRailTime,
  MultiModePathResult,
} from '@/lib/pathfinding';
import { findTeleportPath, extractToriiList } from '@/lib/toriiTeleport';

// 格式化时间显示
function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}秒`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return secs > 0 ? `${mins}分${secs}秒` : `${mins}分钟`;
}

interface NavigationPanelProps {
  stations: ParsedStation[];
  lines: ParsedLine[];
  landmarks: ParsedLandmark[];
  players?: Player[];
  worldId: string;  // 当前世界 ID
  onRouteFound?: (path: Array<{ coord: Coordinate }>) => void;
  onClose: () => void;
  onPointClick?: (coord: Coordinate) => void;
}

// 搜索项类型
interface SearchItem {
  type: 'station' | 'landmark' | 'player';
  name: string;
  coord: Coordinate;
}

// 模式配置
const TRAVEL_MODES: Array<{
  mode: TravelMode;
  label: string;
  icon: typeof Train;
}> = [
  { mode: 'rail', label: '铁路', icon: Train },
  { mode: 'teleport', label: '传送', icon: Zap },
  { mode: 'walk', label: '步行', icon: Footprints },
];

// 搜索输入组件
interface PointSearchInputProps {
  value: SearchItem | null;
  onChange: (item: SearchItem | null) => void;
  items: SearchItem[];
  placeholder: string;
  label: string;
}

function PointSearchInput({ value, onChange, items, placeholder, label }: PointSearchInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState(value?.name || '');
  const containerRef = useRef<HTMLDivElement>(null);

  // 过滤匹配的项目
  const filteredItems = useMemo(() => {
    if (query.length === 0) return [];
    const q = query.toLowerCase();
    return items
      .filter(item => item.name.toLowerCase().includes(q))
      .slice(0, 10);
  }, [query, items]);

  // 点击外部关闭
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 同步外部值
  useEffect(() => {
    setQuery(value?.name || '');
  }, [value]);

  const handleSelect = (item: SearchItem) => {
    setQuery(item.name);
    onChange(item);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <label className="text-xs text-gray-500 mb-1 block">{label}</label>
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
          // 检查是否完全匹配
          const match = items.find(item => item.name === e.target.value);
          onChange(match || null);
        }}
        onFocus={() => setIsOpen(true)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border rounded text-sm outline-none focus:border-blue-400"
      />

      {/* 下拉搜索结果 */}
      {isOpen && filteredItems.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-lg max-h-48 overflow-y-auto z-50 border">
          {filteredItems.map((item, idx) => (
            <button
              key={`${item.type}-${item.name}-${idx}`}
              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 border-b border-gray-50 last:border-b-0 flex items-center gap-2"
              onClick={() => handleSelect(item)}
            >
              {/* 类型图标 */}
              <span className={`w-5 h-5 rounded-full flex items-center justify-center ${
                item.type === 'station' ? 'bg-blue-500 text-white' :
                item.type === 'player' ? 'bg-cyan-500 text-white' :
                'bg-orange-500 text-white'
              }`}>
                {item.type === 'station' ? (
                  <Train className="w-3 h-3" />
                ) : item.type === 'player' ? (
                  <User className="w-3 h-3" />
                ) : (
                  <Home className="w-3 h-3" />
                )}
              </span>
              <span>{item.name}</span>
              <span className="text-xs text-gray-400 ml-auto">
                {item.type === 'station' ? '站点' : item.type === 'player' ? '玩家' : '地标'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function NavigationPanel({
  stations,
  lines,
  landmarks,
  players = [],
  worldId,
  onRouteFound,
  onClose,
  onPointClick,
}: NavigationPanelProps) {
  const [startPoint, setStartPoint] = useState<SearchItem | null>(null);
  const [endPoint, setEndPoint] = useState<SearchItem | null>(null);
  const [travelMode, setTravelMode] = useState<TravelMode>('rail');
  const [preferLessTransfer, setPreferLessTransfer] = useState(true);
  const [useElytra, setUseElytra] = useState(true);  // 是否使用鞘翅飞行
  const [result, setResult] = useState<MultiModePathResult | null>(null);
  const [searching, setSearching] = useState(false);

  // 格式化线路显示名称
  const formatLineName = (lineId: string): string => {
    const line = lines.find(l => l.lineId === lineId);
    if (line) {
      return line.bureau === 'RMP' ? line.line : `${line.bureau}-${line.line}`;
    }
    return lineId;
  };

  // 构建搜索项列表（站点 + 地标 + 玩家）
  const searchItems = useMemo(() => {
    const items: SearchItem[] = [];

    // 添加站点（去重）
    const stationNames = new Set<string>();
    for (const station of stations) {
      if (!stationNames.has(station.name)) {
        stationNames.add(station.name);
        items.push({
          type: 'station',
          name: station.name,
          coord: station.coord,
        });
      }
    }

    // 添加地标
    for (const landmark of landmarks) {
      if (landmark.coord) {
        items.push({
          type: 'landmark',
          name: landmark.name,
          coord: landmark.coord,
        });
      }
    }

    // 添加在线玩家
    for (const player of players) {
      items.push({
        type: 'player',
        name: player.name,
        coord: { x: player.x, y: player.y, z: player.z },
      });
    }

    return items;
  }, [stations, landmarks, players]);

  // 构建铁路图（缓存）
  const railwayGraph = useMemo(() => buildRailwayGraph(lines), [lines]);

  // 提取鸟居列表（缓存）
  const toriiList = useMemo(() => extractToriiList(landmarks), [landmarks]);

  // 搜索路径
  const handleSearch = () => {
    if (!startPoint || !endPoint) return;
    // 比较坐标而非名字，避免同名但不同位置的情况（如玩家）
    const isSameLocation =
      startPoint.coord.x === endPoint.coord.x &&
      startPoint.coord.z === endPoint.coord.z;
    if (isSameLocation) {
      setResult({
        found: false,
        mode: 'walk',
        segments: [],
        totalWalkDistance: 0,
        totalRailDistance: 0,
        totalTransfers: 0,
        teleportCount: 0,
        reverseTeleportCount: 0,
      });
      return;
    }

    setSearching(true);

    setTimeout(() => {
      let pathResult: MultiModePathResult;

      switch (travelMode) {
        case 'walk':
          pathResult = findWalkPath(startPoint.coord, endPoint.coord);
          break;

        case 'teleport':
          const teleportPath = findTeleportPath(startPoint.coord, endPoint.coord, toriiList, worldId);
          // 转换为 MultiModePathResult
          let reverseTeleportCount = 0;
          const teleportSegments = teleportPath.segments.map(seg => {
            if (seg.type === 'teleport' && seg.torii) {
              const isReverse = seg.destinationName === seg.torii.name;
              if (isReverse) reverseTeleportCount++;
              return {
                type: 'teleport' as const,
                torii: seg.torii,
                destination: seg.to,
                destinationName: seg.destinationName || '传送点',
                isReverse,
              };
            }
            return {
              type: 'walk' as const,
              from: seg.from,
              to: seg.to,
              distance: seg.distance,
            };
          });
          pathResult = {
            found: teleportPath.found,
            mode: 'teleport',
            segments: teleportSegments,
            totalWalkDistance: teleportPath.totalWalkDistance,
            totalRailDistance: 0,
            totalTransfers: 0,
            teleportCount: teleportPath.teleportCount - reverseTeleportCount,
            reverseTeleportCount,
          };
          break;

        case 'rail':
          pathResult = findRailOnlyPath(
            startPoint.coord,
            endPoint.coord,
            railwayGraph,
            stations,
            preferLessTransfer
          );
          break;

        case 'auto':
        default:
          pathResult = findAutoPath(
            startPoint.coord,
            endPoint.coord,
            railwayGraph,
            landmarks,
            stations,
            worldId,
            preferLessTransfer
          );
          break;
      }

      setResult(pathResult);
      setSearching(false);

      // 通知路径
      if (onRouteFound && pathResult.found) {
        const path: Array<{ coord: Coordinate }> = [];
        for (const segment of pathResult.segments) {
          if (segment.type === 'walk') {
            path.push({ coord: segment.from });
            path.push({ coord: segment.to });
          } else if (segment.type === 'rail') {
            for (const node of segment.railPath.path) {
              path.push({ coord: node.coord });
            }
          } else if (segment.type === 'teleport') {
            path.push({ coord: segment.torii.coord });
            path.push({ coord: segment.destination });
          }
        }
        onRouteFound(path);
      }
    }, 0);
  };

  // 交换起终点
  const handleSwap = () => {
    const temp = startPoint;
    setStartPoint(endPoint);
    setEndPoint(temp);
    setResult(null);
  };

  return (
    <div className="bg-white rounded-lg shadow-lg w-full sm:w-72 max-h-[60vh] sm:max-h-[70vh] flex flex-col">
      {/* 标题 */}
      <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0">
        <h3 className="font-bold text-gray-800">路径规划</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* 模式选择标签栏 */}
      <div className="flex border-b">
        {TRAVEL_MODES.map(({ mode, label, icon: Icon }) => (
          <button
            key={mode}
            className={`flex-1 py-2 px-1 flex flex-col items-center gap-0.5 text-xs transition-colors ${
              travelMode === mode
                ? 'text-blue-600 border-b-2 border-blue-500 bg-blue-50'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
            onClick={() => { setTravelMode(mode); setResult(null); }}
          >
            <Icon className="w-4 h-4" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* 输入区域 */}
      <div className="p-3 border-b">
        <div className="flex items-start gap-2 mb-2">
          <div className="flex-1">
            <PointSearchInput
              value={startPoint}
              onChange={(v) => { setStartPoint(v); setResult(null); }}
              items={searchItems}
              placeholder="输入起点（站点/地标）..."
              label="起点"
            />
          </div>
          <button
            onClick={handleSwap}
            className="mt-6 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
            title="交换起终点"
          >
            <ArrowUpDown className="w-4 h-4" />
          </button>
        </div>

        <div className="mb-2">
          <PointSearchInput
            value={endPoint}
            onChange={(v) => { setEndPoint(v); setResult(null); }}
            items={searchItems}
            placeholder="输入终点（站点/地标）..."
            label="终点"
          />
        </div>

        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            {(travelMode === 'rail' || travelMode === 'auto') && (
              <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={preferLessTransfer}
                  onChange={(e) => {
                    setPreferLessTransfer(e.target.checked);
                    setResult(null);
                  }}
                  className="w-3 h-3"
                />
                <span className="text-gray-600">少换乘</span>
              </label>
            )}
            <label className="flex items-center gap-1.5 cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={useElytra}
                onChange={(e) => {
                  setUseElytra(e.target.checked);
                  setResult(null);
                }}
                className="w-3 h-3"
              />
              <span className="text-gray-600">鞘翅</span>
            </label>
          </div>

          <button
            onClick={handleSearch}
            disabled={!startPoint || !endPoint || searching}
            className="px-4 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-xs font-medium"
          >
            {searching ? '搜索中...' : '搜索'}
          </button>
        </div>
      </div>

      {/* 结果区域 */}
      {result && (
        <div className="flex-1 overflow-y-auto p-3">
          {result.found ? (
            <>
              {/* 统计信息 */}
              <div className="flex items-center gap-3 mb-3 text-xs flex-wrap">
                {/* 预估时间 */}
                <div className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-gray-400" />
                  <span className="text-gray-500">预计:</span>
                  <span className="font-medium text-orange-600">{formatTime(calculateEstimatedTime(result, useElytra))}</span>
                </div>
                {result.totalTransfers > 0 && (
                  <div className="flex items-center gap-1">
                    <span className="text-gray-500">换乘:</span>
                    <span className="font-medium text-blue-600">{result.totalTransfers}次</span>
                  </div>
                )}
                {result.teleportCount > 0 && (
                  <div className="flex items-center gap-1">
                    <span className="text-gray-500">传送:</span>
                    <span className="font-medium text-purple-600">{result.teleportCount}次</span>
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <span className="text-gray-500">{useElytra ? '飞行' : '步行'}:</span>
                  <span className="font-medium">{Math.round(result.totalWalkDistance)}m</span>
                </div>
                {result.totalRailDistance > 0 && (
                  <div className="flex items-center gap-1">
                    <span className="text-gray-500">铁路:</span>
                    <span className="font-medium">{Math.round(result.totalRailDistance)}m</span>
                  </div>
                )}
              </div>

              {/* 鞘翅消耗信息 */}
              {useElytra && result.totalWalkDistance > 0 && (() => {
                const consumption = calculateElytraConsumption(result.totalWalkDistance);
                return (
                  <div className="bg-amber-50 rounded p-2 mb-3 text-xs">
                    <div className="flex items-center gap-1 mb-1 text-amber-700 font-medium">
                      <Rocket className="w-3 h-3" />
                      <span>鞘翅飞行消耗</span>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap text-gray-600">
                      <div className="flex items-center gap-1">
                        <Rocket className="w-3 h-3 text-red-500" />
                        <span>烟花: </span>
                        <span className="font-medium text-red-600">~{consumption.fireworksUsed}个</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Shield className="w-3 h-3 text-cyan-500" />
                        <span>耐久: </span>
                        <span className="font-medium text-cyan-600">
                          {Math.round(consumption.durabilityUsed / 432 * 100)}%
                        </span>
                        <span className="text-gray-400">
                          ({Math.round(consumption.durabilityUsedUnbreaking / 432 * 100)}% 耐久III)
                        </span>
                      </div>
                    </div>
                    {consumption.elytraCount > 1 && (
                      <div className="mt-1 text-amber-600">
                        ⚠️ 需要 {consumption.elytraCount} 个鞘翅（或 {consumption.elytraCountUnbreaking} 个耐久III鞘翅）
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* 路线详情 */}
              <div className="space-y-2">
                {result.segments.map((segment, index) => {
                  if (segment.type === 'walk') {
                    const walkTime = calculateWalkTime(segment.distance, useElytra);
                    return (
                      <div key={index} className="relative pl-5">
                        {index < result.segments.length - 1 && (
                          <div className="absolute left-[7px] top-5 bottom-0 w-0.5 bg-gray-200" />
                        )}
                        <div className="absolute left-0 top-0.5 w-4 h-4 rounded-full bg-green-500 text-white flex items-center justify-center">
                          <Footprints className="w-2.5 h-2.5" />
                        </div>
                        <div className="bg-green-50 rounded p-2">
                          <div className="text-[10px] text-green-600 font-medium mb-0.5">
                            {useElytra ? '飞行' : '步行'} {Math.round(segment.distance)}m
                            <span className="text-gray-400 ml-1">({formatTime(walkTime)})</span>
                          </div>
                          <div className="text-xs text-gray-800">
                            <button
                              className="text-green-700 hover:underline"
                              onClick={() => onPointClick?.(segment.from)}
                            >
                              ({Math.round(segment.from.x)}, {Math.round(segment.from.z)})
                            </button>
                            <span className="text-gray-400 mx-1">→</span>
                            <button
                              className="text-green-700 hover:underline"
                              onClick={() => onPointClick?.(segment.to)}
                            >
                              ({Math.round(segment.to.x)}, {Math.round(segment.to.z)})
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  if (segment.type === 'teleport') {
                    // 判断是正向传送（鸟居→中转点）还是反向传送（中转点→鸟居）
                    const isReverseTP = segment.isReverse || segment.destinationName === segment.torii.name;
                    const toriiLabel = `#${segment.torii.id} ${segment.torii.name}`;

                    let fromName: string;
                    let toName: string;

                    if (isReverseTP) {
                      // 反向传送：从中转点传送到鸟居
                      const prevSegment = index > 0 ? result.segments[index - 1] : null;
                      if (prevSegment?.type === 'teleport') {
                        fromName = prevSegment.destinationName;
                      } else {
                        // 找不到上一个传送段，使用默认名称
                        fromName = segment.destinationName !== segment.torii.name
                          ? segment.destinationName
                          : '中转点';
                      }
                      toName = toriiLabel;
                    } else {
                      // 正向传送：任意位置 → 中转点（海风湾/世界中心）
                      // 显示鸟居编号作为参考
                      fromName = `任意位置 (${toriiLabel})`;
                      toName = segment.destinationName;
                    }

                    return (
                      <div key={index} className="relative pl-5">
                        {index < result.segments.length - 1 && (
                          <div className="absolute left-[7px] top-5 bottom-0 w-0.5 bg-gray-200" />
                        )}
                        <div className="absolute left-0 top-0.5 w-4 h-4 rounded-full bg-purple-500 text-white flex items-center justify-center">
                          <Zap className="w-2.5 h-2.5" />
                        </div>
                        <div className="bg-purple-50 rounded p-2">
                          <div className="text-[10px] text-purple-600 font-medium mb-0.5">
                            传送 → {toName}
                            {isReverseTP && <span className="text-gray-400 ml-1">(+30秒)</span>}
                          </div>
                          <div className="text-xs text-gray-800">
                            <button
                              className="text-purple-700 hover:underline"
                              onClick={() => onPointClick?.(isReverseTP ? segment.destination : segment.torii.coord)}
                            >
                              {fromName}
                            </button>
                            <span className="text-gray-400 mx-1">→</span>
                            <button
                              className="text-purple-700 hover:underline"
                              onClick={() => onPointClick?.(isReverseTP ? segment.torii.coord : segment.destination)}
                            >
                              {toName}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  if (segment.type === 'rail') {
                    const railSegments = simplifyPath(segment.railPath.path);
                    // 计算每段的大致距离（基于总距离/段数的简化估算）
                    const totalRailDist = segment.railPath.totalDistance;
                    const avgDistPerSeg = railSegments.length > 0 ? totalRailDist / railSegments.length : 0;

                    return railSegments.map((railSeg, railIndex) => {
                      // 计算此段的距离（简化：使用起终点坐标估算）
                      const segDist = Math.sqrt(
                        Math.pow(railSeg.endCoord.x - railSeg.startCoord.x, 2) +
                        Math.pow(railSeg.endCoord.z - railSeg.startCoord.z, 2)
                      );
                      const segTime = calculateRailTime(segDist || avgDistPerSeg);

                      return (
                        <div key={`${index}-${railIndex}`} className="relative pl-5">
                          {(railIndex < railSegments.length - 1 || index < result.segments.length - 1) && (
                            <div className="absolute left-[7px] top-5 bottom-0 w-0.5 bg-gray-200" />
                          )}
                          <div className="absolute left-0 top-0.5 w-4 h-4 rounded-full bg-blue-500 text-white text-[10px] flex items-center justify-center">
                            <Train className="w-2.5 h-2.5" />
                          </div>
                          <div className="bg-blue-50 rounded p-2">
                            <div className="text-[10px] text-blue-600 font-medium mb-0.5">
                              {formatLineName(railSeg.lineId)}
                              <span className="text-gray-400 ml-1">({formatTime(segTime)})</span>
                            </div>
                            <div className="text-xs text-gray-800">
                              <button
                                className="hover:underline hover:text-blue-600"
                                onClick={() => onPointClick?.(railSeg.startCoord)}
                              >
                                {railSeg.stations[0]}
                              </button>
                              {railSeg.stations.length > 2 && (
                                <span className="text-gray-400 mx-1">
                                  → {railSeg.stations.length - 2}站 →
                                </span>
                              )}
                              {railSeg.stations.length === 2 && (
                                <span className="text-gray-400 mx-1">→</span>
                              )}
                              {railSeg.stations.length > 1 && (
                                <button
                                  className="hover:underline hover:text-blue-600"
                                  onClick={() => onPointClick?.(railSeg.endCoord)}
                                >
                                  {railSeg.stations[railSeg.stations.length - 1]}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    });
                  }

                  return null;
                })}
              </div>
            </>
          ) : (
            <div className="text-center text-gray-500 py-4 text-sm">
              {startPoint?.coord.x === endPoint?.coord.x && startPoint?.coord.z === endPoint?.coord.z
                ? '起点和终点相同'
                : '未找到可用路线'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default NavigationPanel;
