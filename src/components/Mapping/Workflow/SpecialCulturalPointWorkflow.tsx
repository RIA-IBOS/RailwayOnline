// File: src/components/Mapping/Workflow/SpecialCulturalPointWorkflow.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowComponentProps, WorldPoint } from './WorkflowHost';
import AppButton from '@/components/ui/AppButton';
import {
  EXT_VALUE_TYPE_OPTIONS,
  EXT_VALUE_TYPE_TEXT,
  type ExtValueType,
  listCatalogKindOptions,
} from '@/components/Mapping/featureFormats';

/**
 * SpecialCulturalPointWorkflow（工作流：特殊人文点要素）
 *
 * 基于 NaturalLandWorkflow 的结构：
 * 1) 填写者信息（CreateBy）
 * 2) 信息填写（Kind=ADM 下所有点要素：选择 SKind/SKind2 + 名称/简称/命名者/wiki + 额外可选字段 + extensions）
 * 3) ISP（地物点）绘制：完成后写入固定图层，并退出回到快捷测绘主页面
 */

type Step = 'creator' | 'info' | 'draw';

type InfoForm = {
  typeKey: string; // `${skind}|${skind2}`
  name: string;
  abbr: string;
  nomenclator: string;
  wiki?: string;

  brief?: string; // 简介
  // optional
  land?: string; // 所属大陆(一级)
  uadm?: string; // 所属上级要素
  pop?: string; // 参与人员
  event?: string; // 事件或类型
};

type ExtensionItem = {
  extGroup: string;
  extKey: string;
  extType: ExtValueType;
  extValue: string;
};

const WORLD_ID_TO_CODE: Record<string, number> = {
  zth: 0,
  naraku: 1,
  houtu: 2,
  eden: 3,
  laputa: 4,
  yunduan: 5,
};

const WORLD_CODE_TO_PREFIX: Record<number, string> = {
  0: 'Z',
  1: 'N',
  2: 'H',
  3: 'E',
  4: 'L',
  5: 'Y',
};

function resolveWorldPrefix(worldIdRaw: string): string {
  const w = String(worldIdRaw ?? '').trim();
  if (!w) return 'Z';

  const asNum = Number(w);
  if (Number.isFinite(asNum) && WORLD_CODE_TO_PREFIX[asNum as any]) return WORLD_CODE_TO_PREFIX[asNum as any];

  const code = WORLD_ID_TO_CODE[w];
  if (Number.isFinite(code)) return WORLD_CODE_TO_PREFIX[code];

  if (/^[ZNHELY]$/i.test(w)) return w.toUpperCase();
  return 'Z';
}

function nonEmpty(s: string) {
  return String(s ?? '').trim().length > 0;
}

type TopNavProps = {
  title: string;
  showPrev?: boolean;
  showNext?: boolean;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
};

function TopNav(props: TopNavProps) {
  const { title, showPrev, showNext, prevDisabled, nextDisabled, onPrev, onNext } = props;
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <div className="text-sm font-semibold">{title}</div>
      <div className="flex items-center gap-2">
        {showPrev ? (
          <AppButton
            className={`px-3 py-1.5 rounded text-sm border border-gray-300 bg-white text-gray-900 ${
              prevDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100'
            }`}
            disabled={!!prevDisabled}
            onClick={onPrev}
            type="button"
          >
            上一步
          </AppButton>
        ) : null}
        {showNext ? (
          <AppButton
            className={`px-3 py-1.5 rounded text-sm border border-gray-300 bg-white text-gray-900 ${
              nextDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100'
            }`}
            disabled={!!nextDisabled}
            onClick={onNext}
            type="button"
          >
            下一步
          </AppButton>
        ) : null}
      </div>
    </div>
  );
}

type LabeledInputProps = {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  type?: 'text' | 'number';
};

function LabeledInput(props: LabeledInputProps) {
  const { label, value, placeholder, onChange, type = 'text' } = props;
  return (
    <label className="block space-y-1">
      <div className="text-xs opacity-80">{label}</div>
      <input
        type={type}
        className="w-full border p-1 rounded text-sm"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onMouseDownCapture={(e) => e.stopPropagation()}
        onPointerDownCapture={(e) => e.stopPropagation()}
        onTouchStartCapture={(e) => e.stopPropagation()}
      />
    </label>
  );
}

function LabeledBriefInput(props: LabeledInputProps) {
  const { label, value, placeholder, onChange } = props;
  return (
    <label className="block space-y-1">
      <div className="text-xs opacity-80">{label}</div>
      <textarea
        className="w-full border p-2 rounded text-sm h-28 resize-none"
        value={value}
        placeholder={placeholder}
        rows={4}
        onChange={(e) => onChange(e.target.value.replace(/\r\n/g, '\n').replace(/\r/g, '\n'))}
        onMouseDownCapture={(e) => e.stopPropagation()}
        onPointerDownCapture={(e) => e.stopPropagation()}
        onTouchStartCapture={(e) => e.stopPropagation()}
      />
    </label>
  );
}

function normalizeAbbr(raw: string) {
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^A-Za-z0-9_-]/g, '');
}

function firstPointOnly(pts: WorldPoint[]) {
  if (!Array.isArray(pts) || pts.length < 1) return [];
  const p0 = pts[pts.length - 1];
  return [{ x: p0.x, z: p0.z, y: p0.y }];
}

export default function SpecialCulturalPointWorkflow(props: WorkflowComponentProps) {
  const { bridge } = props;

  const bridgeRef = useRef(bridge);
  useEffect(() => {
    bridgeRef.current = bridge;
  }, [bridge]);

  const [step, setStep] = useState<Step>('creator');

  // Page 1
  const [creatorId, setCreatorId] = useState<string>(() => (bridgeRef.current.getEditorId?.() ?? '').trim());

  // Page 2
  const [info, setInfo] = useState<InfoForm>({
    typeKey: '',
    name: '',
    abbr: '',
    nomenclator: '',
    wiki: '',
    
    brief: '',land: '',
    uadm: '',
    pop: '',
    event: '',
  });
  const [extItems, setExtItems] = useState<ExtensionItem[]>([]);

  // Page 3
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>('');

  const worldPrefix = useMemo(() => resolveWorldPrefix(bridge.getCurrentWorldId?.() ?? ''), [bridge]);
  const kind = 'ADM';

  const typeOptions = useMemo(() => {
    return listCatalogKindOptions({ kind, geom: '点' });
  }, []);

  const selected = useMemo(() => {
    const key = String(info.typeKey ?? '');
    if (!key) return null;
    const [skind, skind2] = key.split('|');
    return typeOptions.find((o) => o.skind === skind && o.skind2 === skind2) ?? null;
  }, [info.typeKey, typeOptions]);

  useEffect(() => {
    if (nonEmpty(creatorId)) {
      bridgeRef.current.setEditorId(creatorId.trim());
    }

    if (step !== 'draw') {
      bridgeRef.current.setDrawMode('none');
      bridgeRef.current.clearTempPoints();
      setSaveError('');
      return;
    }

    bridgeRef.current.setDrawMode('point');
  }, [step, creatorId]);

  const canGoNextFromCreator = useMemo(() => nonEmpty(creatorId), [creatorId]);
  const abbrNormalized = useMemo(() => normalizeAbbr(info.abbr), [info.abbr]);

  const canGoNextFromInfo = useMemo(() => {
    return nonEmpty(info.typeKey) && nonEmpty(info.name) && nonEmpty(abbrNormalized) && nonEmpty(info.nomenclator);
  }, [info.typeKey, info.name, abbrNormalized, info.nomenclator]);

  const draftPoint: WorldPoint[] = step === 'draw' ? (bridge.getTempPoints?.() ?? []) : [];

  const canCommit = useMemo(() => {
    return canGoNextFromInfo && Array.isArray(draftPoint) && draftPoint.length >= 1 && !saving;
  }, [canGoNextFromInfo, draftPoint.length, saving]);

  const addExtensionRow = () => {
    setExtItems((prev) => [...prev, { extGroup: '', extKey: '', extType: EXT_VALUE_TYPE_TEXT, extValue: '' }]);
  };

  const updateExtensionRow = (idx: number, patch: Partial<ExtensionItem>) => {
    setExtItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const removeExtensionRow = (idx: number) => {
    setExtItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const commit = () => {
    if (!canCommit) return;
    setSaving(true);
    setSaveError('');

    try {
      const pts = firstPointOnly(bridgeRef.current.getTempPoints?.() ?? []);
      const coords = (Array.isArray(pts) ? pts : []) as any;
      if (coords.length < 1) {
        setSaveError('请先在地图上点选一个位置。');
        return;
      }

      const skind = String(selected?.skind ?? '').trim();
      const skind2 = String(selected?.skind2 ?? '').trim();
      if (!skind || !skind2) {
        setSaveError('类型选择无效，请返回上一页重新选择。');
        return;
      }

      // 按需求：PointID = World + ADM + DBZ + SKind2 + _ + 字符简称
      const pointId = `${worldPrefix}${kind}DBZ${skind2}_${abbrNormalized}`;

      // extensions: 先写入 link.wiki / character.event，再拼接用户自定义条目
      const extList: ExtensionItem[] = [];
      const wiki = String(info.wiki ?? '').trim();
      if (wiki) {
        extList.push({ extGroup: 'link', extKey: 'wiki', extType: EXT_VALUE_TYPE_TEXT, extValue: wiki });
      }

      const brief = String(info.brief ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
      if (brief) {
        extList.push({ extGroup: 'character', extKey: 'brief', extType: EXT_VALUE_TYPE_TEXT, extValue: brief });
      }
      const event = String(info.event ?? '').trim();
      if (event) {
        extList.push({ extGroup: 'character', extKey: 'event', extType: EXT_VALUE_TYPE_TEXT, extValue: event });
      }
      for (const it of extItems ?? []) {
        const g = String(it.extGroup ?? '').trim();
        const k = String(it.extKey ?? '').trim();
        if (!g || !k) continue;
        if (g === 'link' && k === 'wiki') continue;
        if (g === 'character' && k === 'brief') continue;
        if (g === 'character' && k === 'event') continue;
        extList.push({
          extGroup: g,
          extKey: k,
          extType: (it.extType ?? EXT_VALUE_TYPE_TEXT) as ExtValueType,
          extValue: String(it.extValue ?? ''),
        });
      }

      const tags: Array<{ tagKey: string; tagValue: string }> = [
        { tagKey: 'nomenclator', tagValue: String(info.nomenclator ?? '').trim() },
      ];

      const land = String(info.land ?? '').trim();
      const uadm = String(info.uadm ?? '').trim();
      const pop = String(info.pop ?? '').trim();

      if (land) tags.push({ tagKey: 'Land', tagValue: land });
      if (uadm) tags.push({ tagKey: 'UAdm', tagValue: uadm });
      if (pop) tags.push({ tagKey: 'Pop', tagValue: pop });

      const res = bridgeRef.current.commitFeature({
        subType: '地物点',
        mode: 'point',
        coords,
        editorId: creatorId.trim(),
        values: {
          PointID: pointId,
          PointName: String(info.name ?? '').trim(),
          PointKind: kind,
          PointSKind: skind,
          PointSKind2: skind2,
        },
        groupInfo: {
          tags,
          extensions: extList.map((it) => ({
            extGroup: it.extGroup,
            extKey: it.extKey,
            extType: it.extType,
            extValue: it.extValue,
          })),
        },
      });

      if (!res.ok) {
        setSaveError(res.error || '保存失败');
        return;
      }

      bridgeRef.current.clearTempPoints();
      bridgeRef.current.exitWorkflowToSelector();
    } catch (e: any) {
      setSaveError(String(e?.message ?? e ?? '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  if (step === 'creator') {
    return (
      <div className="p-3 rounded border border-gray-300 bg-white">
        <TopNav title="特殊人文点要素：填写者信息" showNext nextDisabled={!canGoNextFromCreator} onNext={() => setStep('info')} />

        <div className="space-y-2">
          <LabeledInput label="填写者ID（CreateBy）" value={creatorId} placeholder="例如：YZ1825" onChange={(v) => setCreatorId(v)} />
          <div className="text-xs text-gray-600">该字段将写入 CreateBy（系统字段），用于标识本次测绘的编辑者。</div>
        </div>
      </div>
    );
  }

  if (step === 'info') {
    return (
      <div className="p-3 rounded border border-gray-300 bg-white">
        <TopNav
          title="特殊人文点要素：信息填写"
          showPrev
          showNext
          prevDisabled={false}
          nextDisabled={!canGoNextFromInfo}
          onPrev={() => setStep('creator')}
          onNext={() => setStep('draw')}
        />

        <div className="space-y-3">
          <label className="block space-y-1">
            <div className="text-xs opacity-80">类型（Kind=ADM 下所有点要素）</div>
            <select
              className="w-full border p-1 rounded text-sm"
              value={info.typeKey}
              onChange={(e) => setInfo((prev) => ({ ...prev, typeKey: e.target.value }))}
              onMouseDownCapture={(e) => e.stopPropagation()}
              onPointerDownCapture={(e) => e.stopPropagation()}
              onTouchStartCapture={(e) => e.stopPropagation()}
            >
              <option value="">请选择...</option>
              {typeOptions.map((o) => (
                <option key={`${o.skind}|${o.skind2}`} value={`${o.skind}|${o.skind2}`}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <LabeledInput label="名称" value={info.name} placeholder="例如：历史地标" onChange={(v) => setInfo((prev) => ({ ...prev, name: v }))} />

          <LabeledInput
            label="字符简称（用于ID）"
            value={info.abbr}
            placeholder="仅建议使用字母/数字/下划线/短横线"
            onChange={(v) => setInfo((prev) => ({ ...prev, abbr: v }))}
          />
          {info.abbr && abbrNormalized !== info.abbr.trim() ? (
            <div className="text-xs text-gray-600">
              将用于 ID 的简称：<span className="font-mono">{abbrNormalized || '(空)'}</span>
            </div>
          ) : null}

          <LabeledInput
            label="命名者（将写入 tags.nomenclator）"
            value={info.nomenclator}
            placeholder="例如：官方公告 / OSM / 个人署名"
            onChange={(v) => setInfo((prev) => ({ ...prev, nomenclator: v }))}
          />

          <LabeledInput
            label="所属大陆(一级)（可选，将写入 tags.Land）"
            value={info.land ?? ''}
            placeholder="例如：亚欧大陆"
            onChange={(v) => setInfo((prev) => ({ ...prev, land: v }))}
          />

          <LabeledInput
            label="所属上级要素（可选，将写入 tags.UAdm）"
            value={info.uadm ?? ''}
            placeholder="例如：ZADMDBZL1_xxx"
            onChange={(v) => setInfo((prev) => ({ ...prev, uadm: v }))}
          />

          <LabeledInput
            label="参与人员（可选，将写入 tags.Pop）"
            value={info.pop ?? ''}
            placeholder="例如：Codusk"
            onChange={(v) => setInfo((prev) => ({ ...prev, pop: v }))}
          />

          <LabeledInput
            label="事件或类型（可选，将写入 extensions.character.event）"
            value={info.event ?? ''}
            placeholder="例如：纪念碑 / 战役 / 历史事件"
            onChange={(v) => setInfo((prev) => ({ ...prev, event: v }))}
          />

          <LabeledInput
            label="wiki链接（可选，将写入 extensions.link.wiki）"
            value={info.wiki ?? ''}
            placeholder="https://..."
            onChange={(v) => setInfo((prev) => ({ ...prev, wiki: v }))}
          />



          <LabeledBriefInput
            label="简介（可选，将写入 extensions.character.brief）"
            value={info.brief ?? ''}
            placeholder="支持长文本输入（不支持换行）"
            onChange={(v) => setInfo((prev) => ({ ...prev, brief: v }))}
          />
          {/* extensions */}
          <div className="border rounded p-2 bg-gray-50">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold">extensions（可选）</div>
              <AppButton type="button" className="px-2 py-1 text-sm rounded border hover:bg-white" onClick={addExtensionRow}>
                添加扩展
              </AppButton>
            </div>

            {extItems.length === 0 ? (
              <div className="text-xs text-gray-600">暂无扩展项（你可以在此页添加任意扩展组/字段）。</div>
            ) : (
              <div className="space-y-2">
                {extItems.map((it, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-3">
                      <LabeledInput label="组(extGroup)" value={it.extGroup} placeholder="例如：meta" onChange={(v) => updateExtensionRow(idx, { extGroup: v })} />
                    </div>
                    <div className="col-span-3">
                      <LabeledInput label="字段(extKey)" value={it.extKey} placeholder="例如：source" onChange={(v) => updateExtensionRow(idx, { extKey: v })} />
                    </div>
                    <div className="col-span-3">
                      <label className="block space-y-1">
                        <div className="text-xs opacity-80">值类型</div>
                        <select
                          className="w-full border p-1 rounded text-sm"
                          value={it.extType}
                          onChange={(e) => updateExtensionRow(idx, { extType: e.target.value as ExtValueType })}
                          onMouseDownCapture={(e) => e.stopPropagation()}
                          onPointerDownCapture={(e) => e.stopPropagation()}
                          onTouchStartCapture={(e) => e.stopPropagation()}
                        >
                          {EXT_VALUE_TYPE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="col-span-2">
                      <LabeledInput
                        label="值(extValue)"
                        value={it.extValue}
                        placeholder={it.extType === 'null' ? 'null 类型可留空' : '...'}
                        onChange={(v) => updateExtensionRow(idx, { extValue: v })}
                      />
                    </div>
                    <div className="col-span-1">
                      <AppButton
                        type="button"
                        className="w-full px-2 py-1 text-sm rounded border bg-white hover:bg-gray-100"
                        onClick={() => removeExtensionRow(idx)}
                        title="删除"
                      >
                        ✕
                      </AppButton>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="text-xs text-gray-600">下一步将进入点要素绘制。完成后会写入 ISP（地物点）图层。</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 rounded border border-gray-300 bg-white">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-sm font-semibold">特殊人文点要素：绘制（地物点 / ISP）</div>
        <div className="flex items-center gap-2">
          <AppButton
            type="button"
            className="px-3 py-1.5 rounded text-sm border border-gray-300 bg-white text-gray-900 hover:bg-gray-100"
            onClick={() => {
              bridgeRef.current.clearTempPoints();
              setStep('info');
            }}
          >
            返回
          </AppButton>

          <AppButton
            type="button"
            className={`px-3 py-1.5 rounded text-sm border ${
              canCommit
                ? 'bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed border-gray-200'
            }`}
            disabled={!canCommit}
            onClick={commit}
            title={!canGoNextFromInfo ? '请先完善上一页信息' : (draftPoint?.length ?? 0) < 1 ? '请先点选一个位置' : saving ? '保存中' : '完成并保存'}
          >
            {saving ? '保存中...' : '完成'}
          </AppButton>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-xs text-gray-600">绘制说明：当前已启用点绘制模式。请在地图上点选位置；完成后点击右上角“完成”。</div>

        <div className="text-xs text-gray-700">
          将生成：
          <div className="mt-1 font-mono text-xs break-all">
            PointID = {worldPrefix}{kind}DBZ{selected?.skind2 || '...'}_{abbrNormalized || '...'}
          </div>
        </div>

        <div className="text-xs text-gray-700">
          当前点数：<span className="font-mono">{Array.isArray(draftPoint) ? draftPoint.length : 0}</span>
          <AppButton
            type="button"
            className="ml-2 px-2 py-1 text-sm rounded border bg-white hover:bg-gray-100"
            onClick={() => {
              bridgeRef.current.clearTempPoints();
            }}
          >
            清空草稿
          </AppButton>
        </div>

        {saveError ? <div className="text-xs text-red-600">{saveError}</div> : null}
      </div>
    </div>
  );
}
