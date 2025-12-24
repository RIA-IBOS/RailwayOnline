import { useMemo, useState } from 'react';

import { X } from 'lucide-react';

import { DraggablePanel } from '@/components/DraggablePanel/DraggablePanel';
import { parseHalfStepNumber } from './GridSnapModeSwitch';

export interface ManualPointInputValue {
  x: number;
  y: number;
  z: number;
}

export interface ManualPointInputProps {
  /** 是否允许使用（例如 drawMode === 'none' 或当前不在绘制/编辑状态时禁用） */
  enabled?: boolean;

  /** 默认 y 值（与你项目里常见 -64/-63 的 JSON 高度保持一致） */
  defaultY?: number;

  /** 点击“完成”时回调（不清空输入，不关闭面板） */
  onSubmit: (v: ManualPointInputValue) => void;
}

const isValid = (n: number | null) => typeof n === 'number' && Number.isFinite(n);

export default function ManualPointInput({ enabled = true, defaultY = -64, onSubmit }: ManualPointInputProps) {
  const [open, setOpen] = useState(false);

  const [xRaw, setXRaw] = useState('');
  const [yRaw, setYRaw] = useState(String(defaultY));
  const [zRaw, setZRaw] = useState('');

  const disabled = !enabled;

  const title = useMemo(() => {
    if (disabled) return '手动输入：需先进入点/线/面绘制或编辑状态';
    return '手动输入：仅允许整数或 .5（例如 10、10.5、-64、-64.5）';
  }, [disabled]);

  const submit = () => {
    if (disabled) return;

    const x = parseHalfStepNumber(xRaw);
    const y = parseHalfStepNumber(yRaw);
    const z = parseHalfStepNumber(zRaw);

    if (!isValid(x) || !isValid(y) || !isValid(z)) {
      window.alert('手动输入坐标非法：x/y/z 仅允许输入整数或 .5 的数值。');
      return;
    }

    onSubmit({ x: x!, y: y!, z: z! });
  };

  return (
    <div className="mb-2" title={title}>
      <button
        type="button"
        className={`w-full px-2 py-1 rounded text-sm border ${
          open ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
      >
        手动输入
      </button>

{open && (
  <DraggablePanel id="manual-point-input" defaultPosition={{ x: 380, y: 120 }}>
    <div className="bg-white border rounded shadow-md w-80">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="text-sm font-semibold">手动输入</div>
        <button
          type="button"
          className="p-1 rounded hover:bg-gray-100"
          onClick={() => setOpen(false)}
          title="关闭"
        >
          <X size={16} />
        </button>
      </div>

      <div className="p-3">
        <div className="text-xs text-gray-600 mb-2">
          仅允许整数或 .5。点击“完成”会按当前输入向绘制/编辑要素添加一个控制点。
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="text-xs mb-1">X</div>
            <input
              value={xRaw}
              onChange={(e) => setXRaw(e.target.value)}
              className="w-full px-2 py-1 border rounded text-sm"
              placeholder="例如 10 / 10.5"
            />
          </div>

          <div>
            <div className="text-xs mb-1">Y</div>
            <input
              value={yRaw}
              onChange={(e) => setYRaw(e.target.value)}
              className="w-full px-2 py-1 border rounded text-sm"
              placeholder="例如 -64 / -64.5"
            />
          </div>

          <div>
            <div className="text-xs mb-1">Z</div>
            <input
              value={zRaw}
              onChange={(e) => setZRaw(e.target.value)}
              className="w-full px-2 py-1 border rounded text-sm"
              placeholder="例如 20 / 20.5"
            />
          </div>
        </div>

        <div className="mt-3 flex justify-end">
          <button type="button" className="bg-green-500 text-white px-3 py-1 rounded" onClick={submit}>
            完成
          </button>
        </div>
      </div>
    </div>
  </DraggablePanel>
)}

    </div>
  );
}
