import messages from './locales/messages.json';
import { Converter } from 'opencc-js/cn2t';

export type Language = 'zh-Hans' | 'zh-Hant' | 'en';
export const languages: { code: Language; label: string; short: string }[] = [
  { code: 'zh-Hans', label: '简体中文', short: '简体' },
  { code: 'zh-Hant', label: '繁體中文', short: '繁體' },
  { code: 'en', label: 'English', short: 'EN' },
];
export const defaultLanguage: Language = 'en';
let currentLanguage: Language = defaultLanguage;
const toTraditional = Converter({ from: 'cn', to: 'hk' });
export const traditionalChinese = (text: string) => toTraditional(text);
const dictionary = messages as Record<string, { en: string; 'zh-Hant': string }>;
// System text can already have been translated in state or a server response.
// Resolve it back to its source before rendering in the newly selected language.
const sourceByVariant = new Map<string, string>();
for (const [source, value] of Object.entries(dictionary)) {
  for (const variant of [value.en, value['zh-Hant']]) if (!sourceByVariant.has(variant)) sourceByVariant.set(variant, source);
}
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const formatted = Object.entries(dictionary).flatMap(([source, value]) => {
  if (!/\{\w+\}/.test(source)) return [];
  return [source, value.en, value['zh-Hant']].flatMap(pattern => {
    const fixed = pattern.replace(/\{\w+\}/g, '');
    if (!/[A-Za-z\u3400-\u9fff]/.test(fixed)) return [];
    const names: string[] = [];
    const parts = pattern.split(/(\{\w+\})/g).map(part => {
      if (!/^\{\w+\}$/.test(part)) return escapePattern(part);
      const name = part.slice(1, -1), previous = names.indexOf(name);
      if (previous !== -1) return `\\${previous + 1}`;
      names.push(name);
      return ['count', 'step', 'meters', 'width', 'height'].includes(name) ? '(\\d+(?:\\.\\d+)?)' : '(.+?)';
    });
    return [{ source, names, expression: new RegExp('^' + parts.join('') + '$'), specificity: fixed.length }];
  });
}).sort((a, b) => b.specificity - a.specificity);
export const isLanguage = (value: unknown): value is Language => languages.some(item => item.code === value);
export const getLanguage = () => currentLanguage;
export const setCurrentLanguage = (value: Language) => { currentLanguage = value; };
export function translate(text: string, language: Language = currentLanguage): string {
  if (!text) return text;
  const source = Object.hasOwn(dictionary, text) ? text : sourceByVariant.get(text);
  const exact = source ? language === 'zh-Hans' ? source : dictionary[source][language] : undefined;
  if (exact !== undefined) return exact;
  const trimmed = text.trim();
  if (trimmed && trimmed !== text) return text.replace(trimmed, translate(trimmed, language));
  if (text.includes('\n')) return text.split('\n').map(line => translate(line, language)).join('\n');
  const colon = text.includes('：') ? text.indexOf('：') : text.indexOf(': ');
  const label = text.slice(0, colon);
  if (colon > 0 && (Object.hasOwn(dictionary, label) || sourceByVariant.has(label))) return translate(label, language) + (language === 'en' ? ': ' : '：') + translate(text.slice(colon + 1).trimStart(), language);
  for (const pattern of formatted) {
    const match = pattern.expression.exec(text);
    if (!match) continue;
    const target = language === 'zh-Hans' ? pattern.source : dictionary[pattern.source][language];
    return target.replace(/\{(\w+)\}/g, (placeholder, name) => match[pattern.names.indexOf(name) + 1] ?? placeholder);
  }
  if (language === 'zh-Hant') return traditionalChinese(text);
  return text;
}
export function t(text: string, values: Record<string, string | number> = {}): string {
  return translate(text).replace(/\{(\w+)\}/g, (match, key) => values[key] === undefined ? match : String(values[key]));
}
export function formatDate(value: string) {
  return new Date(value).toLocaleDateString(currentLanguage === 'en' ? 'en-HK' : currentLanguage === 'zh-Hant' ? 'zh-HK' : 'zh-CN');
}
