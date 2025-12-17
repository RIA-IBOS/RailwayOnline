/**
 * RMP SVG 地图视图组件
 * 将 RMP JSON 数据渲染为可交互的 SVG 路线图
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, Maximize, Minimize } from 'lucide-react';
import {
  edgeToSVGPath,
  getEdgeColor,
  getStationName,
  getStationColor,
  getLineBadgeInfo,
} from '@/lib/rmpSvgRenderer';

// RMP 数据类型
interface RMPNode {
  key: string;
  attributes: {
    visible: boolean;
    zIndex: number;
    x: number;
    y: number;
    type: string;
    'bjsubway-int'?: {
      names: string[];
      nameOffsetX: string;
      nameOffsetY: string;
    };
    'bjsubway-basic'?: {
      names: string[];
      nameOffsetX: string;
      nameOffsetY: string;
    };
    'suzhourt-basic'?: {
      names: string[];
      color: string[];
      nameOffsetX: string;
      nameOffsetY: string;
    };
    'shmetro-int'?: {
      names: string[];
      nameOffsetX: string;
      nameOffsetY: string;
    };
    'bjsubway-text-line-badge'?: {
      names: string[];
      color: string[];
    };
  };
}

interface RMPEdge {
  key: string;
  source: string;
  target: string;
  attributes: {
    visible: boolean;
    zIndex: number;
    type: string;
    style: string;
    'single-color'?: { color: string[] };
    'bjsubway-dotted'?: { color: string[] };
    'mrt-under-constr'?: { color: string[] };
    perpendicular?: {
      startFrom: 'from' | 'to';
      offsetFrom: number;
      offsetTo: number;
      roundCornerFactor: number;
    };
    diagonal?: {
      startFrom: 'from' | 'to';
      offsetFrom: number;
      offsetTo: number;
      roundCornerFactor: number;
    };
    simple?: {
      offset: number;
    };
  };
}

interface RMPData {
  svgViewBoxZoom: number;
  svgViewBoxMin: { x: number; y: number };
  graph: {
    nodes: RMPNode[];
    edges: RMPEdge[];
  };
}

interface RMPMapViewProps {
  rmpData: RMPData;
  onStationClick?: (station: { name: string; x: number; y: number }) => void;
}

export function RMPMapView({ rmpData, onStationClick }: RMPMapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [selectedStation, setSelectedStation] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 构建节点映射
  const nodeMap = useMemo(() => {
    const map = new Map<string, RMPNode>();
    for (const node of rmpData.graph.nodes) {
      map.set(node.key, node);
    }
    return map;
  }, [rmpData]);

  // 计算边界
  const bounds = useMemo(() => {
    const nodes = rmpData.graph.nodes;
    if (nodes.length === 0) {
      return { minX: -100, maxX: 100, minY: -100, maxY: 100 };
    }

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const node of nodes) {
      const x = node.attributes.x;
      const y = node.attributes.y;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    // 添加边距
    const padding = 50;
    return {
      minX: minX - padding,
      maxX: maxX + padding,
      minY: minY - padding,
      maxY: maxY + padding,
    };
  }, [rmpData]);

  const viewBoxWidth = bounds.maxX - bounds.minX;
  const viewBoxHeight = bounds.maxY - bounds.minY;

  // 初始化居中
  useEffect(() => {
    if (containerRef.current) {
      const { width, height } = containerRef.current.getBoundingClientRect();
      const scaleX = width / viewBoxWidth;
      const scaleY = height / viewBoxHeight;
      const initialScale = Math.min(scaleX, scaleY) * 0.9;

      setTransform({
        x: width / 2,
        y: height / 2,
        scale: initialScale,
      });
    }
  }, [viewBoxWidth, viewBoxHeight]);

  // 缩放处理
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform(prev => ({
      ...prev,
      scale: Math.max(0.1, Math.min(10, prev.scale * delta)),
    }));
  }, []);

  // 拖拽处理
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
  }, [transform]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setTransform(prev => ({
      ...prev,
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    }));
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // 触摸事件处理
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      setDragStart({
        x: e.touches[0].clientX - transform.x,
        y: e.touches[0].clientY - transform.y,
      });
    }
  }, [transform]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging || e.touches.length !== 1) return;
    setTransform(prev => ({
      ...prev,
      x: e.touches[0].clientX - dragStart.x,
      y: e.touches[0].clientY - dragStart.y,
    }));
  }, [isDragging, dragStart]);

  // 缩放按钮
  const zoomIn = () => setTransform(prev => ({ ...prev, scale: prev.scale * 1.2 }));
  const zoomOut = () => setTransform(prev => ({ ...prev, scale: prev.scale / 1.2 }));
  const resetView = () => {
    if (containerRef.current) {
      const { width, height } = containerRef.current.getBoundingClientRect();
      const scaleX = width / viewBoxWidth;
      const scaleY = height / viewBoxHeight;
      const initialScale = Math.min(scaleX, scaleY) * 0.9;
      setTransform({ x: width / 2, y: height / 2, scale: initialScale });
    }
  };

  // 站点点击处理
  const handleStationClick = useCallback((node: RMPNode) => {
    const name = getStationName(node);
    if (name) {
      setSelectedStation(prev => prev === node.key ? null : node.key);
      onStationClick?.({
        name,
        x: node.attributes.x,
        y: node.attributes.y,
      });
    }
  }, [onStationClick]);

  // 渲染边
  const renderEdges = useMemo(() => {
    return rmpData.graph.edges
      .filter(edge => edge.attributes.visible)
      .sort((a, b) => a.attributes.zIndex - b.attributes.zIndex)
      .map(edge => {
        const fromNode = nodeMap.get(edge.source);
        const toNode = nodeMap.get(edge.target);
        if (!fromNode || !toNode) return null;

        const from = { x: fromNode.attributes.x, y: fromNode.attributes.y };
        const to = { x: toNode.attributes.x, y: toNode.attributes.y };
        const color = getEdgeColor(edge);
        const isDotted = edge.attributes.style === 'bjsubway-dotted' ||
                        edge.attributes.style === 'mrt-under-constr';

        const pathD = edgeToSVGPath(from, to, edge.attributes);

        return (
          <path
            key={edge.key}
            d={pathD}
            stroke={color}
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={isDotted ? '8,4' : undefined}
            fill="none"
          />
        );
      });
  }, [rmpData.graph.edges, nodeMap]);

  // 渲染站点
  const renderStations = useMemo(() => {
    return rmpData.graph.nodes
      .filter(node => {
        const type = node.attributes.type;
        return (
          type === 'bjsubway-int' ||
          type === 'bjsubway-basic' ||
          type === 'suzhourt-basic' ||
          type === 'shmetro-int'
        );
      })
      .sort((a, b) => a.attributes.zIndex - b.attributes.zIndex)
      .map(node => {
        const { x, y, type } = node.attributes;
        const isSelected = selectedStation === node.key;
        const name = getStationName(node);

        // 获取站点名称偏移
        const getNameOffset = (node: RMPNode): { offsetX: number; offsetY: number } => {
          const attr = node.attributes;
          const typeData =
            attr['bjsubway-int'] ||
            attr['bjsubway-basic'] ||
            attr['suzhourt-basic'] ||
            attr['shmetro-int'];
          if (typeData) {
            return {
              offsetX: parseFloat(typeData.nameOffsetX) || 0,
              offsetY: parseFloat(typeData.nameOffsetY) || -12,
            };
          }
          return { offsetX: 0, offsetY: -12 };
        };

        const nameOffset = getNameOffset(node);

        if (type === 'bjsubway-int' || type === 'shmetro-int') {
          // 换乘站：白色圆形，黑色边框
          return (
            <g key={node.key} onClick={() => handleStationClick(node)} style={{ cursor: 'pointer' }}>
              <circle
                cx={x}
                cy={y}
                r={isSelected ? 8 : 6}
                fill="white"
                stroke={isSelected ? '#3b82f6' : 'black'}
                strokeWidth={isSelected ? 3 : 2}
              />
              {name && (
                <text
                  x={x + nameOffset.offsetX}
                  y={y + nameOffset.offsetY}
                  textAnchor="middle"
                  fontSize="12"
                  fill={isSelected ? '#3b82f6' : '#333'}
                  fontWeight="bold"
                >
                  {name}
                </text>
              )}
            </g>
          );
        }

        if (type === 'suzhourt-basic') {
          const color = getStationColor(node) || '#888';
          return (
            <g key={node.key} onClick={() => handleStationClick(node)} style={{ cursor: 'pointer' }}>
              <circle
                cx={x}
                cy={y}
                r={isSelected ? 5 : 3}
                fill={color}
                stroke={isSelected ? '#3b82f6' : undefined}
                strokeWidth={isSelected ? 2 : 0}
              />
              {name && (
                <text
                  x={x + nameOffset.offsetX}
                  y={y + nameOffset.offsetY}
                  textAnchor="middle"
                  fontSize="10"
                  fill={isSelected ? '#3b82f6' : '#555'}
                  fontWeight={isSelected ? 'bold' : 'normal'}
                >
                  {name}
                </text>
              )}
            </g>
          );
        }

        if (type === 'bjsubway-basic') {
          const color = '#888';
          return (
            <g key={node.key} onClick={() => handleStationClick(node)} style={{ cursor: 'pointer' }}>
              <circle
                cx={x}
                cy={y}
                r={isSelected ? 5 : 4}
                fill="white"
                stroke={isSelected ? '#3b82f6' : color}
                strokeWidth={2}
              />
              {name && (
                <text
                  x={x + nameOffset.offsetX}
                  y={y + nameOffset.offsetY}
                  textAnchor="middle"
                  fontSize="11"
                  fill={isSelected ? '#3b82f6' : '#444'}
                  fontWeight={isSelected ? 'bold' : 'normal'}
                >
                  {name}
                </text>
              )}
            </g>
          );
        }

        return null;
      });
  }, [rmpData.graph.nodes, selectedStation, handleStationClick]);

  // 渲染线路徽章
  const renderBadges = useMemo(() => {
    return rmpData.graph.nodes
      .filter(node => node.attributes.type === 'bjsubway-text-line-badge')
      .map(node => {
        const badge = getLineBadgeInfo(node);
        if (!badge) return null;

        const { x, y } = node.attributes;
        const textWidth = badge.name.length * 8 + 10;

        return (
          <g key={node.key}>
            <rect
              x={x - textWidth / 2}
              y={y - 8}
              width={textWidth}
              height={16}
              rx={4}
              fill={badge.color}
            />
            <text
              x={x}
              y={y + 4}
              textAnchor="middle"
              fontSize="11"
              fill="white"
              fontWeight="bold"
            >
              {badge.name}
            </text>
          </g>
        );
      });
  }, [rmpData.graph.nodes]);

  // 切换全屏
  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
    // 全屏切换后重置视图
    setTimeout(() => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        const scaleX = width / viewBoxWidth;
        const scaleY = height / viewBoxHeight;
        const initialScale = Math.min(scaleX, scaleY) * 0.9;
        setTransform({ x: width / 2, y: height / 2, scale: initialScale });
      }
    }, 100);
  };

  // 中心点偏移
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  const mapContent = (
    <>
      {/* 控制按钮 */}
      <div className="absolute top-2 right-2 z-10 flex flex-col gap-1">
        <button
          onClick={zoomIn}
          className="p-2 bg-white rounded shadow hover:bg-gray-100"
          title="放大"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={zoomOut}
          className="p-2 bg-white rounded shadow hover:bg-gray-100"
          title="缩小"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={resetView}
          className="p-2 bg-white rounded shadow hover:bg-gray-100"
          title="重置视图"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        <button
          onClick={toggleFullscreen}
          className="p-2 bg-white rounded shadow hover:bg-gray-100"
          title={isFullscreen ? "退出全屏" : "全屏"}
        >
          {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
        </button>
      </div>

      {/* SVG 容器 */}
      <div
        ref={containerRef}
        className="w-full h-full"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleMouseUp}
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        <svg
          width="100%"
          height="100%"
          style={{
            overflow: 'visible',
          }}
        >
          <g
            transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale}) translate(${-centerX}, ${-centerY})`}
          >
            {/* 边 */}
            <g>{renderEdges}</g>

            {/* 站点 */}
            <g>{renderStations}</g>

            {/* 线路徽章 */}
            <g>{renderBadges}</g>
          </g>
        </svg>
      </div>

      {/* 提示信息 */}
      <div className="absolute bottom-2 left-2 text-xs text-gray-500">
        滚轮缩放 · 拖拽平移 · 点击站点查看详情
      </div>
    </>
  );

  // 全屏模式
  if (isFullscreen) {
    return (
      <div className="fixed inset-0 bg-gray-50 z-[3000]">
        <div className="relative w-full h-full">
          {mapContent}
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-[500px] bg-gray-50 rounded-lg overflow-hidden border">
      {mapContent}
    </div>
  );
}

export default RMPMapView;
