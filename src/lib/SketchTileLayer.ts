/**
 * 手绘素描风格瓦片图层
 * 基于 DynmapTileLayer，使用 Canvas 实时应用 Sobel 边缘检测滤镜
 */

import * as L from 'leaflet';
import { DynmapTileLayerOptions } from './DynmapTileLayer';

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
      this.applySketchFilter(canvas, ctx);
      done(undefined, canvas);
    };

    img.onerror = () => {
      done(new Error('Tile load failed'), canvas);
    };

    img.src = this.getTileUrl(coords);

    return canvas;
  }

  /**
   * 应用手绘素描滤镜
   * 使用 Sobel 边缘检测算法提取轮廓
   */
  private applySketchFilter(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { width, height, data } = imageData;
    const pixelCount = width * height;

    // 1. 转换为灰度图
    const gray = new Float32Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      const pixelIdx = i * 4;
      gray[i] = 0.299 * data[pixelIdx] + 0.587 * data[pixelIdx + 1] + 0.114 * data[pixelIdx + 2];
    }

    // 2. Sobel 边缘检测
    const edges = new Float32Array(pixelCount);
    let maxEdge = 0;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;

        // Sobel X 卷积核
        const gx =
          -gray[idx - width - 1] + gray[idx - width + 1] +
          -2 * gray[idx - 1] + 2 * gray[idx + 1] +
          -gray[idx + width - 1] + gray[idx + width + 1];

        // Sobel Y 卷积核
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

    // 3. 归一化并生成素描效果（白底黑线）
    for (let i = 0; i < pixelCount; i++) {
      const pixelIdx = i * 4;
      const edgeIntensity = Math.min(1, (edges[i] / maxEdge) * 2.5);
      const intensity = Math.round(255 * (1 - edgeIntensity));

      // 添加轻微的暖色调，模拟纸张效果
      data[pixelIdx] = Math.min(255, intensity + 8);       // R
      data[pixelIdx + 1] = Math.min(255, intensity + 4);   // G
      data[pixelIdx + 2] = intensity;                       // B
      data[pixelIdx + 3] = 255;                             // A
    }

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
