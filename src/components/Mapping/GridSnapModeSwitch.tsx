import { useEffect, useMemo, useState } from 'react';
import AppButton from '@/components/ui/AppButton';

/**
 * Grid snap mode:
 * - auto   : round to nearest 0.5 (allows .0 and .5)
 * - center : snap to block center (integer + 0.5)
 * - edge   : snap to block edge   (integer)
 */
export type GridSnapMode = 'auto' | 'center' | 'edge';

export type WorldPoint = { x: number; z: number; y?: number };

type Listener = (m: GridSnapMode) => void;

let _mode: GridSnapMode = 'auto';
const _listeners = new Set<Listener>();

export const getGridSnapMode = (): GridSnapMode => _mode;

export const setGridSnapMode = (m: GridSnapMode) => {
  if (_mode === m) return;
  _mode = m;
  _listeners.forEach((fn) => fn(_mode));
};

export const useGridSnapMode = (): [GridSnapMode, (m: GridSnapMode) => void] => {
  const [mode, setMode] = useState<GridSnapMode>(_mode);

useEffect(() => {
  const fn: Listener = (m) => setMode(m);
  _listeners.add(fn);

  return () => {
    _listeners.delete(fn); // Set.delete() 返回 boolean，但 cleanup 不能返回 boolean
  };
}, []);


  return [mode, setGridSnapMode];
};

const fixNegZero = (n: number) => (Object.is(n, -0) ? 0 : n);

export const snapNumberByMode = (n: number, mode: GridSnapMode): number => {
  if (!Number.isFinite(n)) return n;

  // auto: nearest 0.5 step
  if (mode === 'auto') return fixNegZero(Math.round((n + Number.EPSILON) * 2) / 2);

  // edge: nearest integer
  if (mode === 'edge') return fixNegZero(Math.round(n));

  // center: nearest (k + 0.5)
  // snap to centers: ..., -1.5, -0.5, 0.5, 1.5, ...
  return fixNegZero(Math.round(n - 0.5) + 0.5);
};

export const snapWorldPointByMode = (p: { x: number; z: number }, mode: GridSnapMode = getGridSnapMode()) => {
  return {
    x: snapNumberByMode(p.x, mode),
    z: snapNumberByMode(p.z, mode),
  };
};

export const formatGridNumber = (n: number) => {
  if (!Number.isFinite(n)) return String(n);
  const r = Math.round(n);
  if (Math.abs(n - r) < 1e-9) return String(r);
  // show 1 decimal for half-step values
  return n.toFixed(1);
};

/** parse & validate: only allow integer or .5 step; return null if invalid/empty */
export const parseHalfStepNumber = (raw: string): number | null => {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  // multiple of 0.5
  const v = n * 2;
  if (Math.abs(v - Math.round(v)) > 1e-9) return null;
  return fixNegZero(Math.round(v) / 2);
};

export default function GridSnapModeSwitch() {
  const [mode, setMode] = useGridSnapMode();

  const centerOn = mode === 'center';
  const edgeOn = mode === 'edge';

  const btnBase =
    'flex-1 px-2 py-1 rounded text-sm border transition-colors select-none';
  const onCls = 'bg-blue-600 text-white border-blue-700';
  const offCls = 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50';

  const toggleCenter = () => {
    if (centerOn) setMode('auto');
    else setMode('center');
  };

  const toggleEdge = () => {
    if (edgeOn) setMode('auto');
    else setMode('edge');
  };

  const hint = useMemo(() => {
    if (mode === 'center') return '当前：强制中心（k+0.5）';
    if (mode === 'edge') return '当前：强制边缘（整数）';
    return '当前：自动（0.5 步进）';
  }, [mode]);

  return (
    <div className="flex gap-2" title={hint}>
      <AppButton type="button" className={`${btnBase} ${centerOn ? onCls : offCls}`} onClick={toggleCenter}>
        方块中心(.5)
      </AppButton>
      <AppButton type="button" className={`${btnBase} ${edgeOn ? onCls : offCls}`} onClick={toggleEdge}>
        方块边缘(.0)
      </AppButton>
    </div>
  );
}