import type { FeatureRecord } from '../renderRules';

/** 外部网页超链接（新标签打开） */
export type CardExternalLinkValue = {
  kind: 'externalLink';
  href: string;
  text?: string;
};

/** 要素跳转超链接（点击时尝试触发目标要素 labelClick） */
export type CardFeatureLinkValue = {
  kind: 'featureLink';
  targetId: string;
  /** 可选：指定显示文本；不填则由渲染层用目标要素 Name/ID 兜底 */
  text?: string;
};

export type CardInteractiveValue = CardExternalLinkValue | CardFeatureLinkValue;

/**
 * 将输入链接规范化为“绝对外链”，避免浏览器把 `wiki.ria.red` 解释为相对路径。
 * - 已带协议（http/https/mailto/tel/ftp/file 等）：原样
 * - `//example.com`：补 `https:`
 * - 其他：默认补 `https://`
 */
export function normalizeExternalHref(raw: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';

  if (/^(https?:\/\/|mailto:|tel:|ftp:\/\/|file:\/\/)/i.test(s)) return s;
  if (s.startsWith('//')) return `https:${s}`;
  return `https://${s}`;
}

/** 1) 网页链接：在 FIELD_RULES 里用此函数包装 value */
export function makeExternalLink(href: string, text?: string): CardExternalLinkValue {
  const s = normalizeExternalHref(href);
  return { kind: 'externalLink', href: s, text: text?.trim() || undefined };
}

/** 2) 要素跳转：在 FIELD_RULES 里用此函数包装 value */
export function makeFeatureLink(targetId: string, text?: string): CardFeatureLinkValue {
  const s = String(targetId ?? '').trim();
  return { kind: 'featureLink', targetId: s, text: text?.trim() || undefined };
}

export function isExternalLinkValue(v: any): v is CardExternalLinkValue {
  return !!v && typeof v === 'object' && v.kind === 'externalLink' && typeof v.href === 'string';
}

export function isFeatureLinkValue(v: any): v is CardFeatureLinkValue {
  return !!v && typeof v === 'object' && v.kind === 'featureLink' && typeof v.targetId === 'string';
}

export type ResolveFeatureById = (id: string) => FeatureRecord | undefined;
