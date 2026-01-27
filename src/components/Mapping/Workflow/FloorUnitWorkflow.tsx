// File: src/components/Mapping/Workflow/FloorUnitWorkflow.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowComponentProps, WorldPoint } from './WorkflowHost';
import AppButton from '@/components/ui/AppButton';
import {
  EXT_VALUE_TYPE_TEXT,
  type ExtValueType,
  EXT_VALUE_TYPE_OPTIONS,
  listCatalogClassOptions,
} from '@/components/Mapping/featureFormats';

/**
 * FloorUnitWorkflow（工作流：楼内单元 / FLR）
 *
 * 结构对齐 NaturalLandWorkflow：
 * 1) 填写者信息（CreateBy）
 * 2) 信息填写（Class=FLR 下全部面要素：选择 Kind/SKind + 名称/简称/命名者/wiki + 额外字段：BuildingID、NofFloor + 可选字段 + extensions）
 * 3) FLR（建筑楼层）绘制：完成后写入固定图层，并退出回到快捷测绘主页面
 */

type Step = 'creator' | 'info' | 'draw';

type InfoForm = {
  typeKey: string; // `${kind}|${skind}`
  name: string;
  abbr: string;
  nomenclator: string;
  wiki?: string;

  brief?: string; // 简介
  // required
  buildingId: string; // 所属建筑
  nofFloor: string; // 楼层

  // optional
  land?: string; // 所属大陆(一级)
  uadm?: string; // 所属聚落(地标点)
  uadmg?: string; // 所属聚落(区划)
  pop?: string; // 相关成员
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

export default function FloorUnitWorkflow(props: WorkflowComponentProps) {
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
    
    brief: '',buildingId: '',
    nofFloor: '',
    land: '',
    uadm: '',
    uadmg: '',
    pop: '',
  });
  const [extItems, setExtItems] = useState<ExtensionItem[]>([]);

  // Page 3
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>('');

  const worldPrefix = useMemo(() => resolveWorldPrefix(bridge.getCurrentWorldId?.() ?? ''), [bridge]);
  const classCode = 'FLR';

  const typeOptions = useMemo(() => {
    return listCatalogClassOptions({ classCode, geom: '面' });
  }, []);

  const selected = useMemo(() => {
    const key = String(info.typeKey ?? '');
    if (!key) return null;
    const [kind, skind] = key.split('|');
    return typeOptions.find((o) => o.kind === kind && o.skind === skind) ?? null;
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

    bridgeRef.current.setDrawMode('polygon');
  }, [step, creatorId]);

  const canGoNextFromCreator = useMemo(() => nonEmpty(creatorId), [creatorId]);
  const abbrNormalized = useMemo(() => normalizeAbbr(info.abbr), [info.abbr]);

  const canGoNextFromInfo = useMemo(() => {
    return (
      nonEmpty(info.typeKey) &&
      nonEmpty(info.name) &&
      nonEmpty(abbrNormalized) &&
      nonEmpty(info.nomenclator) &&
      nonEmpty(info.buildingId) &&
      nonEmpty(info.nofFloor)
    );
  }, [info.typeKey, info.name, abbrNormalized, info.nomenclator, info.buildingId, info.nofFloor]);

  const draftPolygon: WorldPoint[] = step === 'draw' ? (bridge.getTempPoints?.() ?? []) : [];

  const canCommit = useMemo(() => {
    return canGoNextFromInfo && Array.isArray(draftPolygon) && draftPolygon.length >= 3 && !saving;
  }, [canGoNextFromInfo, draftPolygon.length, saving]);

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
    if (!canCommit || !selected) return;
    setSaving(true);
    setSaveError('');

    try {
      const pts = bridgeRef.current.getTempPoints?.() ?? [];
      const coords = (Array.isArray(pts) ? pts : []) as any;

      const floorId = `${worldPrefix}${classCode}${selected.kind}${selected.skind}_${abbrNormalized}`;

      // extensions：先写入 link.wiki，再拼接用户自定义条目
      const extList: ExtensionItem[] = [];
      const wiki = String(info.wiki ?? '').trim();
      if (wiki) {
        extList.push({ extGroup: 'link', extKey: 'wiki', extType: EXT_VALUE_TYPE_TEXT, extValue: wiki });
      }

      const brief = String(info.brief ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
      if (brief) {
        extList.push({ extGroup: 'character', extKey: 'brief', extType: EXT_VALUE_TYPE_TEXT, extValue: brief });
      }
      for (const it of extItems ?? []) {
        const g = String(it.extGroup ?? '').trim();
        const k = String(it.extKey ?? '').trim();
        if (!g || !k) continue;
        if (g === 'link' && k === 'wiki') continue;
        if (g === 'character' && k === 'brief') continue;
        extList.push({
          extGroup: g,
          extKey: k,
          extType: (it.extType ?? EXT_VALUE_TYPE_TEXT) as ExtValueType,
          extValue: String(it.extValue ?? ''),
        });
      }

      const tags: Array<{ tagKey: string; tagValue: any }> = [];
      tags.push({ tagKey: 'nomenclator', tagValue: String(info.nomenclator ?? '').trim() });

      const land = String(info.land ?? '').trim();
      if (land) tags.push({ tagKey: 'Land', tagValue: land });

      const uadm = String(info.uadm ?? '').trim();
      if (uadm) tags.push({ tagKey: 'UAdm', tagValue: uadm });

      const uadmg = String(info.uadmg ?? '').trim();
      if (uadmg) tags.push({ tagKey: 'UAdmG', tagValue: uadmg });

      const pop = String(info.pop ?? '').trim();
      if (pop) tags.push({ tagKey: 'Pop', tagValue: pop });

      const res = bridgeRef.current.commitFeature({
        subType: '建筑楼层',
        mode: 'polygon',
        coords,
        editorId: creatorId.trim(),
        values: {
          FloorID: floorId,
          FloorName: String(info.name ?? '').trim(),
          NofFloor: String(info.nofFloor ?? '').trim(),
          FloorKind: selected.kind,
          FloorSKind: selected.skind,
          BuildingID: String(info.buildingId ?? '').trim(),
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

  // --------- render ----------
  if (step === 'creator') {
    return (
      <div className="p-3 rounded border border-gray-300 bg-white">
        <TopNav title="楼内单元：填写者信息" showNext nextDisabled={!canGoNextFromCreator} onNext={() => setStep('info')} />

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
          title="楼内单元：信息填写"
          showPrev
          showNext
          prevDisabled={false}
          nextDisabled={!canGoNextFromInfo}
          onPrev={() => setStep('creator')}
          onNext={() => setStep('draw')}
        />

        <div className="space-y-3">
          <label className="block space-y-1">
            <div className="text-xs opacity-80">类型（Class=FLR）</div>
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
                <option key={`${o.kind}|${o.skind}`} value={`${o.kind}|${o.skind}`}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <LabeledInput label="名称" value={info.name} placeholder="例如：站厅" onChange={(v) => setInfo((p) => ({ ...p, name: v }))} />
          <LabeledInput label="字符简称（用于ID后缀）" value={info.abbr} placeholder="例如：HALL" onChange={(v) => setInfo((p) => ({ ...p, abbr: v }))} />
          <LabeledInput label="命名者（nomenclator）" value={info.nomenclator} placeholder="例如：YZ" onChange={(v) => setInfo((p) => ({ ...p, nomenclator: v }))} />

          <div className="grid grid-cols-2 gap-2">
            <LabeledInput label="所属建筑（BuildingID）[必填]" value={info.buildingId} placeholder="例如：ZBUDNOMNOM_XXX" onChange={(v) => setInfo((p) => ({ ...p, buildingId: v }))} />
            <LabeledInput label="楼层（NofFloor）[必填]" value={info.nofFloor} placeholder="例如：B1 / 1 / 2" onChange={(v) => setInfo((p) => ({ ...p, nofFloor: v }))} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <LabeledInput label="所属大陆(一级)（可选）" value={info.land ?? ''} onChange={(v) => setInfo((p) => ({ ...p, land: v }))} />
            <LabeledInput label="所属聚落(地标点)（可选）" value={info.uadm ?? ''} onChange={(v) => setInfo((p) => ({ ...p, uadm: v }))} />
            <LabeledInput label="所属聚落(区划)（可选）" value={info.uadmg ?? ''} onChange={(v) => setInfo((p) => ({ ...p, uadmg: v }))} />
            <LabeledInput label="相关成员（可选）" value={info.pop ?? ''} onChange={(v) => setInfo((p) => ({ ...p, pop: v }))} />
          </div>

          <LabeledInput label="wiki链接（可选）" value={info.wiki ?? ''} placeholder="例如：wiki.ria.red/xxx" onChange={(v) => setInfo((p) => ({ ...p, wiki: v }))} />



          <LabeledBriefInput
            label="简介（可选，将写入 extensions.character.brief）"
            value={info.brief ?? ''}
            placeholder="支持长文本输入（不支持换行）"
            onChange={(v) => setInfo((prev) => ({ ...prev, brief: v }))}
          />
          <div className="pt-2 border-t">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">extensions（可选）</div>
              <AppButton type="button" className="px-2 py-1 text-xs border rounded hover:bg-gray-50" onClick={addExtensionRow}>
                + 添加
              </AppButton>
            </div>
            <div className="mt-2 space-y-2">
              {extItems.length === 0 ? <div className="text-xs text-gray-500">（无）</div> : null}
              {extItems.map((it, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <input
                    className="col-span-3 border p-1 rounded text-xs"
                    placeholder="group"
                    value={it.extGroup}
                    onChange={(e) => updateExtensionRow(idx, { extGroup: e.target.value })}
                    onMouseDownCapture={(e) => e.stopPropagation()}
                    onPointerDownCapture={(e) => e.stopPropagation()}
                    onTouchStartCapture={(e) => e.stopPropagation()}
                  />
                  <input
                    className="col-span-3 border p-1 rounded text-xs"
                    placeholder="key"
                    value={it.extKey}
                    onChange={(e) => updateExtensionRow(idx, { extKey: e.target.value })}
                    onMouseDownCapture={(e) => e.stopPropagation()}
                    onPointerDownCapture={(e) => e.stopPropagation()}
                    onTouchStartCapture={(e) => e.stopPropagation()}
                  />
                  <select
                    className="col-span-3 border p-1 rounded text-xs"
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
                  <input
                    className="col-span-2 border p-1 rounded text-xs"
                    placeholder="value"
                    value={it.extValue}
                    onChange={(e) => updateExtensionRow(idx, { extValue: e.target.value })}
                    onMouseDownCapture={(e) => e.stopPropagation()}
                    onPointerDownCapture={(e) => e.stopPropagation()}
                    onTouchStartCapture={(e) => e.stopPropagation()}
                  />
                  <AppButton
                    type="button"
                    className="col-span-1 px-2 py-1 text-xs border rounded hover:bg-gray-50"
                    onClick={() => removeExtensionRow(idx)}
                    title="删除"
                  >
                    ×
                  </AppButton>
                </div>
              ))}
            </div>

            <div className="mt-2 text-xs text-gray-600">提示：wiki 链接会自动写入 extensions.link.wiki；如需更多字段可在此添加。</div>
          </div>
        </div>
      </div>
    );
  }

  // draw
  return (
    <div className="p-3 rounded border border-gray-300 bg-white">
      <TopNav title="楼内单元：绘制（面）" showPrev prevDisabled={false} onPrev={() => setStep('info')} />

      <div className="text-xs text-gray-700 mb-2">请在地图上绘制面要素（至少 3 个点）。完成后点击“保存”。</div>

      <div className="text-xs text-gray-600 mb-2">
        当前点数：<span className="font-mono">{draftPolygon.length}</span>
      </div>

      {saveError ? <div className="text-xs text-red-600 mb-2">{saveError}</div> : null}

      <div className="flex items-center gap-2">
        <AppButton
          type="button"
          className={`px-3 py-1.5 rounded text-sm border ${canCommit ? 'hover:bg-gray-50' : 'opacity-50 cursor-not-allowed'}`}
          disabled={!canCommit}
          onClick={commit}
        >
          {saving ? '保存中...' : '保存'}
        </AppButton>
        <AppButton
          type="button"
          className="px-3 py-1.5 rounded text-sm border hover:bg-gray-50"
          onClick={() => {
            bridgeRef.current.clearTempPoints();
          }}
        >
          清空草稿
        </AppButton>
        <AppButton type="button" className="ml-auto px-3 py-1.5 rounded text-sm border hover:bg-gray-50" onClick={() => bridgeRef.current.exitWorkflowToSelector()}>
          返回
        </AppButton>
      </div>

      <div className="mt-3 text-xs text-gray-600">
        将写入：FloorID = {worldPrefix}FLR{selected?.kind ?? '...'}{selected?.skind ?? '...'}_{abbrNormalized}；BuildingID = {String(info.buildingId ?? '').trim() || '...'}；NofFloor = {String(info.nofFloor ?? '').trim() || '...'}
      </div>
    </div>
  );
}
