/**
 * 世界切换器组件
 * 允许用户在不同世界（零洲、奈落洲、后土洲）之间切换
 */

import { useState } from 'react';

interface World {
  id: string;
  name: string;
  center: { x: number; y: number; z: number };
}

interface WorldSwitcherProps {
  worlds: World[];
  currentWorld: string;
  onWorldChange: (worldId: string) => void;
}

export function WorldSwitcher({
  worlds,
  currentWorld,
  onWorldChange,
}: WorldSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const current = worlds.find(w => w.id === currentWorld);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-white/90 rounded-lg shadow-lg hover:bg-white transition-colors"
      >
        <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-sm font-medium text-gray-700">{current?.name || '选择世界'}</span>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-full bg-white rounded-lg shadow-lg overflow-hidden z-10">
          {worlds.map(world => (
            <button
              key={world.id}
              onClick={() => {
                onWorldChange(world.id);
                setIsOpen(false);
              }}
              className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-100 transition-colors ${
                world.id === currentWorld
                  ? 'bg-blue-50 text-blue-600 font-medium'
                  : 'text-gray-700'
              }`}
            >
              {world.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default WorldSwitcher;
