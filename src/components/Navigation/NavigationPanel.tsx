/**
 * 导航面板组件
 * 提供起终点选择和路径规划功能
 */

import { useState, useEffect } from 'react';
import type { ParsedStation, ParsedLine, Coordinate } from '@/types';
import { buildRailwayGraph, findShortestPath, simplifyPath, PathResult } from '@/lib/pathfinding';

interface NavigationPanelProps {
  stations: ParsedStation[];
  lines: ParsedLine[];
  onRouteFound?: (path: Array<{ coord: Coordinate }>) => void;
  onClose: () => void;
}

export function NavigationPanel({
  stations,
  lines,
  onRouteFound,
  onClose,
}: NavigationPanelProps) {
  const [startStation, setStartStation] = useState('');
  const [endStation, setEndStation] = useState('');
  const [preferLessTransfer, setPreferLessTransfer] = useState(true);
  const [result, setResult] = useState<PathResult | null>(null);
  const [searching, setSearching] = useState(false);

  // 站点名称列表（去重并排序）
  const stationNames = [...new Set(stations.map(s => s.name))].sort();

  // 搜索路径
  const handleSearch = () => {
    if (!startStation || !endStation) return;
    if (startStation === endStation) {
      setResult({
        found: false,
        path: [],
        transfers: 0,
        totalDistance: 0,
        lines: [],
      });
      return;
    }

    setSearching(true);

    // 构建图并搜索
    setTimeout(() => {
      const graph = buildRailwayGraph(lines);
      const pathResult = findShortestPath(graph, startStation, endStation, preferLessTransfer);
      setResult(pathResult);
      setSearching(false);

      // 通知父组件路径
      if (pathResult.found && onRouteFound) {
        onRouteFound(pathResult.path);
      }
    }, 0);
  };

  // 交换起终点
  const handleSwap = () => {
    const temp = startStation;
    setStartStation(endStation);
    setEndStation(temp);
    setResult(null);
  };

  // 简化路径显示
  const segments = result?.found ? simplifyPath(result.path) : [];

  return (
    <div className="bg-white rounded-lg shadow-lg w-80 max-h-[80vh] flex flex-col">
      {/* 标题 */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="font-bold text-gray-800">路径规划</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 输入区域 */}
      <div className="p-4 border-b">
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1">
            <label className="text-xs text-gray-500 mb-1 block">起点</label>
            <select
              value={startStation}
              onChange={(e) => {
                setStartStation(e.target.value);
                setResult(null);
              }}
              className="w-full px-3 py-2 border rounded text-sm"
            >
              <option value="">选择起点...</option>
              {stationNames.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleSwap}
            className="mt-5 p-2 text-gray-400 hover:text-gray-600"
            title="交换起终点"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>
        </div>

        <div className="mb-3">
          <label className="text-xs text-gray-500 mb-1 block">终点</label>
          <select
            value={endStation}
            onChange={(e) => {
              setEndStation(e.target.value);
              setResult(null);
            }}
            className="w-full px-3 py-2 border rounded text-sm"
          >
            <option value="">选择终点...</option>
            {stationNames.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={preferLessTransfer}
              onChange={(e) => {
                setPreferLessTransfer(e.target.checked);
                setResult(null);
              }}
              className="w-4 h-4"
            />
            <span className="text-gray-700">优先减少换乘</span>
          </label>
        </div>

        <button
          onClick={handleSearch}
          disabled={!startStation || !endStation || searching}
          className="w-full py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm font-medium"
        >
          {searching ? '搜索中...' : '搜索路线'}
        </button>
      </div>

      {/* 结果区域 */}
      {result && (
        <div className="flex-1 overflow-y-auto p-4">
          {result.found ? (
            <>
              {/* 统计信息 */}
              <div className="flex items-center gap-4 mb-4 text-sm">
                <div className="flex items-center gap-1">
                  <span className="text-gray-500">换乘:</span>
                  <span className="font-medium">{result.transfers}次</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-gray-500">距离:</span>
                  <span className="font-medium">{Math.round(result.totalDistance)}m</span>
                </div>
              </div>

              {/* 路线详情 */}
              <div className="space-y-3">
                {segments.map((segment, index) => (
                  <div key={index} className="relative pl-6">
                    {/* 连接线 */}
                    {index < segments.length - 1 && (
                      <div className="absolute left-2 top-6 bottom-0 w-0.5 bg-gray-200" />
                    )}

                    {/* 线路标识 */}
                    <div className="absolute left-0 top-1 w-4 h-4 rounded-full bg-blue-500 text-white text-xs flex items-center justify-center">
                      {index + 1}
                    </div>

                    {/* 线路信息 */}
                    <div className="bg-gray-50 rounded p-2">
                      <div className="text-xs text-blue-600 font-medium mb-1">
                        {segment.lineId}
                      </div>
                      <div className="text-sm text-gray-800">
                        {segment.stations[0]}
                        {segment.stations.length > 2 && (
                          <span className="text-gray-400 mx-1">
                            → ({segment.stations.length - 2}站) →
                          </span>
                        )}
                        {segment.stations.length === 2 && (
                          <span className="text-gray-400 mx-1">→</span>
                        )}
                        {segment.stations.length > 1 && segment.stations[segment.stations.length - 1]}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-center text-gray-500 py-4">
              {startStation === endStation ? '起点和终点相同' : '未找到可用路线'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default NavigationPanel;
