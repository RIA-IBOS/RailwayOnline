/**
 * Cookie 工具函数
 */

export type MapStyle = 'default' | 'watercolor' | 'sketch';

export interface MapSettings {
  currentWorld: string;
  showRailway: boolean;
  showLandmark: boolean;
  showPlayers: boolean;
  dimBackground: boolean;
  mapStyle: MapStyle;
}

const COOKIE_NAME = 'map_settings';
const COOKIE_EXPIRES_DAYS = 365;

/**
 * 设置 cookie
 */
function setCookie(name: string, value: string, days: number): void {
  const expires = new Date();
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
}

/**
 * 获取 cookie
 */
function getCookie(name: string): string | null {
  const nameEQ = `${name}=`;
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const c = cookie.trim();
    if (c.indexOf(nameEQ) === 0) {
      return decodeURIComponent(c.substring(nameEQ.length));
    }
  }
  return null;
}

/**
 * 保存地图设置到 cookie
 */
export function saveMapSettings(settings: MapSettings): void {
  try {
    const json = JSON.stringify(settings);
    setCookie(COOKIE_NAME, json, COOKIE_EXPIRES_DAYS);
  } catch (e) {
    console.warn('Failed to save map settings to cookie:', e);
  }
}

/**
 * 从 cookie 读取地图设置
 */
export function loadMapSettings(): Partial<MapSettings> | null {
  try {
    const json = getCookie(COOKIE_NAME);
    if (!json) return null;
    return JSON.parse(json) as Partial<MapSettings>;
  } catch (e) {
    console.warn('Failed to load map settings from cookie:', e);
    return null;
  }
}
