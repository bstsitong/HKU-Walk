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
const countPatterns = Object.entries(dictionary).filter(([pattern]) => pattern.includes('{count}'));
export const isLanguage = (value: unknown): value is Language => languages.some(item => item.code === value);
export const getLanguage = () => currentLanguage;
export const setCurrentLanguage = (value: Language) => { currentLanguage = value; };
export function translate(text: string, language: Language = currentLanguage): string {
  if (language === 'zh-Hans' || !text) return text;
  const exact = dictionary[text]?.[language];
  if (exact !== undefined) return exact;
  const trimmed = text.trim();
  if (trimmed && trimmed !== text && dictionary[trimmed]?.[language]) return text.replace(trimmed, dictionary[trimmed][language]);
  if (text.includes('\n')) return text.split('\n').map(line => translate(line, language)).join('\n');
  const colon = text.indexOf('：');
  if (colon > 0 && dictionary[text.slice(0, colon)]) return translate(text.slice(0, colon), language) + (language === 'en' ? ': ' : '：') + translate(text.slice(colon + 1), language);
  for (const [pattern, value] of countPatterns) {
    const [before, after] = pattern.split('{count}');
    if (text.startsWith(before) && text.endsWith(after)) {
      const count = text.slice(before.length, after ? -after.length : undefined);
      if (/^\d+$/.test(count)) return value[language].replace('{count}', count);
    }
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
