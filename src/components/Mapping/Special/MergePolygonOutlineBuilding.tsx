import  { useMemo } from 'react';
import {
  FORMAT_REGISTRY,
  type FieldDef,
  type GroupDef,
} from '@/components/Mapping/featureFormats';
import AppButton from '@/components/ui/AppButton';

export type DraftBundle = {
  values: Record<string, any>;
  groups: Record<string, any[]>;
};

export type MergePolygonOutlineBuildingDraft = {
  outline: DraftBundle | null;   // 站台轮廓（最多一个）
  building: DraftBundle | null;  // 车站建筑（最多一个）
};

type Props = {
  draft: MergePolygonOutlineBuildingDraft;
  onChange: (next: MergePolygonOutlineBuildingDraft) => void;
  outlineKey?: string;  // 默认 '站台轮廓'
  buildingKey?: string; // 默认 '车站建筑'
};

function emptyValues(fields: FieldDef[]) {
  const v: Record<string, any> = {};
  for (const f of fields) {
    if (f.defaultValue !== undefined) v[f.key] = f.defaultValue;
    else if (f.type === 'bool') v[f.key] = false;
    else if (f.type === 'select') v[f.key] = f.options?.[0]?.value ?? '';
    else v[f.key] = '';
  }
  return v;
}

function emptyGroups(groups?: GroupDef[]) {
  const g: Record<string, any[]> = {};
  (groups ?? []).forEach(gr => { g[gr.key] = []; });
  return g;
}

function FieldEditor({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: any;
  onChange: (v: any) => void;
}) {
  if (field.type === 'select') {
    return (
      <select
        className="border p-1 rounded w-full"
        value={value ?? field.options?.[0]?.value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        {(field.options ?? []).map((o) => (
          <option key={String(o.value)} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === 'bool') {
    return (
      <select
        className="border p-1 rounded w-full"
        value={String(Boolean(value))}
        onChange={(e) => onChange(e.target.value === 'true')}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  return (
    <input
      className="border p-1 rounded w-full"
      type={field.type === 'number' ? 'number' : 'text'}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder ?? ''}
    />
  );
}

function GroupsEditor({
  groupsDef,
  bundle,
  onChange,
}: {
  groupsDef?: GroupDef[];
  bundle: DraftBundle;
  onChange: (next: DraftBundle) => void;
}) {
  if (!groupsDef?.length) return null;

  return (
    <div className="mt-2 space-y-2">
      {groupsDef.map((gr) => {
        const arr = Array.isArray(bundle.groups?.[gr.key]) ? bundle.groups[gr.key] : [];
        return (
          <div key={gr.key} className="border rounded p-2">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-bold text-gray-700">{gr.label}</div>
              <AppButton
                type="button"
                className="px-2 py-1 text-xs rounded border hover:bg-gray-50"
                onClick={() => {
                  const emptyItem: Record<string, any> = {};
                  for (const f of gr.fields) {
                    if (f.defaultValue !== undefined) emptyItem[f.key] = f.defaultValue;
                    else if (f.type === 'bool') emptyItem[f.key] = false;
                    else if (f.type === 'select') emptyItem[f.key] = f.options?.[0]?.value ?? '';
                    else emptyItem[f.key] = '';
                  }
                  const nextArr = [...arr, emptyItem];
                  onChange({
                    ...bundle,
                    groups: { ...(bundle.groups ?? {}), [gr.key]: nextArr },
                  });
                }}
              >
                {gr.addButtonText ?? '添加条目'}
              </AppButton>
            </div>

            {arr.length === 0 && <div className="text-xs text-gray-500">暂无条目</div>}

            {arr.map((item, idx) => (
              <div key={idx} className="border rounded p-2 mb-2">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-gray-700">{gr.key} #{idx + 1}</div>
                  <AppButton
                    type="button"
                    className="px-2 py-1 text-xs rounded border hover:bg-gray-50"
                    onClick={() => {
                      const nextArr = arr.filter((_, i) => i !== idx);
                      onChange({
                        ...bundle,
                        groups: { ...(bundle.groups ?? {}), [gr.key]: nextArr },
                      });
                    }}
                  >
                    删除
                  </AppButton>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {gr.fields.map((f) => (
                    <div key={f.key}>
                      <div className="text-xs text-gray-600 mb-1">{f.label}</div>
                      <FieldEditor
                        field={f}
                        value={item?.[f.key]}
                        onChange={(v) => {
                          const nextItem = { ...(item ?? {}), [f.key]: v };
                          const nextArr = arr.map((it, i) => (i === idx ? nextItem : it));
                          onChange({
                            ...bundle,
                            groups: { ...(bundle.groups ?? {}), [gr.key]: nextArr },
                          });
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function BundleEditor({
  title,
  defKey,
  bundle,
  onChange,
  onRemove,
}: {
  title: string;
  defKey: string;
  bundle: DraftBundle;
  onChange: (next: DraftBundle) => void;
  onRemove: () => void;
}) {
  const def: any = (FORMAT_REGISTRY as any)[defKey];
  const fields: FieldDef[] = def?.fields ?? [];
  const groupsDef: GroupDef[] | undefined = def?.groups ?? [];

  return (
    <div className="border rounded p-2">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-bold text-gray-800">{title}</div>
        <AppButton
          type="button"
          className="px-2 py-1 text-xs rounded border hover:bg-gray-50"
          onClick={onRemove}
        >
          删除
        </AppButton>
      </div>

      {fields.length === 0 && <div className="text-xs text-gray-500">该类型暂无字段</div>}

      {fields.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {fields.map((f) => (
            <div key={f.key}>
              <div className="text-xs text-gray-600 mb-1">{f.label}</div>
              <FieldEditor
                field={f}
                value={bundle.values?.[f.key]}
                onChange={(v) => onChange({ ...bundle, values: { ...(bundle.values ?? {}), [f.key]: v } })}
              />
            </div>
          ))}
        </div>
      )}

      <GroupsEditor groupsDef={groupsDef} bundle={bundle} onChange={onChange} />
    </div>
  );
}

export default function MergePolygonOutlineBuilding(props: Props) {
  const { draft, onChange } = props;
  const outlineKey = props.outlineKey ?? '站台轮廓';
  const buildingKey = props.buildingKey ?? '车站建筑';

  const outlineDefOk = useMemo(() => Boolean((FORMAT_REGISTRY as any)[outlineKey]), [outlineKey]);
  const buildingDefOk = useMemo(() => Boolean((FORMAT_REGISTRY as any)[buildingKey]), [buildingKey]);

  return (
    <div className="mt-2 space-y-2">
      <div className="text-xs text-gray-600">
        多面合一模式：你在地图上绘制一套面控制点，但可分别录入“站台轮廓”和“车站建筑”的附加信息，保存时会拆成 1~2 个图层导入图层管理。
      </div>

      <div className="flex gap-2">
        <AppButton
          type="button"
          className="px-2 py-1 text-xs rounded border hover:bg-gray-50"
          disabled={!outlineDefOk || Boolean(draft.outline)}
          onClick={() => {
            const def: any = (FORMAT_REGISTRY as any)[outlineKey];
            const bundle: DraftBundle = {
              values: emptyValues(def?.fields ?? []),
              groups: emptyGroups(def?.groups ?? []),
            };
            onChange({ ...draft, outline: bundle });
          }}
        >
          添加站台轮廓
        </AppButton>

        <AppButton
          type="button"
          className="px-2 py-1 text-xs rounded border hover:bg-gray-50"
          disabled={!buildingDefOk || Boolean(draft.building)}
          onClick={() => {
            const def: any = (FORMAT_REGISTRY as any)[buildingKey];
            const bundle: DraftBundle = {
              values: emptyValues(def?.fields ?? []),
              groups: emptyGroups(def?.groups ?? []),
            };
            onChange({ ...draft, building: bundle });
          }}
        >
          添加车站建筑
        </AppButton>
      </div>

      {draft.outline ? (
        <BundleEditor
          title="站台轮廓"
          defKey={outlineKey}
          bundle={draft.outline}
          onRemove={() => onChange({ ...draft, outline: null })}
          onChange={(nb) => onChange({ ...draft, outline: nb })}
        />
      ) : (
        <div className="text-xs text-gray-500">尚未添加站台轮廓</div>
      )}

      {draft.building ? (
        <BundleEditor
          title="车站建筑"
          defKey={buildingKey}
          bundle={draft.building}
          onRemove={() => onChange({ ...draft, building: null })}
          onChange={(nb) => onChange({ ...draft, building: nb })}
        />
      ) : (
        <div className="text-xs text-gray-500">尚未添加车站建筑</div>
      )}
    </div>
  );
}