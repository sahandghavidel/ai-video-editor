import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

export type SvgAsset = {
  id: number;
  name: string;
  description: string;
  svg: string;
  status: 'Draft' | 'Approved';
  viewBox: string;
  width: number;
  height: number;
  tags: string;
  usageRules: string;
};

export const SVG_MAX_BYTES = 500_000;
const elements = new Set('svg g defs path rect circle ellipse line polyline polygon text tspan title desc linearGradient radialGradient stop clipPath mask pattern marker symbol use filter feGaussianBlur feOffset feBlend feColorMatrix feComposite feFlood feMerge feMergeNode feDropShadow'.split(' '));
const attributes = new Set('id xmlns xmlns:xlink version viewBox width height x y x1 x2 y1 y2 cx cy r rx ry d points fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity transform preserveAspectRatio font-family font-size font-weight font-style text-anchor dominant-baseline letter-spacing dx dy gradientUnits gradientTransform offset stop-color stop-opacity spreadMethod fx fy fr clip-path clip-rule mask maskUnits maskContentUnits patternUnits patternContentUnits patternTransform marker-start marker-mid marker-end markerWidth markerHeight refX refY orient markerUnits href xlink:href filter filterUnits primitiveUnits stdDeviation in in2 result mode type values operator k1 k2 k3 k4 flood-color flood-opacity color role aria-label aria-hidden focusable'.split(' '));

/** Reject unsupported active/external content rather than silently changing artwork. */
export function validateSvg(source: string) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Paste or upload SVG code.');
  if (new TextEncoder().encode(source).length > SVG_MAX_BYTES) throw new Error('SVG must be smaller than 500 KB.');
  if (/<!DOCTYPE|<!ENTITY|<\?/i.test(source.replace(/^\s*<\?xml[^?]*\?>/, ''))) throw new Error('SVG declarations and processing instructions are not supported.');
  const doc = new DOMParser({ onError: (_level, message) => { throw new Error(message); } }).parseFromString(source, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.tagName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg') throw new Error('Use an SVG root with xmlns="http://www.w3.org/2000/svg".');
  const walk = (el: typeof root) => {
    if (!elements.has(el.tagName) || el.namespaceURI !== root.namespaceURI) throw new Error(`Unsupported SVG element: ${el.tagName}. Use static SVG shapes.`);
    for (let i = 0; i < el.attributes.length; i++) {
      const a = el.attributes.item(i)!;
      if (!attributes.has(a.name)) throw new Error(`Unsupported SVG attribute: ${a.name}. Use presentation attributes instead of styles or scripts.`);
      if (a.name === 'href' || a.name === 'xlink:href') {
        if (!/^#[A-Za-z_][\w:.-]*$/.test(a.value)) throw new Error('SVG references must point to an internal #id.');
      } else if (!a.name.startsWith('xmlns') && (/url\s*\(/i.test(a.value) || /[\\\u0000-\u001f]/.test(a.value))) {
        if (!/^url\(#[A-Za-z_][\w:.-]*\)$/.test(a.value)) throw new Error('External or escaped SVG references are not supported.');
      }
    }
    for (let child = el.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) walk(child as typeof root);
      else if (![3, 8].includes(child.nodeType)) throw new Error('Unsupported SVG content.');
    }
  };
  walk(root);
  const viewBox = root.getAttribute('viewBox') || '';
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  const dimension = (value: string | null) => value && /^\d+(?:\.\d+)?(?:px)?$/.test(value) ? parseFloat(value) : NaN;
  const width = viewBox ? parts[2] : dimension(root.getAttribute('width'));
  const height = viewBox ? parts[3] : dimension(root.getAttribute('height'));
  if ((viewBox && (parts.length !== 4 || parts.some(n => !Number.isFinite(n)))) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Provide a valid viewBox or positive numeric width and height.');
  return { svg: new XMLSerializer().serializeToString(root), viewBox: viewBox || `0 0 ${width} ${height}`, width, height };
}
