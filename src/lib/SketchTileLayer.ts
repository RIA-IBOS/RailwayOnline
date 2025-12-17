/**
 * 手绘素描风格瓦片图层
 * 基于 DynmapTileLayer，使用 Canvas 实时应用 Sobel 边缘检测滤镜
 * 增强版：地形智能着色 + 纸张纹理叠加
 */

import * as L from 'leaflet';
import { DynmapTileLayerOptions } from './DynmapTileLayer';

// ============ 颜色工具函数 ============

/**
 * RGB 转 HSL
 */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      break;
    case g:
      h = ((b - r) / d + 2) / 6;
      break;
    case b:
      h = ((r - g) / d + 4) / 6;
      break;
  }

  return { h: h * 360, s, l };
}

// ============ 地形分类 ============

type TerrainType = 'water' | 'forest' | 'sand' | 'building' | 'road' | 'default';

/**
 * 根据颜色分类地形类型
 */
function classifyTerrain(r: number, g: number, b: number): TerrainType {
  const { h, s, l } = rgbToHsl(r, g, b);

  // 水域：蓝色调，中等饱和度
  if (h >= 180 && h <= 260 && s > 0.25 && l > 0.2 && l < 0.7) {
    return 'water';
  }

  // 森林/植被：绿色调
  if (h >= 60 && h <= 170 && s > 0.15 && l > 0.15 && l < 0.6) {
    return 'forest';
  }

  // 沙地/泥土：黄色/橙色调
  if (h >= 20 && h <= 50 && s > 0.2 && l > 0.3 && l < 0.7) {
    return 'sand';
  }

  // 道路/石头：灰色调（低饱和度，中等亮度）
  if (s < 0.12 && l > 0.35 && l < 0.65) {
    return 'road';
  }

  // 建筑物：较亮的灰色
  if (s < 0.15 && l > 0.5 && l < 0.85) {
    return 'building';
  }

  return 'default';
}

// 地形对应的淡彩色调（手绘地图风格）
const TERRAIN_COLORS: Record<TerrainType, { r: number; g: number; b: number }> = {
  water: { r: 180, g: 210, b: 230 },    // 淡蓝色
  forest: { r: 195, g: 220, b: 185 },   // 淡绿色
  sand: { r: 235, g: 220, b: 190 },     // 淡黄/米色
  road: { r: 225, g: 220, b: 215 },     // 浅灰色
  building: { r: 235, g: 230, b: 225 }, // 淡灰白
  default: { r: 248, g: 244, b: 236 },  // 羊皮纸白
};

// ============ 纸张纹理 ============

// 简单的伪随机数生成器（用于确定性噪声）
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

/**
 * 添加纸张纹理效果
 */
function addPaperTexture(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  tileX: number,
  tileY: number
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;

      // 使用瓦片坐标作为种子，确保相邻瓦片纹理连续
      const globalX = tileX * width + x;
      const globalY = tileY * height + y;

      // 多层噪声叠加，模拟纸张纤维
      const noise1 = seededRandom(globalX * 0.1 + globalY * 0.1) * 8;
      const noise2 = seededRandom(globalX * 0.05 + globalY * 0.07 + 100) * 4;
      const noise3 = seededRandom(globalX * 0.02 + globalY * 0.03 + 200) * 2;

      const textureValue = noise1 + noise2 + noise3 - 7; // 中心化

      // 应用纹理（轻微变暗）
      data[i] = Math.max(0, Math.min(255, data[i] + textureValue));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + textureValue));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + textureValue - 2)); // 蓝色稍微减少，偏暖
    }
  }
}

/**
 * 手绘风格瓦片图层类
 * 继承 Leaflet TileLayer，实现与 DynmapTileLayer 相同的 URL 生成逻辑
 */
export class SketchTileLayer extends L.TileLayer {
  private _baseUrl: string;
  private _prefix: string;
  private _imageFormat: string;
  private _extraZoomLevels: number;
  private _nightAndDay: boolean;
  private _isNight: boolean;

  constructor(options: DynmapTileLayerOptions) {
    super('', {
      ...options,
      tileSize: 128,
      zoomReverse: true,
      detectRetina: false,
      errorTileUrl: ''
    });

    this._baseUrl = options.baseUrl;
    this._prefix = options.prefix;
    this._imageFormat = options.imageFormat || 'jpg';
    this._extraZoomLevels = options.extraZoomLevels || 0;
    this._nightAndDay = options.nightAndDay || false;
    this._isNight = options.isNight || true;
  }

  /**
   * 生成缩放前缀
   */
  private zoomPrefix(amount: number): string {
    if (amount === 0) return '';
    return 'z'.repeat(amount);
  }

  /**
   * 获取瓦片信息
   */
  private getTileInfo(coords: L.Coords): {
    prefix: string;
    nightday: string;
    scaledx: number;
    scaledy: number;
    zoom: string;
    x: number;
    y: number;
    fmt: string;
  } {
    const maxZoom = this.options.maxZoom || 6;
    const izoom = maxZoom - coords.z;
    const zoomoutlevel = Math.max(0, izoom - this._extraZoomLevels);
    const scale = 1 << zoomoutlevel;

    const x = scale * coords.x;
    const y = scale * -coords.y;

    return {
      prefix: this._prefix,
      nightday: (this._nightAndDay && !this._isNight) ? '_day' : '',
      scaledx: x >> 5,
      scaledy: y >> 5,
      zoom: this.zoomPrefix(zoomoutlevel),
      x: x,
      y: y,
      fmt: this._imageFormat
    };
  }

  /**
   * 重写获取瓦片 URL 的方法
   */
  getTileUrl(coords: L.Coords): string {
    const info = this.getTileInfo(coords);
    const zoomPart = info.zoom ? `${info.zoom}_` : '';
    return `${this._baseUrl}${info.prefix}${info.nightday}/${info.scaledx}_${info.scaledy}/${zoomPart}${info.x}_${info.y}.${info.fmt}`;
  }

  /**
   * 重写 createTile 方法，返回 Canvas 而非 img
   */
  createTile(coords: L.Coords, done: L.DoneCallback): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;

    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        done(new Error('Failed to get canvas context'), canvas);
        return;
      }
      ctx.drawImage(img, 0, 0, 128, 128);
      this.applySketchFilter(canvas, ctx, coords.x, coords.y);
      done(undefined, canvas);
    };

    img.onerror = () => {
      done(new Error('Tile load failed'), canvas);
    };

    img.src = this.getTileUrl(coords);

    return canvas;
  }

  /**
   * 应用手绘素描滤镜（增强版）
   * 包含：Sobel 边缘检测 + 地形智能着色 + 纸张纹理
   */
  private applySketchFilter(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    tileX: number,
    tileY: number
  ): void {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { width, height, data } = imageData;
    const pixelCount = width * height;

    // 1. 保存原始颜色用于地形分类
    const originalColors = new Uint8Array(pixelCount * 3);
    const gray = new Float32Array(pixelCount);

    for (let i = 0; i < pixelCount; i++) {
      const pixelIdx = i * 4;
      const r = data[pixelIdx];
      const g = data[pixelIdx + 1];
      const b = data[pixelIdx + 2];

      originalColors[i * 3] = r;
      originalColors[i * 3 + 1] = g;
      originalColors[i * 3 + 2] = b;

      // 同时计算灰度
      gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }

    // 2. Sobel 边缘检测
    const edges = new Float32Array(pixelCount);
    let maxEdge = 0;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;

        const gx =
          -gray[idx - width - 1] + gray[idx - width + 1] +
          -2 * gray[idx - 1] + 2 * gray[idx + 1] +
          -gray[idx + width - 1] + gray[idx + width + 1];

        const gy =
          -gray[idx - width - 1] - 2 * gray[idx - width] - gray[idx - width + 1] +
          gray[idx + width - 1] + 2 * gray[idx + width] + gray[idx + width + 1];

        const magnitude = Math.sqrt(gx * gx + gy * gy);
        edges[idx] = magnitude;
        if (magnitude > maxEdge) {
          maxEdge = magnitude;
        }
      }
    }

    if (maxEdge === 0) maxEdge = 1;

    // 3. 地形智能着色 + 边缘线条
    for (let i = 0; i < pixelCount; i++) {
      const pixelIdx = i * 4;

      // 获取原始颜色
      const r = originalColors[i * 3];
      const g = originalColors[i * 3 + 1];
      const b = originalColors[i * 3 + 2];

      // 分类地形
      const terrain = classifyTerrain(r, g, b);
      const baseColor = TERRAIN_COLORS[terrain];

      // 边缘强度（增强对比度）
      const edgeIntensity = Math.min(1, (edges[i] / maxEdge) * 3);

      // 线条颜色（深褐色，更有手绘感）
      const lineR = 45;
      const lineG = 35;
      const lineB = 25;

      // 混合：背景淡彩 + 边缘线条
      data[pixelIdx] = Math.round(baseColor.r * (1 - edgeIntensity) + lineR * edgeIntensity);
      data[pixelIdx + 1] = Math.round(baseColor.g * (1 - edgeIntensity) + lineG * edgeIntensity);
      data[pixelIdx + 2] = Math.round(baseColor.b * (1 - edgeIntensity) + lineB * edgeIntensity);
      data[pixelIdx + 3] = 255;
    }

    // 4. 叠加纸张纹理
    addPaperTexture(data, width, height, tileX, tileY);

    ctx.putImageData(imageData, 0, 0);
  }
}

/**
 * 创建手绘风格瓦片图层的工厂函数
 */
export function createSketchTileLayer(
  worldId: string,
  mapName: string = 'flat',
  options?: Partial<DynmapTileLayerOptions>
): SketchTileLayer {
  const defaultOptions: DynmapTileLayerOptions = {
    // 使用 Vercel 代理路径来避免 CORS 问题
    baseUrl: `/api/dynmap/_${worldId}/tiles/world/`,
    prefix: mapName,
    imageFormat: 'jpg',
    extraZoomLevels: 2,
    maxZoom: 5,
    maxNativeZoom: 3,
    minZoom: 0,
    nightAndDay: false,
    isNight: true,
    attribution: '&copy; <a href="https://satellite.ria.red">RIA Satellite</a> | 素描风格'
  };

  const merged: DynmapTileLayerOptions = {
    ...defaultOptions,
    ...options
  };

  if (merged.maxNativeZoom === undefined && typeof merged.maxZoom === 'number') {
    merged.maxNativeZoom = Math.max(0, merged.maxZoom - (merged.extraZoomLevels || 0));
  }

  return new SketchTileLayer(merged);
}
