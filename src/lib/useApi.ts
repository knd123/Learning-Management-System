import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from './api.ts';

export interface ApiState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload(): Promise<void>;
  setData(data: T): void;
}

/** Loads `path` (GET) and re-loads when it changes. Pass null to skip. */
export function useApi<T>(path: string | null): ApiState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const latest = useRef(path);
  latest.current = path;

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<T>(path);
      if (latest.current === path) setData(result);
    } catch (err) {
      if (latest.current === path) setError(errorMessage(err));
    } finally {
      if (latest.current === path) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}
