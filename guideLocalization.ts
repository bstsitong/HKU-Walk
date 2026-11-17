import type { GuideArticle } from './guideApi';
import { traditionalChinese, translate, type Language } from './localization';
import originals from './server/guide/student_guide_articles.json';
import englishBodies from './locales/guide-articles-en.json';

const sourceArticles = new Map(originals.map(article => [article.title, article]));
const translatedBodies: Record<string, string> = englishBodies;
const normalizeBreaks = (body: string) => body.replaceAll('\\n', '\n').replaceAll('\\u000b', ' ').replaceAll('\u000b', ' ');
const normalizedSource = (body: string) => normalizeBreaks(body).replace(/\r\n/g, '\n').trimEnd();

function guideBody(body: string, key: string, language: Language, original?: string) {
  const normalized = normalizedSource(body);
  if (language === 'en' && original && normalized === normalizedSource(original)) {
    return translatedBodies[key] ?? normalized;
  }
  // Translate prose without changing links, image URLs or source page anchors.
  if (language === 'zh-Hant') {
    return normalized.split(/(\]\([^\n)]*\))/).map((part, index) => index % 2 ? part : traditionalChinese(part)).join('');
  }
  return normalized;
}

export function guideArticleTitle(article: GuideArticle, language: Language) {
  return article.markdown && article.isCommunity !== true ? translate(article.title, language) : article.title;
}

export function localizedGuideArticle(article: GuideArticle, language: Language): GuideArticle {
  if (!article.markdown || article.isCommunity === true) return article;
  const original = sourceArticles.get(article.title);
  const originalPages = original?.sourcePages as Record<string, { body: string }> | undefined;
  return {
    ...article,
    title: guideArticleTitle(article, language),
    body: guideBody(article.body, article.title, language, original?.body),
    sourcePages: Object.fromEntries(Object.entries(article.sourcePages ?? {}).map(([key, page]) => [key, {
      title: translate(page.title, language),
      body: guideBody(page.body, `${article.title}#${key}`, language, originalPages?.[key]?.body),
    }])),
  };
}
