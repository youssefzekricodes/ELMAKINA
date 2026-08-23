/* Reactive i18n: the current language lives here; components re-render through the store (see lib/store.ts). */
import * as MSG from '../../supabase/functions/game/messages.mjs'; // same catalog the Edge Function uses
import { UI, ERR_TN } from './i18n.strings';

export type Lang = 'en' | 'tn';

let lang: Lang = ((typeof localStorage !== 'undefined' && localStorage.getItem('mekina.lang')) as Lang) || 'en';
if (!UI[lang]) lang = 'en';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

function fill(s: string, params?: Record<string, unknown>, escape = false) {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? (escape ? esc(params[k]) : String(params[k])) : m));
}

export const i18n = {
  get lang() { return lang; },
  set(l: string) { lang = (UI[l] ? l : 'en') as Lang; localStorage.setItem('mekina.lang', lang); },
  dir: () => (lang === 'tn' ? 'rtl' : 'ltr'),
  /** Plain text (params inserted as-is — render as text, never as HTML). */
  t(key: string, params?: Record<string, unknown>) {
    const s = UI[lang]?.[key] !== undefined ? UI[lang][key] : UI.en[key] !== undefined ? UI.en[key] : key;
    return fill(s, params);
  },
  /** HTML string: params are escaped, the template's own markup is kept. Use with dangerouslySetInnerHTML. */
  html(key: string, params?: Record<string, unknown>) {
    const s = UI[lang]?.[key] !== undefined ? UI[lang][key] : UI.en[key] !== undefined ? UI.en[key] : key;
    return fill(s, params, true);
  },
  charName: (c: string) => (MSG.names[lang] && MSG.names[lang][c]) || MSG.names.en[c] || c,
  reason: (r: string) => (MSG.reasons[lang] && MSG.reasons[lang][r]) || MSG.reasons.en[r] || r,
  logText: (e: { key?: string; params?: any; text?: string }) => (e.key ? MSG.format(lang, e.key, e.params || {}) : e.text || ''),
  err: (m: string) => (lang === 'tn' && ERR_TN[m]) || m,
};

export const t = i18n.t;
export const esc_ = esc;
