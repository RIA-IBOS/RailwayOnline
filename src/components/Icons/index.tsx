/**
 * 统一图标组件
 * 使用 Lucide React 图标库
 */

import {
  Search,
  X,
  Check,
  ChevronDown,
  ChevronLeft,
  ArrowUpDown,
  MapPin,
  Train,
  Home,
  Navigation,
  List,
  HelpCircle,
  Layers,
  Eye,
  EyeOff,
  Footprints,
  Route,
  User,
  type LucideProps,
} from 'lucide-react';

// 导出所有图标
export {
  Search as SearchIcon,
  X as CloseIcon,
  Check as CheckIcon,
  ChevronDown as ChevronDownIcon,
  ChevronLeft as ChevronLeftIcon,
  ArrowUpDown as SwapIcon,
  MapPin as LandmarkIcon,
  Train as TrainIcon,
  Home as HomeIcon,
  Navigation as NavigationIcon,
  List as ListIcon,
  HelpCircle as HelpIcon,
  Layers as LayersIcon,
  Eye as EyeIcon,
  EyeOff as EyeOffIcon,
  Footprints as WalkIcon,
  Route as RouteIcon,
  User as UserIcon,
};

// 图标 Props 类型
export type IconProps = LucideProps;

/**
 * 地图标记图标组件
 * 圆形背景 + 中心图标
 */
interface MapMarkerIconProps {
  icon: 'landmark' | 'station' | 'walk' | 'player';
  color: string;
  size?: number;
}

export function getMapMarkerSvg({ icon, color, size = 24 }: MapMarkerIconProps): string {
  const iconPaths: Record<string, string> = {
    // Home 图标路径 (用于地标)
    landmark: `<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>`,
    // Train 图标路径 (用于站点)
    station: `<path d="M8 3.89l4-1.9 4 1.9"/><rect width="14" height="8" x="5" y="8" rx="1"/><circle cx="9" cy="21" r="1"/><circle cx="15" cy="21" r="1"/><path d="M9 16v5"/><path d="M15 16v5"/>`,
    // Footprints 图标路径 (用于步行)
    walk: `<path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/><path d="M16 17h4"/><path d="M4 13h4"/>`,
    // User 图标路径 (用于玩家)
    player: `<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>`,
  };

  const iconPath = iconPaths[icon] || iconPaths.landmark;
  const iconSize = size * 0.5;
  const iconOffset = (size - iconSize) / 2;

  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 1}" fill="${color}" stroke="white" stroke-width="2"/>
      <g transform="translate(${iconOffset}, ${iconOffset}) scale(${iconSize / 24})" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        ${iconPath}
      </g>
    </svg>
  `;
}

/**
 * 生成地图标记 HTML (用于 Leaflet divIcon)
 */
export function createMapMarkerHtml(icon: MapMarkerIconProps['icon'], color: string, size: number = 24): string {
  return getMapMarkerSvg({ icon, color, size });
}
