import type { ItemText } from '../core/types';
import { fontFamily, fontSize } from '../stage/paint';
const cache = new Map<string, { w: number; h: number }>();
/** Measure only when text is committed; pointer movement never reads layout. */
export function measureText(owner: Document, text: ItemText) {
  const key = JSON.stringify(text),
    cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const measure = owner.createElement('div');
  measure.style.cssText =
    'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;white-space:pre;line-height:1.35;width:max-content;max-width:none;padding:0;border:0;';
  measure.style.fontFamily = fontFamily(text.font);
  measure.style.fontSize = `${fontSize(text)}px`;
  measure.textContent = text.value || ' ';
  owner.body.append(measure);
  const rect = measure.getBoundingClientRect();
  const result = {
    w: Math.max(24, Math.ceil(rect.width + 4)),
    h: Math.max(fontSize(text) * 1.35, Math.ceil(rect.height)),
  };
  measure.remove();
  cache.set(key, result);
  if (cache.size > 256) cache.delete(cache.keys().next().value!);
  return result;
}
