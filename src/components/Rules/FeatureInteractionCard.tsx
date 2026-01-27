import { type WheelEvent, useEffect, useMemo, useRef, useState } from 'react';

import DraggablePanel from '@/components/DraggablePanel/DraggablePanel';
import AppCard from '@/components/ui/AppCard';
import AppButton from '@/components/ui/AppButton';
import { loadMapSettings } from '@/lib/cookies';

import type { FeatureRecord } from './renderRules';
import { buildInfoSectionsForFeature, pickFeatureDisplayName } from './cardrules/fieldRules';
import { buildPictureUrlsForFeature } from './cardrules/pictureRules';
import {
  isExternalLinkValue,
  isFeatureLinkValue,
  normalizeExternalHref,
  type ResolveFeatureById,
} from './cardrules/cardInteractions';
// 使用相对路径，避免不同构建环境下 @ 别名解析差异导致 TS2307。
import { loadRailNewIndex, type RailNewIndex } from '../Navigation/railNewIndex';

type Props = {
  open: boolean;
  feature?: FeatureRecord | null;
  onClose?: () => void;
  /** 由上层（RuleDrivenLayer）提供：用于在“要素跳转”中通过 id 找到目标要素 */
  resolveFeatureById?: ResolveFeatureById;
  /** 由上层（RuleDrivenLayer）提供：用于在“要素跳转”中尝试触发目标要素的 labelClick */
  onTryTriggerLabelClickById?: (id: string) => void;
};

type CardRow = { label: string; value: any };

function normalizeMultilineText(s: string): string {
  // Works with real newlines and literal sequences like "\\n" / "\\r\\n".
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\n/g, '\n');
}

function formatValue(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > 500 ? s.slice(0, 500) + '…' : s;
  } catch {
    return String(v);
  }
}

function renderRichValue(v: any) {
  if (!v || typeof v !== 'object') return null;

  if (v.kind === 'colorChip') {
    const color = v.color || '#999999';
    const text = v.text || '#999999';
    return (
      <div
        className="px-2 py-1 rounded-md text-[11px] font-semibold"
        style={{
          backgroundColor: color,
          color: '#ffffff',
          minWidth: 92,
          textAlign: 'center',
        }}
        title={text}
      >
        {text}
      </div>
    );
  }

  if (v.kind === 'lineChips') {
    const items = Array.isArray(v.items) ? v.items : [];
    return (
      <div className="flex flex-wrap justify-end gap-2">
        {items.map((it: any, idx: number) => {
          const color = it?.color || '#999999';
          const name = it?.name || '未知';
          const text = it?.text || '';
          return (
            <div
              key={`${name}-${idx}`}
              className="px-2 py-1 rounded-md text-[11px] font-semibold"
              style={{
                backgroundColor: color,
                color: '#ffffff',
                maxWidth: 220,
              }}
              title={text ? `${name} ${text}` : name}
            >
              {name}
            </div>
          );
        })}
      </div>
    );
  }

  return null;
}

export default function FeatureInteractionCard(props: Props) {
  const { open, feature, onClose, resolveFeatureById, onTryTriggerLabelClickById } = props;
  if (!open) return null;

  const title = useMemo(() => pickFeatureDisplayName(feature), [feature]);

  const [pictures, setPictures] = useState<string[]>(['/pictures/normal.png']);
  useEffect(() => {
    let alive = true;
    (async () => {
      const urls = await buildPictureUrlsForFeature(feature);
      if (!alive) return;
      setPictures(urls.length > 0 ? urls : ['/pictures/normal.png']);
    })();
    return () => {
      alive = false;
    };
  }, [feature]);

  // rail index（仅 STA / STB 需要）
  const [railIndex, setRailIndex] = useState<RailNewIndex | null>(null);

  useEffect(() => {
    let alive = true;

    const clsOrKind = String(
      feature?.meta?.Class ?? feature?.featureInfo?.Kind ?? feature?.featureInfo?.Class ?? '',
    ).trim();
    const needRail = clsOrKind === 'STA' || clsOrKind === 'STB' || clsOrKind === 'PLF';

    if (!needRail) {
      setRailIndex(null);
      return;
    }

    // worldId：优先从要素属性读取；若缺失，则退回到当前地图设置的 world（保持与导航一致）
    const worldId = String(
      feature?.featureInfo?.World ?? feature?.featureInfo?.world ?? feature?.meta?.World ?? ''
    ).trim();

    const fallbackWorldId = loadMapSettings()?.currentWorld ?? 'zth';
    const effectiveWorldId = worldId || fallbackWorldId;

    (async () => {
      try {
        const idx = await loadRailNewIndex(effectiveWorldId);
        if (!alive) return;
        setRailIndex(idx);
      } catch {
        if (!alive) return;
        setRailIndex(null);
      }
    })();

    return () => {
      alive = false;
    };
  }, [feature]);

  const { mainRows, otherRows } = useMemo(() => {
    if (!feature) return { mainRows: [] as CardRow[], otherRows: [] as CardRow[] };
    const { mainRows, otherRows } = buildInfoSectionsForFeature(feature, railIndex);
    return { mainRows, otherRows };
  }, [feature, railIndex]);

  const [otherOpen, setOtherOpen] = useState(false);
  useEffect(() => {
    setOtherOpen(false);
  }, [feature]);

  const stripRef = useRef<HTMLDivElement>(null);
  const onStripWheel = (e: WheelEvent<HTMLDivElement>) => {
    const el = stripRef.current;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    el.scrollLeft += e.deltaY;
  };

  return (
    <DraggablePanel id="featureInteractionCard" defaultPosition={{ x: 16, y: 180 }}>
      <AppCard className="w-[360px]" onWheel={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-black/10">
          <div className="text-sm font-semibold truncate" title={title}>
            {title || '（未命名要素）'}
          </div>
          <AppButton className="px-2 py-1 text-xs bg-transparent hover:bg-black/5" onClick={onClose}>
            关闭
          </AppButton>
        </div>

        <div className="px-3 pt-3">
          <div
            ref={stripRef}
            className="flex gap-2 overflow-x-auto overflow-y-hidden pb-2 snap-x snap-mandatory"
            onWheel={onStripWheel}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {pictures.map((src, idx) => (
              <div
                key={`${src}-${idx}`}
                className="shrink-0 snap-start rounded-md border border-black/10 bg-black/5"
                style={{ width: 324, height: 182 }}
              >
                <img
                  src={src}
                  alt={title ? `${title}-${idx + 1}` : `picture-${idx + 1}`}
                  className="w-full h-full object-cover rounded-md"
                  draggable={false}
                  onError={(ev) => {
                    const img = ev.currentTarget;
                    if (img && img.src && !img.src.endsWith('/pictures/normal.png')) {
                      img.src = '/pictures/normal.png';
                    }
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="px-3 pb-3" onWheel={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <div className="mt-1 rounded-md border border-black/10 bg-white max-h-[50vh] overflow-y-auto">
            {mainRows.length > 0 ? (
              mainRows.map((r, i) => {
                const v = r.value;

                // ===== 交互型 value：外部链接 / 要素跳转 =====
                let rich = renderRichValue(v);
                let textNode: any = null;

                if (!rich && isExternalLinkValue(v)) {
                  const href = normalizeExternalHref(v.href);
                  const text = String(v.text ?? href).trim();
                  textNode = href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#2563eb', textDecoration: 'underline', cursor: 'pointer' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {text}
                    </a>
                  ) : (
                    '未知'
                  );
                } else if (!rich && isFeatureLinkValue(v)) {
                  const id = String(v.targetId ?? '').trim();
                  const target = id && resolveFeatureById ? resolveFeatureById(id) : undefined;
                  const display =
                    String(v.text ?? '').trim() ||
                    (target ? pickFeatureDisplayName(target) : '') ||
                    id ||
                    '未知';

                  textNode = (
                    <span
                      style={{ color: '#2563eb', textDecoration: 'underline', cursor: 'pointer' }}
                      title={id || undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!id) return;
                        try {
                          onTryTriggerLabelClickById?.(id);
                        } catch {
                          // 按需求：静默失败，不抛错、不重试
                        }
                      }}
                    >
                      {display}
                    </span>
                  );
                }

                const text =
                  rich || textNode
                    ? null
                    : normalizeMultilineText(formatValue(v));

                return (
                  <div
                    key={`${r.label}-${i}`}
                    className={`flex items-start justify-between gap-3 px-2 py-2 text-xs ${
                      i === 0 ? '' : 'border-t border-black/10'
                    }`}
                  >
                    <div className="text-black/60 shrink-0">{r.label}</div>
                    <div
                      className="text-right text-black/90 break-words max-w-[240px]"
                      style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                    >
                      {rich ? rich : textNode ? textNode : text || '-'}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="px-2 py-2 text-xs text-black/60">暂无可显示的信息。</div>
            )}

            {otherRows.length > 0 && (
              <>
                <div className="border-t border-black/10" />
                <div className="px-2 py-1">
                  <AppButton
                    className="w-full justify-between text-xs bg-transparent hover:bg-black/5"
                    onClick={() => setOtherOpen((v) => !v)}
                  >
                    <span>其他信息</span>
                    <span className="text-black/60">{otherOpen ? '收起' : '展开'}</span>
                  </AppButton>
                </div>
                {otherOpen && (
                  <div className="border-t border-black/10">
                    {otherRows.map((r, i) => {
                      const v = r.value;
                      let rich = renderRichValue(v);
                      let textNode: any = null;

                      if (!rich && isExternalLinkValue(v)) {
                        const href = normalizeExternalHref(v.href);
                        const text = String(v.text ?? href).trim();
                        textNode = href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: '#2563eb', textDecoration: 'underline', cursor: 'pointer' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {text}
                          </a>
                        ) : (
                          '未知'
                        );
                      } else if (!rich && isFeatureLinkValue(v)) {
                        const id = String(v.targetId ?? '').trim();
                        const target = id && resolveFeatureById ? resolveFeatureById(id) : undefined;
                        const display =
                          String(v.text ?? '').trim() ||
                          (target ? pickFeatureDisplayName(target) : '') ||
                          id ||
                          '未知';

                        textNode = (
                          <span
                            style={{ color: '#2563eb', textDecoration: 'underline', cursor: 'pointer' }}
                            title={id || undefined}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!id) return;
                              try {
                                onTryTriggerLabelClickById?.(id);
                              } catch {
                                // 静默失败
                              }
                            }}
                          >
                            {display}
                          </span>
                        );
                      }

                      const text =
                        rich || textNode
                          ? null
                          : normalizeMultilineText(formatValue(v));

                      return (
                        <div
                          key={`other-${r.label}-${i}`}
                          className={`flex items-start justify-between gap-3 px-2 py-2 text-xs ${
                            i === 0 ? '' : 'border-t border-black/10'
                          }`}
                        >
                          <div className="text-black/60 shrink-0">{r.label}</div>
                          <div
                            className="text-right text-black/90 break-words max-w-[240px]"
                            style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                          >
                            {rich ? rich : textNode ? textNode : text || '-'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </AppCard>
    </DraggablePanel>
  );
}
