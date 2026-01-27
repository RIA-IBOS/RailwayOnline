import * as L from 'leaflet';

/**
 * Label 视觉样式集中管理（便于维护与扩展）。
 *
 * 设计原则：
 * - 不依赖外部 CSS（全部 inline style），避免打包/样式作用域导致丢失。
 * - 通过 styleKey 调用，后续新增样式只改这里。
 */

export type LabelStyleKey =
  | 'bubble-dark'
  | 'gm-outline'
  | 'gm-outline-bold'
  // —— 规则细分样式（保持 Google Map “描边字”大格式不变，仅调整字号/描边/颜色） ——
  | 'gm-bw-15'
  | 'gm-wtb-15'
  | 'gm-bw-9';

export type LabelPlacement = 'center' | 'near';

export type LabelRenderOptions = {
  placement: LabelPlacement;
  withDot?: boolean;
  offsetY?: number;
  /** 是否允许交互（用于“点击 label”模式） */
  interactive?: boolean;
};

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[<>&"]/g, (m) => {
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    if (m === '&') return '&amp;';
    if (m === '"') return '&quot;';
    return m;
  });
}

function dotHtml(): string {
  return `
    <span style="
      display:inline-block;
      width:8px;height:8px;
      border-radius:999px;
      background:#fff;
      margin-right:6px;
      box-shadow:0 0 0 2px rgba(0,0,0,0.35);
      flex:0 0 auto;
    "></span>
  `;
}

function placementTransform(placement: LabelPlacement): string {
  return placement === 'near' ? 'translate(-50%, -120%)' : 'translate(-50%, -50%)';
}

function placementExtraMarginTopPx(placement: LabelPlacement, offsetY?: number): number {
  return placement === 'near' ? -(Number(offsetY ?? 0) || 0) : 0;
}

/**
 * 渲染 label HTML。
 * 注意：此处不做 DOM 操作，返回 HTML 字符串，用于 Leaflet.divIcon。
 */
export function renderLabelHtml(styleKey: LabelStyleKey, text: string, opts: LabelRenderOptions): string {
  const safe = escapeHtml(String(text ?? ''));

  const placement = opts.placement ?? 'center';
  const transform = placementTransform(placement);
  const extraMarginTop = placementExtraMarginTopPx(placement, opts.offsetY);

  const dot = opts.withDot ? dotHtml() : '';
  const pe = opts.interactive ? 'auto' : 'none';
  const cursor = opts.interactive ? 'pointer' : 'default';

  // Google Map 风格：描边字（webkit-text-stroke + text-shadow 双保险）
  const GM_STYLE: Record<string, { fontSize: number; strokeW: number; fill: string; stroke: string; fontWeight: number }> = {
    'gm-outline': { fontSize: 17, strokeW: 0.5, fill: '#ffffff', stroke: '#000000', fontWeight: 700 },
    'gm-outline-bold': { fontSize: 17, strokeW: 0.7, fill: '#ffffff', stroke: '#000000', fontWeight: 800 },
    'gm-bw-15': { fontSize: 15, strokeW: 0.5, fill: '#ffffff', stroke: '#000000', fontWeight: 700 },
    // WTB：淡天蓝填充 + 深蓝描边
    'gm-wtb-15': { fontSize: 15, strokeW: 0.5, fill: '#dbeafe', stroke: '#1d4ed8', fontWeight: 700 },
    'gm-bw-9': { fontSize: 9, strokeW: 0.3, fill: '#ffffff', stroke: '#000000', fontWeight: 700 },
  };

  const gm = GM_STYLE[String(styleKey)];
  if (gm) {
    const shadow = `
      0 0 0px rgba(0,0,0,0.9),
      0 0 0px rgba(0,0,0,0.9),
      0px 0 0 rgba(0,0,0,0.9),
      -0px 0 0 rgba(0,0,0,0.9),
      0 0px 0 rgba(0,0,0,0.9),
      0 -0px 0 rgba(0,0,0,0.9)
    `;

    return `
      <div style="
        transform:${transform};
        margin-top:${extraMarginTop}px;
        white-space:nowrap;
        pointer-events:${pe};
        cursor:${cursor};
        display:inline-flex;
        align-items:center;
        background:transparent;
        padding:0;
      ">
        ${dot}
        <span style="
          color:${gm.fill};
          font-weight:${gm.fontWeight};
          font-size:${gm.fontSize}px;
          line-height:1.1;
          -webkit-text-stroke:${gm.strokeW}px ${gm.stroke};
          text-shadow:${shadow};
        ">${safe}</span>
      </div>
    `;
  }

  // bubble-dark：现有默认黑底气泡
  return `
    <div style="
      background: rgba(0,0,0,0.65);
      color: #fff;
      padding: 2px 6px;
      border-radius: 6px;
      font-size: 12px;
      white-space: nowrap;
      transform: ${transform};
      margin-top: ${extraMarginTop}px;
      pointer-events: ${pe};
      cursor: ${cursor};
      display: inline-flex;
      align-items: center;
      line-height: 1;
    ">${dot}${safe}</div>
  `;
}

export function makeLabelDivIcon(styleKey: LabelStyleKey, text: string, opts: LabelRenderOptions): L.DivIcon {
  const html = renderLabelHtml(styleKey, text, opts);
  return L.divIcon({ className: '', html, iconSize: [0, 0] });
}
