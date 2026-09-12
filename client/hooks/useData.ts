import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "../services/api";
export function useData<T = any>(path: string, interval = 0) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const version = useRef(0);
  const reload = useCallback(async () => {
    const v = ++version.current;
    try {
      const result = await request<T>(path);
      if (v === version.current) {
        setData(result);
        setError("");
      }
    } catch (e) {
      if (v === version.current) setError((e as Error).message);
    } finally {
      if (v === version.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    setLoading(true);
    void reload();
    const timer = interval
      ? setInterval(() => void reload(), interval)
      : undefined;
    return () => {
      clearInterval(timer);
      version.current++;
    };
  }, [reload, interval]);
  return { data, error, loading, reload };
}
