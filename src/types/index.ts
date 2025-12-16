// 世界配置
export interface WorldConfig {
  id: string;
  name: string;
  title: string;
  center: Coordinate;
  worldHeight: number;
}

// 坐标类型
export interface Coordinate {
  x: number;
  y: number;
  z: number;
}

// Dynmap 地图配置
export interface DynmapMapConfig {
  name: string;
  prefix: string;
  scale: number;
  azimuth: number;
  inclination: number;
  mapzoomout: number;
  mapzoomin: number;
  worldtomap: number[];
  maptoworld: number[];
  imageFormat: string;
}

// 铁路线路信息
export interface LineInfo {
  bureau: string;  // 管理局: R/H/T/G
  line: string;    // 线路号
  stationCode: number;  // 站点编号
  coord: Coordinate;
  distance: number;  // 距前站距离(米)
}

// 特殊情况
export interface SpecialCase {
  type: 'directionNotAvaliable' | 'lineNotAvaliable' | 'throughTrain' | 'lineOvertaking';
  target: {
    bureau?: string;
    line?: string;
    isTrainUp?: boolean;
    bureau1?: string;
    line1?: string;
    bureau2?: string;
    line2?: string;
  };
}

// 车站数据
export interface Station {
  stationName: string;
  lines: LineInfo[];
  specialCases?: SpecialCase[];
}

// 地标数据
export interface Landmark {
  id: number;
  name: string;
  grade: '白级' | '准级' | '标级' | '赤级' | '黑级' | 'Unknown';
  status: 'Normal' | 'Removed';
  coordinates: Coordinate | 'Unknown';
}

// 解析后的线路数据（用于绘制）
export interface ParsedLine {
  bureau: string;
  line: string;
  lineId: string;  // bureau-line 组合
  stations: ParsedStation[];
  color: string;
}

// 解析后的站点数据
export interface ParsedStation {
  name: string;
  coord: Coordinate;
  stationCode: number;
  isTransfer: boolean;  // 是否换乘站
  lines: string[];  // 经过的线路 ID 列表
}

// 地图状态
export interface MapState {
  currentWorld: string;
  zoom: number;
  center: Coordinate;
  showRailway: boolean;
  showLandmarks: boolean;
}
