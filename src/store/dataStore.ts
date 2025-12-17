/**
 * 数据缓存管理 Store
 * 使用 localStorage 实现 7 天缓存
 */

import { create } from 'zustand';
import type { ParsedLine, ParsedStation, BureausConfig } from '@/types';
import { fetchRailwayData, parseRailwayData, getAllStations, fetchBureausConfig } from '@/lib/railwayParser';
import { fetchRMPData, parseRMPData } from '@/lib/rmpParser';
import { fetchLandmarkData, parseLandmarkData } from '@/lib/landmarkParser';
import type { ParsedLandmark } from '@/lib/landmarkParser';

// 缓存有效期：7 天
const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

// localStorage 键前缀
const CACHE_PREFIX = 'ria-cache-';
const CACHE_META_KEY = 'ria-cache-meta';

// RMP 数据文件映射
const RMP_DATA_FILES: Record<string, string> = {
  zth: '/data/rmp_zth.json',
  houtu: '/data/rmp_houtu.json',
};

// 世界列表
const WORLDS = ['zth', 'houtu', 'naraku', 'eden'];

export interface WorldData {
  lines: ParsedLine[];
  stations: ParsedStation[];
  rmpRawData: any | null;
  landmarks: ParsedLandmark[];
}

interface CacheMeta {
  lastUpdated: number;
  version: string;
}

interface CacheInfo {
  lastUpdated: number | null;
  isStale: boolean;
  size: number;
  nextUpdate: number | null;
}

interface DataState {
  // 数据
  worldData: Record<string, WorldData>;
  bureausConfig: BureausConfig;

  // 状态
  isLoading: boolean;
  isLoaded: boolean;
  loadingProgress: {
    current: number;
    total: number;
    currentItem: string;
  };

  // 缓存信息
  cacheInfo: CacheInfo;

  // 方法
  loadAllData: (
    onProgress?: (stage: string, status: 'loading' | 'success' | 'error') => void
  ) => Promise<void>;
  getWorldData: (worldId: string) => WorldData | null;
  clearCache: () => void;
  forceRefresh: (
    onProgress?: (stage: string, status: 'loading' | 'success' | 'error') => void
  ) => Promise<void>;
  updateCacheInfo: () => void;
}

// 从 localStorage 读取缓存
function getFromCache<T>(key: string): T | null {
  try {
    const cached = localStorage.getItem(CACHE_PREFIX + key);
    if (!cached) return null;
    return JSON.parse(cached) as T;
  } catch {
    return null;
  }
}

// 写入 localStorage 缓存
function setToCache(key: string, data: any): void {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(data));
  } catch (e) {
    console.warn('Failed to write cache:', e);
  }
}

// 获取缓存元信息
function getCacheMeta(): CacheMeta | null {
  try {
    const meta = localStorage.getItem(CACHE_META_KEY);
    if (!meta) return null;
    return JSON.parse(meta) as CacheMeta;
  } catch {
    return null;
  }
}

// 设置缓存元信息
function setCacheMeta(meta: CacheMeta): void {
  try {
    localStorage.setItem(CACHE_META_KEY, JSON.stringify(meta));
  } catch (e) {
    console.warn('Failed to write cache meta:', e);
  }
}

// 检查缓存是否过期
function isCacheStale(): boolean {
  const meta = getCacheMeta();
  if (!meta) return true;
  return Date.now() - meta.lastUpdated > CACHE_MAX_AGE;
}

// 计算缓存大小
function calculateCacheSize(): number {
  let size = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(CACHE_PREFIX) || key === CACHE_META_KEY) {
      const value = localStorage.getItem(key);
      if (value) {
        size += key.length + value.length;
      }
    }
  }
  return size * 2; // UTF-16 编码，每字符 2 字节
}

export const useDataStore = create<DataState>((set, get) => ({
  worldData: {},
  bureausConfig: {},
  isLoading: false,
  isLoaded: false,
  loadingProgress: {
    current: 0,
    total: 0,
    currentItem: '',
  },
  cacheInfo: {
    lastUpdated: null,
    isStale: true,
    size: 0,
    nextUpdate: null,
  },

  loadAllData: async (onProgress) => {
    const state = get();
    if (state.isLoading) return;

    set({ isLoading: true });

    // 检查缓存是否有效
    const cacheStale = isCacheStale();
    const meta = getCacheMeta();

    if (!cacheStale && meta) {
      // 从缓存加载
      const worldData: Record<string, WorldData> = {};
      const bureausConfig = getFromCache<BureausConfig>('bureaus') || {};

      for (const worldId of WORLDS) {
        const cached = getFromCache<WorldData>(`world-${worldId}`);
        if (cached) {
          worldData[worldId] = cached;
        }
      }

      set({
        worldData,
        bureausConfig,
        isLoading: false,
        isLoaded: true,
        cacheInfo: {
          lastUpdated: meta.lastUpdated,
          isStale: false,
          size: calculateCacheSize(),
          nextUpdate: meta.lastUpdated + CACHE_MAX_AGE,
        },
      });
      return;
    }

    // 从网络加载
    const worldData: Record<string, WorldData> = {};
    let bureausConfig: BureausConfig = {};

    // 加载铁路局配置
    onProgress?.('bureaus', 'loading');
    try {
      bureausConfig = await fetchBureausConfig();
      setToCache('bureaus', bureausConfig);
      onProgress?.('bureaus', 'success');
    } catch {
      onProgress?.('bureaus', 'error');
    }

    // 加载每个世界的数据
    for (const worldId of WORLDS) {
      // 铁路数据
      onProgress?.(`${worldId}-railway`, 'loading');
      try {
        const railwayData = await fetchRailwayData(worldId);
        const { lines: riaLines } = parseRailwayData(railwayData);
        const riaStations = getAllStations(riaLines);

        // RMP 数据
        let rmpLines: ParsedLine[] = [];
        let rmpStations: ParsedStation[] = [];
        let rmpRawData: any = null;

        const rmpFile = RMP_DATA_FILES[worldId];
        if (rmpFile) {
          onProgress?.(`${worldId}-rmp`, 'loading');
          try {
            const rmpData = await fetchRMPData(rmpFile);
            rmpRawData = rmpData;
            const parsed = parseRMPData(rmpData, worldId);
            rmpLines = parsed.lines;
            rmpStations = parsed.stations;
            onProgress?.(`${worldId}-rmp`, 'success');
          } catch {
            onProgress?.(`${worldId}-rmp`, 'error');
          }
        }

        // 地标数据
        onProgress?.(`${worldId}-landmark`, 'loading');
        let landmarks: ParsedLandmark[] = [];
        try {
          const landmarkData = await fetchLandmarkData(worldId);
          landmarks = parseLandmarkData(landmarkData);
          onProgress?.(`${worldId}-landmark`, 'success');
        } catch {
          onProgress?.(`${worldId}-landmark`, 'error');
        }

        // 合并数据
        const allLines = [...riaLines, ...rmpLines];
        const riaStationNames = new Set(riaStations.map(s => s.name));
        const uniqueRmpStations = rmpStations.filter(s => !riaStationNames.has(s.name));
        const allStations = [...riaStations, ...uniqueRmpStations];

        worldData[worldId] = {
          lines: allLines,
          stations: allStations,
          rmpRawData,
          landmarks,
        };

        // 缓存到 localStorage
        setToCache(`world-${worldId}`, worldData[worldId]);
        onProgress?.(`${worldId}-railway`, 'success');
      } catch {
        onProgress?.(`${worldId}-railway`, 'error');
      }
    }

    // 更新缓存元信息
    const now = Date.now();
    setCacheMeta({
      lastUpdated: now,
      version: '1.0',
    });

    set({
      worldData,
      bureausConfig,
      isLoading: false,
      isLoaded: true,
      cacheInfo: {
        lastUpdated: now,
        isStale: false,
        size: calculateCacheSize(),
        nextUpdate: now + CACHE_MAX_AGE,
      },
    });
  },

  getWorldData: (worldId) => {
    return get().worldData[worldId] || null;
  },

  clearCache: () => {
    // 清除所有缓存
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX) || key === CACHE_META_KEY) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));

    set({
      worldData: {},
      bureausConfig: {},
      isLoaded: false,
      cacheInfo: {
        lastUpdated: null,
        isStale: true,
        size: 0,
        nextUpdate: null,
      },
    });
  },

  forceRefresh: async (onProgress) => {
    // 清除缓存后重新加载
    get().clearCache();
    await get().loadAllData(onProgress);
  },

  updateCacheInfo: () => {
    const meta = getCacheMeta();
    set({
      cacheInfo: {
        lastUpdated: meta?.lastUpdated || null,
        isStale: isCacheStale(),
        size: calculateCacheSize(),
        nextUpdate: meta ? meta.lastUpdated + CACHE_MAX_AGE : null,
      },
    });
  },
}));

export default useDataStore;
