import { useEffect, useRef, useState } from 'react';
import type { MetroManilaTrafficCamera } from '../types/camera';
import { fetchWindyCameras, type WindyCameraSnapshot } from '../services/windyCameraService';

export interface UseWindyCamerasOptions {
  readonly enabled?: boolean;
  readonly loadSnapshot?: (signal?: AbortSignal) => Promise<WindyCameraSnapshot>;
}

export interface UseWindyCamerasResult {
  readonly cameras: readonly MetroManilaTrafficCamera[];
  readonly fetchedAt: number | null;
  readonly stale: boolean;
  readonly loading: boolean;
  readonly error: unknown;
  readonly refresh: () => Promise<void>;
}

export function useWindyCameras(
  options: UseWindyCamerasOptions = {},
): UseWindyCamerasResult {
  const { enabled = true, loadSnapshot } = options;
  const [snapshot, setSnapshot] = useState<WindyCameraSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<unknown>(null);
  const snapshotRef = useRef<WindyCameraSnapshot | null>(null);

  const loadFn = useRef(loadSnapshot);
  loadFn.current = loadSnapshot;

  const refresh = async (): Promise<void> => {
    setLoading(true);
    const controller = new AbortController();
    try {
      const load = loadFn.current
        ? (signal?: AbortSignal) => loadFn.current!(signal)
        : (signal?: AbortSignal) => fetchWindyCameras(fetch, signal);
      const data = await load(controller.signal);
      snapshotRef.current = data;
      setSnapshot(data);
      setError(null);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const controller = new AbortController();
    const load = loadFn.current
      ? (signal: AbortSignal) => loadFn.current!(signal)
      : (signal: AbortSignal) => fetchWindyCameras(fetch, signal);

    void load(controller.signal)
      .then((nextSnapshot) => {
        if (controller.signal.aborted) return;
        snapshotRef.current = nextSnapshot;
        setSnapshot(nextSnapshot);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [enabled]);

  return {
    cameras: snapshot?.cameras ?? [],
    fetchedAt: snapshot?.fetchedAt ?? null,
    stale: snapshot?.stale ?? false,
    loading,
    error,
    refresh,
  };
}
