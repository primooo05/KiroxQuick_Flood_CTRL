// Renew signed free-tier image URLs with a three-minute margin before expiry.
export const CAMERA_REFRESH_INTERVAL_MS = 7 * 60 * 1000;

export interface CameraRefreshSnapshot {
  readonly fetchedAt: number;
}

export interface CameraRefreshOptions<T extends CameraRefreshSnapshot> {
  readonly load: (signal: AbortSignal, forceFresh?: boolean) => Promise<T>;
  readonly onSnapshot: (snapshot: T) => void;
  readonly onError?: (error: unknown) => void;
  readonly document?: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>;
  readonly intervalMs?: number;
}

/** Refreshes as one batch, pauses in hidden tabs, and prevents overlapping requests. */
export function startCameraRefresh<T extends CameraRefreshSnapshot>(
  options: CameraRefreshOptions<T>,
): () => void {
  const doc = options.document ?? document;
  const intervalMs = options.intervalMs ?? CAMERA_REFRESH_INTERVAL_MS;
  let active = true;
  let inFlight = false;
  let controller: AbortController | null = null;

  const refresh = async (forceFresh = false): Promise<void> => {
    if (!active || doc.hidden || inFlight) return;
    inFlight = true;
    controller = new AbortController();
    try {
      const snapshot = await options.load(controller.signal, forceFresh);
      if (active) options.onSnapshot(snapshot);
    } catch (error) {
      if (active && !(error instanceof DOMException && error.name === 'AbortError')) {
        options.onError?.(error);
      }
    } finally {
      inFlight = false;
      controller = null;
    }
  };
  const timer = setInterval(() => { void refresh(); }, intervalMs);
  const onVisibilityChange = (): void => { if (!doc.hidden) void refresh(true); };
  doc.addEventListener('visibilitychange', onVisibilityChange);
  void refresh(true);

  return () => {
    active = false;
    clearInterval(timer);
    doc.removeEventListener('visibilitychange', onVisibilityChange);
    controller?.abort();
  };
}
