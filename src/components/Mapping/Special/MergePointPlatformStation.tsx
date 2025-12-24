import { useMemo } from 'react';
import {
  FORMAT_REGISTRY,
  type FieldDef,
  type GroupDef,
} from '@/components/Mapping/featureFormats';

export type DraftBundle = {
  values: Record<string, any>;
  groups: Record<string, any[]>;
};

export type MergePointPlatformStationDraft = {
  platforms: DraftBundle[];       // 可多个
  station: DraftBundle | null;    // 只允许一个
};

type Props = {
  draft: MergePointPlatformStationDraft;
  onChange: (next: MergePointPlatformStationDraft) => void;
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
              <button
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
              </button>
            </div>

            {arr.length === 0 && <div className="text-xs text-gray-500">暂无条目</div>}

            {arr.map((item, idx) => (
              <div key={idx} className="border rounded p-2 mb-2">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-gray-700">{gr.key} #{idx + 1}</div>
                  <button
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
                  </button>
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
  removable,
}: {
  title: string;
  defKey: string;
  bundle: DraftBundle;
  onChange: (next: DraftBundle) => void;
  onRemove?: () => void;
  removable?: boolean;
}) {
  const def: any = (FORMAT_REGISTRY as any)[defKey];
  const fields: FieldDef[] = def?.fields ?? [];
  const groupsDef: GroupDef[] | undefined = def?.groups ?? [];

  return (
    <div className="border rounded p-2">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-bold text-gray-800">{title}</div>
        {removable && (
          <button
            type="button"
            className="px-2 py-1 text-xs rounded border hover:bg-gray-50"
            onClick={onRemove}
          >
            删除
          </button>
        )}
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

      <GroupsEditor
        groupsDef={groupsDef}
        bundle={bundle}
        onChange={onChange}
      />
    </div>
  );
}

export default function MergePointPlatformStation(props: Props) {
  const { draft, onChange } = props;

  const platformDefOk = useMemo(() => Boolean((FORMAT_REGISTRY as any)['站台']), []);
  const stationDefOk = useMemo(() => Boolean((FORMAT_REGISTRY as any)['车站']), []);

  return (
    <div className="mt-2 space-y-2">
      <div className="text-xs text-gray-600">
        多点合一模式：你只在地图上绘制一个点坐标，但可以录入多个“站台”和一个“车站”，保存时会自动拆成多个图层导入图层管理。
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className="px-2 py-1 text-xs rounded border hover:bg-gray-50"
          disabled={!platformDefOk}
          onClick={() => {
            const def: any = (FORMAT_REGISTRY as any)['站台'];
            const bundle: DraftBundle = {
              values: emptyValues(def?.fields ?? []),
              groups: emptyGroups(def?.groups ?? []),
            };
            onChange({ ...draft, platforms: [...(draft.platforms ?? []), bundle] });
          }}
        >
          添加站台
        </button>

        <button
          type="button"
          className="px-2 py-1 text-xs rounded border hover:bg-gray-50"
          disabled={!stationDefOk || Boolean(draft.station)}
          onClick={() => {
            const def: any = (FORMAT_REGISTRY as any)['车站'];
            const bundle: DraftBundle = {
              values: emptyValues(def?.fields ?? []),
              groups: emptyGroups(def?.groups ?? []),
            };
            onChange({ ...draft, station: bundle });
          }}
        >
          添加车站
        </button>
      </div>

      {/* 站台列表 */}
      {draft.platforms.length === 0 ? (
        <div className="text-xs text-gray-500">尚未添加站台</div>
      ) : (
        <div className="space-y-2">
          {draft.platforms.map((b, idx) => (
            <BundleEditor
              key={idx}
              title={`站台 #${idx + 1}`}
              defKey="站台"
              bundle={b}
              removable
              onRemove={() => {
                const next = draft.platforms.filter((_, i) => i !== idx);
                onChange({ ...draft, platforms: next });
              }}
              onChange={(nb) => {
                const next = draft.platforms.map((it, i) => (i === idx ? nb : it));
                onChange({ ...draft, platforms: next });
              }}
            />
          ))}
        </div>
      )}

      {/* 车站（单个） */}
      {draft.station ? (
        <BundleEditor
          title="车站"
          defKey="车站"
          bundle={draft.station}
          removable
          onRemove={() => onChange({ ...draft, station: null })}
          onChange={(nb) => onChange({ ...draft, station: nb })}
        />
      ) : (
        <div className="text-xs text-gray-500">尚未添加车站</div>
      )}
    </div>
  );
}
