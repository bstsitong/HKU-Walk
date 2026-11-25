import { useEffect, useRef, useState } from 'react';
import { Converter } from 'opencc-js/t2cn';
import { API_BASE, type GuideArticle } from './guideApi';
import { traditionalChinese, type Language } from './localization';

type Translation = { language: Language; sourceVersion: string; title: string; body: string; relatedLocation: string; blockTexts: string[] };
type State = { key: string; visible: boolean; loading: boolean; result?: Translation; error?: string };
const simplified = Converter({ from: 'hk', to: 'cn' });
const cache = new Map<string, Translation>();
const pending = new Map<string, Promise<Translation>>();
const preserveLinks = (text: string, convert: (value: string) => string) => text.split(/(\]\([^\n)]*\)|https?:\/\/[^\s]+)/g).map((part, index) => index % 2 ? part : convert(part)).join('');

async function requestTranslation(article: GuideArticle, language: Language): Promise<Translation> {
  const blocks = article.bodyBlocks ?? [];
  const texts = [article.title, blocks.length ? '' : article.body, article.relatedLocation ?? '', ...blocks.map(block => block.text)];
  const prose = texts.join('\n').replace(/https?:\/\/[^\s]+/g, '');
  // Only script conversion for unambiguously Chinese text. Mixed-language posts use the AI translator.
  if (language !== 'en' && /\p{Script=Han}/u.test(prose) && !/\p{L}/u.test(prose.replace(/\p{Script=Han}/gu, ''))) {
    const convert = language === 'zh-Hant' ? traditionalChinese : simplified;
    const result = texts.map(text => preserveLinks(text, convert));
    return { language, sourceVersion: article.updatedAt, title: result[0], body: result[1], relatedLocation: result[2], blockTexts: result.slice(3) };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50000);
  try {
    const response = await fetch(API_BASE + `/api/guide/articles/${encodeURIComponent(article.id)}/translation/`, {
      method: 'POST', signal: controller.signal, cache: 'no-store', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ language, sourceVersion: article.updatedAt }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.code || 'translation_unavailable');
    if (result.language !== language || result.sourceVersion !== article.updatedAt || typeof result.title !== 'string' || typeof result.body !== 'string' ||
      typeof result.relatedLocation !== 'string' || !Array.isArray(result.blockTexts) || result.blockTexts.length !== blocks.length || result.blockTexts.some((text: unknown) => typeof text !== 'string')) throw new Error('translation_unavailable');
    return result;
  } finally { clearTimeout(timeout); }
}

export default function usePostTranslation(article: GuideArticle, language: Language) {
  const key = JSON.stringify([article.id, article.updatedAt, language, article.title, article.body, article.relatedLocation, article.bodyBlocks]);
  const [state, setState] = useState<State>({ key, visible: false, loading: false });
  const current = useRef({ key, generation: 0 });
  const mounted = useRef(true);
  if (current.current.key !== key) current.current = { key, generation: current.current.generation + 1 };
  useEffect(() => { setState({ key, visible: false, loading: false }); }, [key]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const latest: State = state.key === key ? state : { key, visible: false, loading: false };
  const eligible = article.isCommunity === true;
  const toggle = async () => {
    const generation = current.current.generation;
    if (!eligible || latest.loading) return;
    if (latest.visible) { setState({ ...latest, visible: false }); return; }
    setState({ key, visible: false, loading: true });
    try {
      let result = cache.get(key);
      if (!result) {
        let operation = pending.get(key);
        if (!operation) {
          operation = requestTranslation(article, language);
          pending.set(key, operation);
          void operation.finally(() => { pending.delete(key); }).catch(() => {});
        }
        result = await operation;
        cache.set(key, result);
        while (cache.size > 40) cache.delete(cache.keys().next().value!);
      }
      if (mounted.current && current.current.key === key && current.current.generation === generation) setState({ key, visible: true, loading: false, result });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      const message = code === 'translation_source_changed' ? '帖子已更新，请刷新后再翻译。' : code === 'translation_limit' ? '今日翻译次数已用完，请明天再试。' : code === 'translation_busy' ? '正在处理这篇帖子的翻译，请稍后重试。' : code === 'translation_too_long' ? '帖子内容过长，暂时无法翻译。' : '翻译暂时不可用，请稍后重试。';
      if (mounted.current && current.current.key === key && current.current.generation === generation) setState({ key, visible: false, loading: false, error: message });
    }
  };
  const result = latest.visible ? latest.result : undefined;
  const translated = result ? { ...article, title: result.title, body: result.body || result.blockTexts.join('\n\n'), relatedLocation: result.relatedLocation,
    bodyBlocks: article.bodyBlocks?.map((block, index) => ({ ...block, text: result.blockTexts[index] })) } : article;
  return { article: translated, eligible, visible: latest.visible, loading: latest.loading, error: latest.error, toggle };
}
