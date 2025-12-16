/**
 * 线路详情卡片组件
 * 展示选中线路的详细信息
 */

import type { ParsedLine } from '@/types';
import { getLineLength } from '@/lib/railwayParser';

interface LineDetailCardProps {
  line: ParsedLine;
  onClose: () => void;
  onStationClick?: (stationName: string, coord: { x: number; y: number; z: number }) => void;
}

export function LineDetailCard({ line, onClose, onStationClick }: LineDetailCardProps) {
  const totalLength = Math.round(getLineLength(line));

  return (
    <div className="bg-white rounded-lg shadow-lg w-72 max-h-[50vh] flex flex-col">
      {/* 头部 */}
      <div
        className="px-4 py-3 rounded-t-lg flex items-center justify-between"
        style={{ backgroundColor: line.color }}
      >
        <div className="text-white">
          <h3 className="font-bold text-lg">{line.bureau}局{line.line}号线</h3>
          <p className="text-xs opacity-90">
            {line.stations.length} 站 · {totalLength} 米
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-white/80 hover:text-white p-1"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 站点列表 */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="relative">
          {/* 线路竖线 */}
          <div
            className="absolute left-4 top-4 bottom-4 w-1 rounded"
            style={{ backgroundColor: line.color }}
          />

          {/* 站点 */}
          {line.stations.map((station, index) => {
            const isTerminal = index === 0 || index === line.stations.length - 1;
            return (
              <button
                key={`${station.name}-${index}`}
                className="w-full flex items-center gap-3 py-2 px-2 hover:bg-gray-50 rounded text-left relative"
                onClick={() => onStationClick?.(station.name, station.coord)}
              >
                {/* 站点圆点 */}
                <div
                  className={`relative z-10 rounded-full border-2 ${
                    isTerminal ? 'w-4 h-4' : 'w-3 h-3'
                  }`}
                  style={{
                    backgroundColor: isTerminal ? line.color : '#fff',
                    borderColor: line.color,
                  }}
                />

                {/* 站点信息 */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 truncate">
                    {station.name}
                  </div>
                  {station.isTransfer && (
                    <div className="text-xs text-gray-500 truncate">
                      换乘: {station.lines.filter(l => l !== line.lineId).join(', ')}
                    </div>
                  )}
                </div>

                {/* 坐标 */}
                <div className="text-xs text-gray-400 whitespace-nowrap">
                  {Math.round(station.coord.x)}, {Math.round(station.coord.z)}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default LineDetailCard;
