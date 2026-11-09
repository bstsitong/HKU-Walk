import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { fetchGuide, GuideArticle, GuideCategory } from './guideApi';

export default function useGuide(token?: string) {
  const [categories, setCategories] = useState<GuideCategory[]>([]);
  const [articles, setArticles] = useState<GuideArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const pending = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    const id = ++request.current;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    // A free backend may need time to wake up after being idle.
    const timeout = setTimeout(() => controller.abort(), 75000);
    setLoading(true);
    setError('');
    try {
      const result = await fetchGuide(controller.signal, token);
      if (id === request.current) { setCategories(result.categories); setArticles(result.articles); }
    } catch {
      if (id === request.current) setError('暂时无法连接学生指南，请稍后重试。');
    } finally {
      clearTimeout(timeout);
      if (id === request.current) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void reload();
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') void reload();
    });
    return () => {
      ++request.current;
      pending.current?.abort();
      listener.remove();
    };
  }, [reload]);

  const updateArticle = (id: string, changes: Partial<Pick<GuideArticle, 'liked' | 'likeCount' | 'commentCount'>>) => {
    setArticles(items => items.map(item => item.id === id ? { ...item, ...changes } : item));
  };
  return { categories, articles, loading, error, reload, updateArticle };
}
