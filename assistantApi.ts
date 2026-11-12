import { API_BASE } from './guideApi';
import type { Language } from './localization';

export type AssistantSource = {
  kind: 'place' | 'guide' | 'web';
  id: string;
  title: string;
  detail: string;
  url?: string;
  pageKey?: string;
};

export type AssistantAnswer = { answer: string; sources: AssistantSource[] };
export type AssistantHistory = { role: 'user' | 'assistant'; content: string };

export const assistantErrors = {
  assistant_not_configured: '校园助手尚未启用。',
  assistant_limit: '提问次数已达上限，请稍后再试。',
  assistant_unavailable: '校园助手暂时无法回答，请重试。',
} as const;

function isSource(value: unknown): value is AssistantSource {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<AssistantSource>;
  return (item.kind === 'place' || item.kind === 'guide' || item.kind === 'web') &&
    typeof item.id === 'string' && typeof item.title === 'string' && typeof item.detail === 'string' &&
    (item.kind !== 'web' || typeof item.url === 'string') &&
    (item.pageKey === undefined || typeof item.pageKey === 'string');
}

export async function askAssistant(question: string, language: Language, history: AssistantHistory[]): Promise<AssistantAnswer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 32000);
  try {
    const response = await fetch(`${API_BASE}/api/assistant/ask/`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, language, history }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (response.status === 429) throw new Error(assistantErrors.assistant_limit);
    if (data?.code === 'assistant_not_configured' || response.status === 404) {
      throw new Error(assistantErrors.assistant_not_configured);
    }
    if (!response.ok || typeof data?.answer !== 'string' || !Array.isArray(data.sources)) {
      throw new Error(assistantErrors.assistant_unavailable);
    }
    return { answer: data.answer, sources: data.sources.filter(isSource) };
  } catch (error) {
    if (error instanceof Error && Object.values(assistantErrors).some(message => message === error.message)) throw error;
    throw new Error(assistantErrors.assistant_unavailable);
  } finally {
    clearTimeout(timeout);
  }
}
