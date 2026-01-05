import { Layers } from 'lucide-react';
import ToolIconButton from '@/components/Toolbar/ToolIconButton';

type Props = {
  active: boolean;
  onToggle: () => void;
};

/**
 * 右侧工具按钮：规则驱动图层总开关
 * - 位置与 MeasuringModule / Mtools 保持一致（桌面端显示，移动端隐藏）
 */
export default function RuleLayerToggle(props: Props) {
  const { active, onToggle } = props;

  return (
    <div className="hidden sm:block absolute bottom-8 right-2 sm:top-4 sm:bottom-auto sm:right-[372px] z-[1001]">
      <div className="relative">
        <ToolIconButton
          label="规则图层"
          icon={<Layers className="w-5 h-5" />}
          active={active}
          tone="blue"
          shadow
          onClick={onToggle}
        />
      </div>
    </div>
  );
}
