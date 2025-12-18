import { useEffect, useRef, useState} from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  FORMAT_REGISTRY,
  getSubTypeOptions,
  layerToJsonText,
  parseCoordListFlexible,
  type FeatureKey,
  type ImportFormat,
  type DrawMode,
} from '@/components/Mapping/featureFormats';

// 你项目里实际用到的类型（保持与 MapContainer 一致）
import type { DynmapProjection } from '@/lib/DynmapProjection';

/**
 * 关键：把 MapContainer 里的引用对象（ref）当 props 传进来
 * 这属于 React 组件间通过 props 传值的常规做法。:contentReference[oaicite:1]{index=1}
 */
type MeasuringModuleProps = {
  mapReady: boolean;
  leafletMapRef: React.MutableRefObject<L.Map | null>;
  projectionRef: React.MutableRefObject<DynmapProjection | null>;

  // 新增：外部强制关闭信号（MapContainer 递增）
  closeSignal?: number;

  // 新增：当本模块打开时通知 MapContainer 关闭别的面板
  onBecameActive?: () => void;
};

export default function MeasuringModule(props: MeasuringModuleProps) {
  const { mapReady, leafletMapRef, projectionRef, closeSignal, onBecameActive } = props;


// ---------- 测绘 & 图层管理状态 ------------
const [measuringActive, setMeasuringActive] = useState(false); // 是否开启测绘控制UI
const [drawMode, setDrawMode] = useState<'none'|'point'|'polyline'|'polygon'>('none');
const [drawColor, setDrawColor] = useState('#ff0000');         // 当前颜色
const [drawing, setDrawing] = useState(false);                  // 是否正在绘制中

// 当前临时点集合（临时绘制的坐标）
const [tempPoints, setTempPoints] = useState<Array<{x:number;z:number}>>([]);

// 临时图层
const tempLayerGroupRef = useRef<L.LayerGroup|null>(null);



// 扩展 LayerType 定义（包含 jsonInfo）
type LayerType = {
  id: number;
  mode: 'point' | 'polyline' | 'polygon';
  color: string;
  coords: { x: number; z: number }[];
  visible: boolean;
  leafletGroup: L.LayerGroup;
  jsonInfo?: {
  subType: FeatureKey;
  featureInfo: any;
};

};

// 所有固定图层
const [layers, setLayers] = useState<LayerType[]>([]);
const nextLayerId = useRef(1);

// 编辑模式下被编辑的图层ID
const [editingLayerId, setEditingLayerId] = useState<number|null>(null);

// 子类型选择
const [subType, setSubType] = useState<FeatureKey>('默认');

// 撤销/重做栈
const [redoStack, setRedoStack] = useState<Array<{ x: number; z: number }>>([]);

// 当前 JSON 特征信息
const [featureInfo, setFeatureInfo] = useState<any>({});

// JSON 表单：动态 fields/groups（由 FORMAT_REGISTRY[subType] 驱动）
const [groupInfo, setGroupInfo] = useState<Record<string, any[]>>({});


// ---- 导入矢量数据相关状态 ----
const [importPanelOpen, setImportPanelOpen] = useState(false);

const [importFormat, setImportFormat] = useState<ImportFormat>('点');

const [importText, setImportText] = useState('');

const randomColor = () => {
  const r = Math.floor(Math.random()*255);
  const g = Math.floor(Math.random()*255);
  const b = Math.floor(Math.random()*255);
  return `rgb(${r},${g},${b})`;
};

// 两个顶层容器：固定图层容器(2) + 编辑/绘制容器(1)
const fixedRootRef = useRef<L.LayerGroup | null>(null);
const draftRootRef = useRef<L.LayerGroup | null>(null);

// draft 内真正承载“当前正在编辑/绘制”的那一层（保证容器1永远只有一份图形）
const draftGeomRef = useRef<L.LayerGroup | null>(null);

// A) 外部强制关闭：视同“结束测绘”，并且清空图层（不提示）
useEffect(() => {
  if (closeSignal === undefined) return;

  // 关闭 UI
  setMeasuringActive(false);

  // 清空测绘图层
  clearAllLayers();

  // 关闭导入面板（如果你希望一并收起）
  setImportPanelOpen(false);

  // 退出绘制态
  setDrawing(false);
  setDrawMode('none');
  setTempPoints([]);
  setRedoStack([]);
  setEditingLayerId(null);
}, [closeSignal]);




useEffect(() => {
  if (!leafletMapRef.current) return;
  const map = leafletMapRef.current;

  if (!fixedRootRef.current) {
    fixedRootRef.current = L.layerGroup().addTo(map);
  }
  if (!draftRootRef.current) {
    draftRootRef.current = L.layerGroup().addTo(map);
  }
  if (!draftGeomRef.current) {
    draftGeomRef.current = L.layerGroup();
    draftRootRef.current.addLayer(draftGeomRef.current);
  }
}, [mapReady]);


 // ========= 地图点击监听（绘制模式） =========
 useEffect(() => {
   const map = leafletMapRef.current;
   if (!map) {
     return;
   }
 
   const handleClick = (e: L.LeafletMouseEvent) => {
     if (!drawing || drawMode === 'none') return;
     onMapDrawClick(e);
   };
 
   map.on('click', handleClick);
 
   return () => {
     map.off('click', handleClick);
   };
 }, [drawing, drawMode, drawColor]);
 
 
 // ========= 点击地图事件处理 =========
 // 统一：无论新画/编辑，点击都只画进 draftGeomRef（容器1），彻底杜绝 tempLayerGroupRef 幽灵副本
 const onMapDrawClick = (e: L.LeafletMouseEvent) => {
   const proj = projectionRef.current;
   if (!proj) return;
 
   const loc = proj.latLngToLocation(e.latlng, 64);
   const newPoint = { x: loc.x, z: loc.z };
 
   setTempPoints(prev => {
     const updated = [...prev, newPoint];
 
     // 关键：只画进 draftGeomRef
     drawDraftGeometry(updated, drawMode, drawColor);
 
     return updated;
   });
 };
 
 // ========= 容器1：绘制/编辑专用 =========
 const drawDraftGeometry = (
   coords: { x: number; z: number }[],
   mode: 'none' | 'point' | 'polyline' | 'polygon',
   color: string
 ) => {
   const proj = projectionRef.current;
   const draft = draftGeomRef.current;
   if (!proj || !draft) return;
 
   draft.clearLayers();
 
   if (mode === 'none' || coords.length === 0) return;
 
   const latlngs = coords.map(p => proj.locationToLatLng(p.x, 64, p.z));
 
   if (mode === 'point') {
     latlngs.forEach(ll => {
       L.circleMarker(ll, { color, fillColor: color, radius: 6 }).addTo(draft);
     });
   } else if (mode === 'polyline') {
     L.polyline(latlngs, { color }).addTo(draft);
   } else if (mode === 'polygon') {
     if (latlngs.length > 2) L.polygon(latlngs, { color }).addTo(draft);
     else L.polyline(latlngs, { color }).addTo(draft);
   }
 };
 
 
 
 // 让异步回调始终拿到最新 layers（避免 setTimeout / 事件回调拿旧闭包）
 const layersRef = useRef<LayerType[]>([]);
 useEffect(() => {
   layersRef.current = layers;
 }, [layers]);
 
 
 
 // 固定容器2：只由 fixedRootRef 统一管理显示，禁止再对 layer.leafletGroup.addTo(map) 做“绕过式挂载”
 const syncFixedRoot = (nextLayers: LayerType[], editingId: number | null) => {
   const root = fixedRootRef.current;
   if (!root) return;
 
   root.clearLayers();
 
   for (const l of nextLayers) {
     if (!l.visible) continue;
     if (editingId !== null && l.id === editingId) continue; // 编辑中的层交给 draftGeomRef
     root.addLayer(l.leafletGroup);
   }
 };
 
 
const finishLayer = () => {
  const map = leafletMapRef.current;
  const proj = projectionRef.current;
  if (!map || !proj) return;

  if (drawMode === 'none') return;

  // —— 关键：编辑态允许“未改坐标直接保存”，此时用备份 coords 兜底
  const backup = editingBackupCoordsRef.current ?? [];
  const finalCoords =
    tempPoints.length > 0 ? [...tempPoints] :
    (editingLayerId !== null ? [...backup] : []);

  if (editingLayerId === null && finalCoords.length === 0) return;
  if (editingLayerId !== null && finalCoords.length === 0) return;

  // 统一由 registry 生成最终 featureInfo（不再在组件内手写各种 subtype 注入）
  const def = FORMAT_REGISTRY[subType] ?? FORMAT_REGISTRY['默认'];
  const finalFeatureInfo = def.buildFeatureInfo({
    mode: drawMode as DrawMode,
    coords: finalCoords,
    values: featureInfo ?? {},
    groups: groupInfo ?? {},
  });

  const newLayerId = editingLayerId ?? nextLayerId.current++;

  // 1) 先构建新的 leafletGroup（注意：不要 addTo(map)，只交给 fixedRootRef 管）
  const newGroup = L.layerGroup();
  const latlngs = finalCoords.map(p => proj.locationToLatLng(p.x, 64, p.z));

  if (drawMode === 'point') {
    latlngs.forEach(ll => {
      L.circleMarker(ll, { color: drawColor, fillColor: drawColor, radius: 6 }).addTo(newGroup);
    });
  } else if (drawMode === 'polyline') {
    L.polyline(latlngs, { color: drawColor }).addTo(newGroup);
  } else if (drawMode === 'polygon') {
    if (latlngs.length > 2) L.polygon(latlngs, { color: drawColor }).addTo(newGroup);
    else L.polyline(latlngs, { color: drawColor }).addTo(newGroup);
  }

  const layerObj: LayerType = {
    id: newLayerId,
    mode: drawMode,
    color: drawColor,
    coords: finalCoords,
    visible: true,
    leafletGroup: newGroup,
    jsonInfo: {
      subType,
      featureInfo: finalFeatureInfo,
    },
  };

  // 2) 更新 state，并且在同一个 setLayers 回调里同步 fixedRoot（避免时序错乱）
  setLayers(prev => {
    let next: LayerType[];

    if (editingLayerId !== null) {
      const old = prev.find(l => l.id === editingLayerId);
      if (old) fixedRootRef.current?.removeLayer(old.leafletGroup);

      next = prev.map(l => (l.id === editingLayerId ? layerObj : l));
    } else {
      next = [...prev, layerObj];
    }

    syncFixedRoot(next, null);
    return next;
  });

  // 3) 清空编辑容器
  draftGeomRef.current?.clearLayers();

  setTempPoints([]);
  setRedoStack([]);
  setEditingLayerId(null);
  editingBackupCoordsRef.current = null;

  setDrawing(false);
  setDrawMode('none');

  // 退出后统一回默认（用 hydrate 给默认值）
  setSubType('默认');
  const hydrated = FORMAT_REGISTRY['默认'].hydrate({});
  setFeatureInfo(hydrated.values ?? {});
  setGroupInfo(hydrated.groups ?? {});
};


 
 
 
 
 
 
 
 
 
 
 
 const getLayerJSONOutput = (layer: LayerType) => {
  return layerToJsonText(layer);
};

 
 
 const handleUndo = () => {
   if (!tempPoints.length) return;
   const last = tempPoints[tempPoints.length - 1];
   setRedoStack(prev => [...prev, last]);
   const updated = tempPoints.slice(0, tempPoints.length - 1);
   setTempPoints(updated);
   drawDraftGeometry(updated, drawMode, drawColor);
 };
 
 const handleRedo = () => {
   if (!redoStack.length) return;
   const redoPoint = redoStack[redoStack.length - 1];
   setRedoStack(prev => prev.slice(0, prev.length - 1));
   const updated = [...tempPoints, redoPoint];
   setTempPoints(updated);
   drawDraftGeometry(updated, drawMode, drawColor);
 };
 
 
 // ========= 清除所有图层 =========
 const clearAllLayers = () => {
   // 1) 清空两个容器（fixed + draft）
   fixedRootRef.current?.clearLayers();
   draftGeomRef.current?.clearLayers();
 
   // 2) 清空 state
   setLayers([]);
 
   // 3) 如你还有编辑态/临时点，也应一并重置（按你项目状态名自行保留/删减）
   setTempPoints?.([]);
   setRedoStack?.([]);
   setEditingLayerId?.(null);
   setDrawing?.(false);
   setDrawMode?.('none');
 };



 // A) 外部强制关闭：视同“退出测绘”，并清空（不提示）
useEffect(() => {
  if (closeSignal === undefined) return;

  setMeasuringActive(false);
  clearAllLayers();

  // 这些属于“退出测绘”语义：建议同时复位
  setImportPanelOpen(false);
  setDrawing(false);
  setDrawMode('none');
  setTempPoints([]);
  setRedoStack([]);
  setEditingLayerId(null);
}, [closeSignal]);



 
 
 const toggleLayerVisible = (id: number) => {
   setLayers(prev => {
     const next = prev.map(l => (l.id === id ? { ...l, visible: !l.visible } : l));
 
     // 编辑中的层：只改状态，不把它塞回 fixedRoot（否则会“编辑层 + 固定层”并存成幽灵）
     // 非编辑层：用 fixedRoot 统一重建，确保顺序/显隐与状态一致
     syncFixedRoot(next, editingLayerId);
 
     return next;
   });
 };
 
 
 
 const moveLayerUp = (id: number) => {
   setLayers(prev => {
     const idx = prev.findIndex(l => l.id === id);
     if (idx <= 0) return prev;
 
     const next = [...prev];
     [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
 
     syncFixedRoot(next, editingLayerId);
     return next;
   });
 };
 
 
 const moveLayerDown = (id: number) => {
   setLayers(prev => {
     const idx = prev.findIndex(l => l.id === id);
     if (idx < 0 || idx >= prev.length - 1) return prev;
 
     const next = [...prev];
     [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
 
     syncFixedRoot(next, editingLayerId);
     return next;
   });
 };
 
 
 // --------- 当前临时输出文本 ---------
const currentTempOutput = () => {
  if (tempPoints.length === 0 || drawMode === 'none') return '';

  const def = FORMAT_REGISTRY[subType];
  if (def?.hideTempOutput) return '';

  const pts = tempPoints.map(p => `${p.x.toFixed(1)},${p.z.toFixed(1)}`);
  if (drawMode === 'point') return `<point:${pts.join(';')}>`;
  if (drawMode === 'polyline') return `<polyline:${pts.join(';')}>`;
  return `<polygon:${pts.join(';')}>`;
};

 
 
 
 // 用一个 ref 记住“进入编辑时原始坐标”，避免某些时序下 tempPoints 为空导致保存丢失
 const editingBackupCoordsRef = useRef<{ x: number; z: number }[] | null>(null);
 
const editLayer = (id: number) => {
  const layer = layers.find(l => l.id === id);
  if (!layer) return;

  // 从固定容器移除（用 removeLayer 更稳）
  fixedRootRef.current?.removeLayer(layer.leafletGroup);

  // 备份原始坐标
  editingBackupCoordsRef.current = layer.coords;

  // 进入编辑态
  setEditingLayerId(id);
  setDrawing(true);
  setDrawMode(layer.mode);
  setDrawColor(layer.color);

  // 恢复坐标并画草稿
  setTempPoints(layer.coords);
  drawDraftGeometry(layer.coords, layer.mode, layer.color);

  // 恢复 jsonInfo：统一通过 registry.hydrate
  if (layer.jsonInfo) {
    const key = (layer.jsonInfo.subType ?? '默认') as FeatureKey;
    const def = FORMAT_REGISTRY[key] ?? FORMAT_REGISTRY['默认'];

    setSubType(key);

    const hydrated = def.hydrate(layer.jsonInfo.featureInfo ?? {});
    setFeatureInfo(hydrated.values ?? {});
    setGroupInfo(hydrated.groups ?? {});
  } else {
    setSubType('默认');
    const hydrated = FORMAT_REGISTRY['默认'].hydrate({});
    setFeatureInfo(hydrated.values ?? {});
    setGroupInfo(hydrated.groups ?? {});
  }
};


 
 
 
 
 
 
 
 // ========= 删除图层 =========
 const deleteLayer = (id: number) => {
   setLayers(prev => {
     const target = prev.find(l => l.id === id);
 
     // 先从固定容器移除（不要只 target.leafletGroup.remove()，否则可能仍残留在父 group 里，后续会“复活”）:contentReference[oaicite:3]{index=3}
     if (target) {
       fixedRootRef.current?.removeLayer(target.leafletGroup);
     }
 
     // 如果删的是正在编辑的那层：也清空草稿容器1
     if (editingLayerId === id) {
       draftGeomRef.current?.clearLayers();
       // 你如果有 setEditingLayerId(null)/setDrawing(false) 等，可在外层逻辑里做；
       // 这里按“最小替换”只处理图形清理
     }
 
     const next = prev.filter(l => l.id !== id);
 
     syncFixedRoot(next, editingLayerId === id ? null : editingLayerId);
     return next;
   });
 };
 
 
 

 
const handleImport = () => {
  const text = importText.trim();
  if (!text) return;

  const proj = projectionRef.current;
  const fixedRoot = fixedRootRef.current;

  if (!proj || !fixedRoot) {
    alert('地图/固定图层容器尚未就绪，无法导入');
    return;
  }

  const color = randomColor();

  // ========== 1) 点 / 线 / 面（文本坐标） ==========
  if (importFormat === '点' || importFormat === '线' || importFormat === '面') {
    const coords = parseCoordListFlexible(text);
    if (!coords) {
      alert('非法输入：请用 x,z;x,z 或 x,y,z;x,y,z 格式');
      return;
    }

    if (importFormat === '点' && coords.length !== 1) {
      alert('点模式只允许 1 个坐标');
      return;
    }
    if (importFormat === '线' && coords.length < 2) {
      alert('线模式至少需要 2 个坐标');
      return;
    }
    if (importFormat === '面' && coords.length < 3) {
      alert('面模式至少需要 3 个坐标');
      return;
    }

    const mode: DrawMode =
      importFormat === '点' ? 'point' :
      importFormat === '线' ? 'polyline' : 'polygon';

    const group = L.layerGroup();
    const latlngs = coords.map(p => proj.locationToLatLng(p.x, 64, p.z));

    if (mode === 'point') {
      latlngs.forEach(ll => {
        L.circleMarker(ll, { color, fillColor: color, radius: 6 }).addTo(group);
      });
    } else if (mode === 'polyline') {
      L.polyline(latlngs, { color }).addTo(group);
    } else {
      L.polygon(latlngs, { color }).addTo(group);
    }

    const def = FORMAT_REGISTRY['默认'];
    const featureInfoOut = def.buildFeatureInfo({
      mode,
      coords,
      values: {},
      groups: {},
    });

    const id = nextLayerId.current++;
    const newLayer: LayerType = {
      id,
      mode,
      color,
      coords,
      visible: true,
      leafletGroup: group,
      jsonInfo: {
        subType: '默认',
        featureInfo: featureInfoOut,
      },
    };

    setLayers(prev => {
      const next = [...prev, newLayer];
      syncFixedRoot(next, editingLayerId);
      return next;
    });

    setImportText('');
    setImportPanelOpen(false);
    return;
  }

  // ========== 2) JSON ==========
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    alert('非法 JSON：' + e);
    return;
  }

  if (!Array.isArray(parsed)) {
    alert('JSON 必须是数组');
    return;
  }

  const key = importFormat as unknown as FeatureKey;
  const def = FORMAT_REGISTRY[key];
  if (!def) {
    alert('未知导入格式：' + importFormat);
    return;
  }

  const newLayers: LayerType[] = [];

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    const itemColor = randomColor();

    const err = def.validateImportItem?.(item);
    if (err) {
      alert(`${def.label} 第 ${i + 1} 项不合法：${err}`);
      return;
    }

    const mode = def.modes[0];
    const coords = def.coordsFromFeatureInfo(item);

    if (mode === 'point' && coords.length !== 1) {
      alert(`${def.label} 第 ${i + 1} 项：点模式坐标必须为 1 个点`);
      return;
    }
    if (mode === 'polyline' && coords.length < 2) {
      alert(`${def.label} 第 ${i + 1} 项：线模式至少 2 个点`);
      return;
    }
    if (mode === 'polygon' && coords.length < 3) {
      alert(`${def.label} 第 ${i + 1} 项：面模式至少 3 个点`);
      return;
    }

    const hydrated = def.hydrate(item);
    const featureInfoOut = def.buildFeatureInfo({
      mode,
      coords,
      values: hydrated.values ?? {},
      groups: hydrated.groups ?? {},
    });

    const group = L.layerGroup();

    const yForDisplay =
      Number.isFinite(Number(item?.height)) ? Number(item.height)
      : Number.isFinite(Number(item?.heightH)) ? Number(item.heightH)
      : 64;

    const latlngs = coords.map(p => proj.locationToLatLng(p.x, yForDisplay, p.z));

    if (mode === 'point') {
      latlngs.forEach(ll => {
        L.circleMarker(ll, { color: itemColor, fillColor: itemColor, radius: 6 }).addTo(group);
      });
    } else if (mode === 'polyline') {
      L.polyline(latlngs, { color: itemColor }).addTo(group);
    } else {
      L.polygon(latlngs, { color: itemColor }).addTo(group);
    }

    const id = nextLayerId.current++;
    newLayers.push({
      id,
      mode,
      color: itemColor,
      coords,
      visible: true,
      leafletGroup: group,
      jsonInfo: {
        subType: key,
        featureInfo: featureInfoOut,
      },
    });
  }

  setLayers(prev => {
    const next = [...prev, ...newLayers];
    syncFixedRoot(next, editingLayerId);
    return next;
  });

  setImportText('');
  setImportPanelOpen(false);
};

 const subTypeOptions =
  drawMode === 'none'
    ? []
    : getSubTypeOptions(drawMode as DrawMode).filter(k => k !== '默认');

// ========= 动态附加信息渲染（由 FORMAT_REGISTRY[subType].fields/groups 驱动） =========
const activeDef = FORMAT_REGISTRY[subType];

const setValue = (key: string, value: any) => {
  setFeatureInfo((prev: any) => ({ ...prev, [key]: value }));
};

const setGroupItems = (groupKey: string, items: any[]) => {
  setGroupInfo(prev => ({ ...prev, [groupKey]: items }));
};

const coerceSelectValue = (field: any, raw: string) => {
  const opt = field.options?.find((o: any) => String(o.value) === raw);
  return opt ? opt.value : raw;
};

const renderField = (field: any, value: any, onChange: (v: any) => void) => {
  const label = field.optional ? `${field.label}（可选）` : field.label;

  if (field.type === 'select') {
    const current = value ?? (field.options?.[0]?.value ?? '');
    return (
      <div key={field.key} className="mb-2">
        <label className="block text-xs font-semibold mb-1">{label}</label>
        <select
          className="w-full border p-1 rounded"
          value={String(current)}
          onChange={(e) => onChange(coerceSelectValue(field, e.target.value))}
        >
          {(field.options ?? []).map((o: any) => (
            <option key={String(o.value)} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type === 'number') {
    return (
      <div key={field.key} className="mb-2">
        <label className="block text-xs font-semibold mb-1">{label}</label>
        <input
          type="number"
          className="w-full border p-1 rounded"
          placeholder={field.placeholder ?? field.key}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)} // 保留 ''，由 buildFeatureInfo/pickByFields 决定是否输出
        />
      </div>
    );
  }

  if (field.type === 'bool') {
    return (
      <div key={field.key} className="mb-2 flex items-center gap-2">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
        <label className="text-xs font-semibold">{label}</label>
      </div>
    );
  }

  // text
  return (
    <div key={field.key} className="mb-2">
      <label className="block text-xs font-semibold mb-1">{label}</label>
      <input
        type="text"
        className="w-full border p-1 rounded"
        placeholder={field.placeholder ?? field.key}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
};

const makeEmptyItem = (fields: any[]) => {
  const obj: Record<string, any> = {};
  for (const f of fields) {
    if (f.type === 'select') obj[f.key] = f.options?.[0]?.value ?? '';
    else if (f.type === 'bool') obj[f.key] = false;
    else obj[f.key] = '';
  }
  return obj;
};

const renderDynamicExtraInfo = () => {
  const hasFields = Array.isArray(activeDef?.fields) && activeDef.fields.length > 0;
  const hasGroups = Array.isArray(activeDef?.groups) && activeDef.groups.length > 0;

  if (!hasFields && !hasGroups) {
    return <div className="text-xs text-gray-500 mt-2">该类型无附加字段</div>;
  }

  return (
    <div className="mt-2">
      {hasFields && (
        <div className="mb-3">
          {activeDef.fields.map((f: any) =>
            renderField(f, featureInfo?.[f.key], (v) => setValue(f.key, v))
          )}
        </div>
      )}

      {hasGroups && (
        <div className="space-y-3">
          {activeDef.groups!.map((g: any) => {
            const items: any[] = (groupInfo?.[g.key] ?? []) as any[];

            return (
              <div key={g.key} className="border rounded p-2">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold">{g.label}</div>
                  <button
                    className="bg-blue-600 text-white px-2 py-1 rounded text-xs"
                    onClick={() => setGroupItems(g.key, [...items, makeEmptyItem(g.fields)])}
                    type="button"
                  >
                    {g.addButtonText ?? '添加'}
                  </button>
                </div>

                {items.length === 0 ? (
                  <div className="text-xs text-gray-500">暂无条目</div>
                ) : (
                  <div className="space-y-2">
                    {items.map((it, idx) => (
                      <div key={idx} className="border rounded p-2">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs font-semibold">#{idx + 1}</div>
                          <button
                            className="bg-red-600 text-white px-2 py-1 rounded text-xs"
                            onClick={() => setGroupItems(g.key, items.filter((_, i) => i !== idx))}
                            type="button"
                          >
                            删除
                          </button>
                        </div>

                        <div>
                          {g.fields.map((f: any) =>
                            renderField(
                              f,
                              it?.[f.key],
                              (v) => {
                                const nextItems = items.slice();
                                const nextItem = { ...(nextItems[idx] ?? {}) };
                                nextItem[f.key] = v;
                                nextItems[idx] = nextItem;
                                setGroupItems(g.key, nextItems);
                              }
                            )
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};


  return (
    <>
      {/* 主按钮 */}
      <div className="fixed top-5 right-40 z-[1000] w-72">
        {!measuringActive ? (
          <button
            className="bg-blue-600 text-white px-3 py-1 rounded-lg"
            onClick={() => {
  // 打开测绘时：要求自动关闭“测量工具”（视同结束对方）
  onBecameActive?.();

  // 同时按你新需求：切换主功能自动清空，不提示
  clearAllLayers();

  setMeasuringActive(true);
}}

          >
            开始测绘
          </button>
        ) : (
          <button
            className="bg-gray-600 text-white px-3 py-1 rounded-lg"
            onClick={() => setMeasuringActive(false)}
          >
            退出测绘
          </button>
        )}
      
        {measuringActive && (
          <button
            className="bg-red-600 text-white px-3 py-1 rounded-lg"
            onClick={clearAllLayers}
          >
            清除所有图层
          </button>
            ) }
            
            { (
          <button
        className="bg-purple-800 text-white px-3 py-1 rounded-lg"
        onClick={() => setImportPanelOpen(!importPanelOpen)}
      >
        导入矢量数据
      </button>
      
          
        )}
      </div>
      
      {/* 测绘菜单 */}
      {measuringActive && (
        <div className="fixed top-20 left-10 bg-white p-3 rounded-lg shadow-lg z-[1800] w-96 max-h-[70vh] overflow-y-auto">
          {/* 点/线/面 */}
          <div className="flex gap-2 mb-2">
            {(['point','polyline','polygon'] as const).map(m => (
              <button
                key={m}
                className={`flex-1 py-1 border ${
                  drawMode === m ? 'bg-blue-300' : ''
                }`}
                onClick={() => {
                  if (tempPoints.length > 0 && drawMode !== m) {
                    if (!confirm('切换模式将清空当前临时图形？')) return;
                    tempLayerGroupRef.current?.clearLayers();
                    setTempPoints([]);
                  }
                  setDrawMode(m);
                  setDrawing(true);
                  setSubType('默认');
const hydrated = FORMAT_REGISTRY['默认'].hydrate({});
setFeatureInfo(hydrated.values ?? {});
setGroupInfo(hydrated.groups ?? {});

                }}
              >
                {m === 'point' ? '点' : m === 'polyline' ? '线' : '面'}
              </button>
            ))}
          </div>
      
          {/* 要素类型下拉 */}
          {drawMode !== 'none' && (
            <div className="mb-2">
              <label className="block text-sm font-bold">要素类型</label>
              <select
  value={subType}
  onChange={e => {
  const next = e.target.value as FeatureKey; // TS 下 select 的 value 永远是 string，这里断言即可 :contentReference[oaicite:1]{index=1}
  setSubType(next);

  const hydrated = FORMAT_REGISTRY[next].hydrate({});
  setFeatureInfo(hydrated.values ?? {});
  setGroupInfo(hydrated.groups ?? {});
}}

  className="w-full border p-1 rounded"
>
  <option value="默认">默认</option>
  {subTypeOptions.map(k => (
    <option key={k} value={k}>
      {FORMAT_REGISTRY[k].label}
    </option>
  ))}
</select>

            </div>
          )}
      
          {/* 颜色 */}
          {drawMode !== 'none' && (
            <div className="mb-2">
              <label className="block mb-1 text-sm">颜色</label>
              <input
                type="color"
                value={drawColor}
                onChange={e => setDrawColor(e.target.value)}
                className="w-full"
              />
            </div>
          )}
      
          {/* 撤销/重做/完成 */}
          {drawMode !== 'none' && (
            <div className="flex gap-2 mb-2">
              <button className="bg-yellow-400 text-white px-2 py-1 rounded" onClick={handleUndo}>撤销</button>
              <button className="bg-orange-400 text-white px-2 py-1 rounded" onClick={handleRedo}>重做</button>
              <button className="bg-green-500 text-white px-3 py-1 rounded-lg flex-1" onClick={finishLayer}>
                {editingLayerId !== null ? '保存编辑图层' : '完成当前图层'}
              </button>
            </div>
          )}
      
          {/* 临时输出 */}
          <div className="mb-2">
            <label className="text-sm font-bold">临时输出</label>
            <textarea readOnly className="w-full h-20 border p-1" value={currentTempOutput()} />
          </div>
      
      {/* JSON 输入区 */}
{subType !== '默认' && (
  <div className="mb-2 border-t pt-2">
    <label className="text-sm font-bold">附加信息 ({FORMAT_REGISTRY[subType].label})</label>

    {renderDynamicExtraInfo()}
  </div>
)}

      
        </div>
      )}
      
      {importPanelOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 z-[1000]">
          <div className="bg-white p-4 rounded-lg shadow-lg w-80 max-h-[70vh] overflow-y-auto">
      
            <h3 className="font-bold mb-2">导入矢量数据</h3>
      
            <label className="block text-sm font-bold mb-1">格式</label>
            <select
              value={importFormat}
              onChange={e => setImportFormat(e.target.value as ImportFormat)}
              className="w-full border p-1 rounded mb-2"
            >
              <option value="点">点</option>
              <option value="线">线</option>
              <option value="面">面</option>
              <option value="车站">车站</option>
              <option value="铁路">铁路</option>
              <option value="站台">站台</option>
              <option value="车站建筑">车站建筑</option>
            </select>
      
            <label className="block text-sm font-bold mb-1">数据输入</label>
            <textarea
              value={importText}
              onChange={e => setImportText(e.target.value)}
              className="w-full border p-1 rounded mb-2"
              placeholder={
                importFormat === '点' || importFormat === '线' || importFormat === '面'
                  ? 'x,z;x,z;x,z...'
                  : '符合 JSON 格式，如数组'
              }
              rows={6}
            />
      
            <button
              className="bg-green-600 text-white px-3 py-1 rounded-lg w-full"
              onClick={handleImport}
            >
              导入
            </button>
      
          </div>
        </div>
      )}
      
      
      
      
      
      
      {/* ======== 图层控制器 ======== */}
      {measuringActive && (
        <div className="fixed top-20 right-4 bg-white p-3 rounded-lg shadow-lg z-[1000] w-85 max-h-[70vh] overflow-y-auto">
      
          <h3 className="font-bold mb-2">测绘图层</h3>
      
          {layers.map(l => (
            <div key={l.id} className="flex items-center gap-1 mb-1">
      
              {/* 显示/隐藏 */}
              <button
                className={`px-2 py-1 text-sm ${
                  l.visible ? 'bg-green-300' : 'bg-gray-300'
                }`}
                onClick={() => toggleLayerVisible(l.id)}
              >
                {l.visible ? '隐藏' : '显示'}
              </button>
      
              {/* 上移 */}
              <button
                className="px-2 py-1 text-sm bg-blue-200"
                onClick={() => moveLayerUp(l.id)}
              >
                ↑
              </button>
      
              {/* 下移 */}
              <button
                className="px-2 py-1 text-sm bg-blue-200"
                onClick={() => moveLayerDown(l.id)}
              >
                ↓
              </button>
      
              {/* 编辑 */}
              <button
                className="px-2 py-1 text-sm bg-yellow-300"
                onClick={() => editLayer(l.id)}
              >
                编辑
              </button>
      
              {/* 删除 */}
              <button
                className="px-2 py-1 text-sm bg-red-400 text-white"
                onClick={() => deleteLayer(l.id)}
              >
                删除
              </button>
      
              <button
        className="px-3 py-1 text-sm bg-purple-400 text-white"
        onClick={() => {
          alert(getLayerJSONOutput(l)); // 或显示在 textarea
        }}
      >
        JSON
      </button>
      
      
              <div className="flex-1 text-sm truncate">
                #{l.id} {l.mode} <span style={{ color: l.color }}>■</span>
              </div>
      
            </div>
          ))}
      
        </div>
      )}
      
    </>
  );
}
