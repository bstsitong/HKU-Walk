import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE } from './guideApi';
import type { Language } from './localization';

export type TranslatableContent = { kind: 'place' | 'route'; id: string; sourceVersion: string; texts: string[] };
type Result = { language: Language; sourceVersion: string; texts: string[] };
type State = { key: string; result?: Result; error?: boolean };
const cache = new Map<string, Result>();
const pending = new Map<string, Promise<Result>>();
const storageKey = 'hku-walk.automatic-translations.v1';
let hydrated: Promise<void> | undefined;
let writes = Promise.resolve();
function valid(value: unknown, content: TranslatableContent, language: Language): value is Result {
  const result = value as Result | undefined;
  return result?.language === language && typeof result.sourceVersion === 'string' && (!content.sourceVersion || result.sourceVersion === content.sourceVersion) && Array.isArray(result.texts) &&
    result.texts.length === content.texts.length && result.texts.every(text => typeof text === 'string');
}
async function request(content: TranslatableContent, language: Language, key: string): Promise<Result> {
  hydrated ??= AsyncStorage.getItem(storageKey).then(raw => {
    const entries: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(entries)) for (const entry of entries.slice(-40)) {
      if (Array.isArray(entry) && typeof entry[0] === 'string' && entry[1]) cache.set(entry[0], entry[1]);
    }
  }).catch(() => {});
  await hydrated;
  const existing = cache.get(key);
  if (valid(existing, content, language)) return existing;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50000);
  try {
    const response = await fetch(API_BASE + `/api/campus/${content.kind === 'place' ? 'places' : 'routes'}/${encodeURIComponent(content.id)}/translation/`, {
      method: 'POST', signal: controller.signal, cache: 'no-store', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ language, sourceVersion: content.sourceVersion, sourceTexts: content.texts }),
    });
    const result: unknown = await response.json();
    if (!response.ok || !valid(result, content, language)) throw new Error('content_translation_unavailable');
    cache.set(key, result);
    while (cache.size > 40) cache.delete(cache.keys().next().value!);
    const snapshot = JSON.stringify([...cache]);
    writes = writes.then(() => AsyncStorage.setItem(storageKey, snapshot)).catch(() => {});
    return result;
  } finally { clearTimeout(timeout); }
}

// A language or source change invalidates the rendered result synchronously, before effects run.
export default function useContentTranslation(content: TranslatableContent | undefined, language: Language, active: boolean) {
  const key = JSON.stringify([content?.kind, content?.id, content?.sourceVersion, language, content?.texts]);
  const [state, setState] = useState<State>({ key });
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const current = state.key === key ? state : undefined;
  const cached = content && valid(cache.get(key), content, language) ? cache.get(key) : undefined;
  const result = current?.result ?? cached;
  useEffect(() => {
    const serial = ++generation.current;
    if (!content || !active || result) return;
    let live = true;
    setState({ key });
    let operation = pending.get(key);
    if (!operation) {
      operation = request(content, language, key);
      pending.set(key, operation);
      void operation.finally(() => pending.delete(key)).catch(() => {});
    }
    operation.then(value => {
      if (live && generation.current === serial) setState({ key, result: value });
    }).catch(() => {
      if (live && generation.current === serial) setState({ key, error: true });
    });
    return () => { live = false; };
  }, [key, active, attempt]);
  return { texts: result?.texts, loading: Boolean(content && !result && !current?.error),
    error: Boolean(content && !result && current?.error), retry: () => setAttempt(value => value + 1) };
}
