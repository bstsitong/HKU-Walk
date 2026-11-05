import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { fetchGuide, GuideCategory } from './guideApi';

export default function useGuide() {
  const [categories, setCategories] = useState<GuideCategory[]>([]);
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
      const result = await fetchGuide(controller.signal);
      if (id === request.current) setCategories(result);
    } catch {
      if (id === request.current) setError('暂时无法连接学生指南，请稍后重试。');
    } finally {
      clearTimeout(timeout);
      if (id === request.current) setLoading(false);
    }
  }, []);

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

  return { categories, loading, error, reload };
}
