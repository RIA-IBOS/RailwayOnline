import { Navigation } from 'lucide-react';

type Props = {
  active: boolean;
  onToggle: () => void;
};

/**
 * 右侧工具按钮：平台导航（Navigation_2）
 * - 与 MeasuringModule / Mtools / RuleLayerToggle 保持一致（桌面端显示，移动端隐藏）
 * - 若与右侧按钮重叠，可调 sm:right-[428px] 这个偏移值
 */
export default function Navigation2Toggle(props: Props) {
  const { active, onToggle } = props;

  return (
    <div className="hidden sm:block absolute bottom-8 right-2 sm:top-4 sm:bottom-auto sm:right-[428px] z-[1001]">
      <div className="relative">
        <button
          onClick={onToggle}
          className={`relative group flex flex-col items-center p-2 rounded-lg transition-colors ${
            active ? 'bg-blue-50 text-blue-600' : 'bg-white/90 text-gray-700 hover:bg-gray-100'
          } shadow-lg`}
          title="平台导航"
          type="button"
        >
          <Navigation className="w-5 h-5" />
          <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs bg-gray-800 text-white px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            平台导航
          </span>
        </button>
      </div>
    </div>
  );
}
