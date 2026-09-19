import type { AnnieDoc } from '../core/types';
export const ANNIE_MIME = 'application/vnd.anniedrawing+json';
export function exportJSON(doc: AnnieDoc): string {
  return JSON.stringify(doc, null, 2);
}
