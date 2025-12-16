/**
 * 导航面板组件
 * 提供起终点搜索和路径规划功能
 */

import { useState, useRef, useEffect } from 'react';
import type { ParsedStation, ParsedLine, Coordinate } from '@/types';
import { buildRailwayGraph, findShortestPath, simplifyPath, PathResult } from '@/lib/pathfinding';

interface NavigationPanelProps {
  stations: ParsedStation[];
  lines: ParsedLine[];
  onRouteFound?: (path: Array<{ coord: Coordinate }>) => void;
  onClose: () => void;
}

// 站点搜索输入组件
interface StationSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  stations: string[];
  placeholder: string;
  label: string;
}

function StationSearchInput({ value, onChange, stations, placeholder, label }: StationSearchInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);

  // 过滤匹配的站点
  const filteredStations = query.length > 0
    ? stations.filter(s => s.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
    : [];

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
    setQuery(value);
  }, [value]);

  const handleSelect = (station: string) => {
    setQuery(station);
    onChange(station);
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
          // 如果完全匹配则设置值
          if (stations.includes(e.target.value)) {
            onChange(e.target.value);
          } else {
            onChange('');
          }
        }}
        onFocus={() => setIsOpen(true)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border rounded text-sm outline-none focus:border-blue-400"
      />

      {/* 下拉搜索结果 */}
      {isOpen && filteredStations.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-lg max-h-48 overflow-y-auto z-50 border">
          {filteredStations.map((station) => (
            <button
              key={station}
              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 border-b border-gray-50 last:border-b-0"
              onClick={() => handleSelect(station)}
            >
              {station}
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
    <div className="bg-white rounded-lg shadow-lg w-72 max-h-[60vh] flex flex-col">
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
      <div className="p-3 border-b">
        <div className="flex items-start gap-2 mb-2">
          <div className="flex-1">
            <StationSearchInput
              value={startStation}
              onChange={(v) => { setStartStation(v); setResult(null); }}
              stations={stationNames}
              placeholder="输入起点站..."
              label="起点"
            />
          </div>
          <button
            onClick={handleSwap}
            className="mt-6 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
            title="交换起终点"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>
        </div>

        <div className="mb-2">
          <StationSearchInput
            value={endStation}
            onChange={(v) => { setEndStation(v); setResult(null); }}
            stations={stationNames}
            placeholder="输入终点站..."
            label="终点"
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer text-xs">
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

          <button
            onClick={handleSearch}
            disabled={!startStation || !endStation || searching}
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
              <div className="flex items-center gap-3 mb-3 text-xs">
                <div className="flex items-center gap-1">
                  <span className="text-gray-500">换乘:</span>
                  <span className="font-medium text-blue-600">{result.transfers}次</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-gray-500">距离:</span>
                  <span className="font-medium">{Math.round(result.totalDistance)}m</span>
                </div>
              </div>

              {/* 路线详情 */}
              <div className="space-y-2">
                {segments.map((segment, index) => (
                  <div key={index} className="relative pl-5">
                    {/* 连接线 */}
                    {index < segments.length - 1 && (
                      <div className="absolute left-[7px] top-5 bottom-0 w-0.5 bg-gray-200" />
                    )}

                    {/* 线路标识 */}
                    <div className="absolute left-0 top-0.5 w-4 h-4 rounded-full bg-blue-500 text-white text-[10px] flex items-center justify-center">
                      {index + 1}
                    </div>

                    {/* 线路信息 */}
                    <div className="bg-gray-50 rounded p-2">
                      <div className="text-[10px] text-blue-600 font-medium mb-0.5">
                        {segment.lineId}
                      </div>
                      <div className="text-xs text-gray-800">
                        {segment.stations[0]}
                        {segment.stations.length > 2 && (
                          <span className="text-gray-400 mx-1">
                            → {segment.stations.length - 2}站 →
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
            <div className="text-center text-gray-500 py-4 text-sm">
              {startStation === endStation ? '起点和终点相同' : '未找到可用路线'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default NavigationPanel;
