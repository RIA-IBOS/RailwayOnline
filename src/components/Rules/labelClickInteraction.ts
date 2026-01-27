import * as L from 'leaflet';
import type { DynmapProjection } from '@/lib/DynmapProjection';
import type { FeatureRecord } from './renderRules';
import { makeLabelDivIcon, type LabelPlacement, type LabelStyleKey } from './labelStyles';

export type HighlightStyleKey = 'dash' | 'dash-strong' | 'solid' | 'nav-outline';
export type PointPinStyleKey = 'pin-red' | 'pin-blue' | 'pin-black';
export type LabelClickMode = 'normal' | 'labelOnly';

export type LabelClickPlan = {
  enabled: boolean;
  mode: LabelClickMode;
  labelStyleKey?: LabelStyleKey;
  highlightStyleKey?: HighlightStyleKey;
  pointPinStyleKey?: PointPinStyleKey;
  openCard?: boolean;

  /**
   * 【可选】几何点击扩展：让“点击要素本体”也触发与 label 点击一致的效果。
   *
   * - point：点要素（marker/circleMarker）允许点击触发。
   * - path：线/面要素（Polyline/Polygon）允许点击触发。
   *
   * 重要约束：
   * - 当 mode === 'labelOnly' 时，主几何会被隐藏且不可交互，因此 geom 不生效。
   * - 当 mode === 'normal' 时，你可以按要素在规则中自由组合 point/path。
   *
   * 规则侧示例：
   *   labelClick: {
   *     enabled: true,
   *     mode: 'normal',
   *     highlightStyleKey: 'dash',
   *     pointPinStyleKey: 'pin-red',
   *     openCard: true,
   *     geom: { point: true, path: true },
   *   }
   */
  geom?: {
    point?: boolean;
    path?: boolean;
  };
};

export const DEFAULT_LABEL_CLICK_PLAN: LabelClickPlan = {
  enabled: true,
  mode: 'labelOnly',
  labelStyleKey: 'gm-outline',
  highlightStyleKey: 'dash',
  pointPinStyleKey: 'pin-red',
  openCard: true,
};

export function resolveHighlightStyle(key: HighlightStyleKey | undefined): L.PathOptions {
  // nav-outline：在 createHighlightLayerForFeature 内走“白色描边 + 主色加粗”双线绘制
  // 这里给一个兜底（理论上不会用到）。
  if (key === 'nav-outline') {
    return { color: '#60a5fa', opacity: 1, weight: 6, dashArray: undefined, fillOpacity: 0 };
  }
  if (key == 'solid') {
    return { color: '#22c55e', opacity: 1, weight: 3, dashArray: undefined, fillOpacity: 0 };
  }
  if (key == 'dash-strong') {
    return { color: '#f59e0b', opacity: 1, weight: 4, dashArray: '10 6', fillOpacity: 0 };
  }
  return { color: '#60a5fa', opacity: 1, weight: 3, dashArray: '8 6', fillOpacity: 0 };
}

function normalizeHexColor(v: any): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^#([0-9a-fA-F]{6})$/.test(s)) return s;
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s}`;
  if (/^#([0-9a-fA-F]{3})$/.test(s)) {
    const m = s.slice(1);
    return `#${m[0]}${m[0]}${m[1]}${m[1]}${m[2]}${m[2]}`;
  }
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
  }
  return s; // 允许 css 颜色名等
}

function pickFeatureMainColor(r: FeatureRecord): string {
  const fi: any = (r as any)?.featureInfo ?? {};
  const c = fi?.color ?? fi?.Color ?? fi?.lineColor ?? fi?.LineColor;
  const s = normalizeHexColor(c);
  return s || '#2196F3';
}

function pinSvg(color: string): string {
  return `    <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24">      <path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z" fill="${color}" stroke="#111827" stroke-width="1"/>      <circle cx="12" cy="10" r="2.6" fill="#ffffff" opacity="0.95"/>    </svg>  `;
}

export function makePointPinMarker(latlng: L.LatLng, styleKey: PointPinStyleKey | undefined): L.Marker {
  const color =
    styleKey === 'pin-blue' ? '#3b82f6' :
    styleKey === 'pin-black' ? '#111827' :
    '#ef4444';

  // 关键修复：不要使用 iconSize=[0,0]（会导致 DOM 盒子宽度为 0，在 Firefox 下表现为“0×22”，从而看不到图钉）。
  // 让“尖端”落在 latlng：iconAnchor 取 (宽/2, 高)
  const html = pinSvg(color);
  const iconSize: [number, number] = [26, 26];
  const iconAnchor: [number, number] = [13, 26];

  return L.marker(latlng, {
    pane: 'ria-point-top',
    interactive: false,
    icon: L.divIcon({ className: '', html, iconSize, iconAnchor }),
  });
}


export function makeClickableLabelMarker(args: {
  latlng: L.LatLng;
  text: string;
  placement: LabelPlacement;
  withDot?: boolean;
  offsetY?: number;
  styleKey: LabelStyleKey;
  onClick: () => void;
}): L.Marker {
  const { latlng, text, placement, withDot, offsetY, styleKey, onClick } = args;

  const icon = makeLabelDivIcon(styleKey, text, {
    placement,
    withDot,
    offsetY,
    interactive: true,
  });

  const m = L.marker(latlng, {
    pane: 'ria-label',
    interactive: true,
    keyboard: false,
    icon,
  });

  m.on('click', (e) => {
    (e as any)?.originalEvent?.stopPropagation?.();
    onClick();
  });

  return m;
}

export function createHighlightLayerForFeature(args: {
  r: FeatureRecord;
  projection: DynmapProjection;
  highlightStyleKey?: HighlightStyleKey;
  pointPinStyleKey?: PointPinStyleKey;
}): L.Layer | null {
  const { r, projection, highlightStyleKey, pointPinStyleKey } = args;

  if (r.type === 'Points' && r.p3) {
    const ll = projection.locationToLatLng(r.p3.x, r.p3.y, r.p3.z);
    return makePointPinMarker(ll, pointPinStyleKey);
  }

  if (!r.coords3?.length) return null;

  const latlngs = r.coords3.map((p) => projection.locationToLatLng(p.x, p.y, p.z));

  // nav-outline：与导航 RouteHighlightLayer 的视觉一致（白色描边 + 主色加粗）
  if (highlightStyleKey === 'nav-outline') {
    const mainColor = pickFeatureMainColor(r);
    const mainWeight = 6;
    const outlineWeight = mainWeight + 3;
    const outlineOpacity = 0.85;

    const outlineOpts: L.PathOptions = {
      color: '#ffffff',
      opacity: outlineOpacity,
      weight: outlineWeight,
      lineCap: 'round',
      lineJoin: 'round',
      dashArray: undefined,
      fillOpacity: 0,
      pane: 'ria-overlay-top',
      interactive: false,
    };
    const mainOpts: L.PathOptions = {
      color: mainColor,
      opacity: 1,
      weight: mainWeight,
      lineCap: 'round',
      lineJoin: 'round',
      dashArray: undefined,
      fillOpacity: 0,
      pane: 'ria-overlay-top',
      interactive: false,
    };

    if (r.type === 'Polyline') {
      return L.layerGroup([
        L.polyline(latlngs, outlineOpts as any),
        L.polyline(latlngs, mainOpts as any),
      ]);
    }

    if (r.type === 'Polygon') {
      return L.layerGroup([
        L.polygon(latlngs, outlineOpts as any),
        L.polygon(latlngs, mainOpts as any),
      ]);
    }

    return null;
  }

  const style = resolveHighlightStyle(highlightStyleKey);

  if (r.type === 'Polyline') {
    return L.polyline(latlngs, { ...style, pane: 'ria-overlay-top', interactive: false });
  }

  if (r.type === 'Polygon') {
    return L.polygon(latlngs, { ...style, fillOpacity: 0, pane: 'ria-overlay-top', interactive: false });
  }

  return null;
}
