import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAMERA_REFRESH_INTERVAL_MS, startCameraRefresh } from './cameraRefresh';

function fakeDocument() {
  const listeners = new Set<() => void>();
  let hidden = false;
  return {
    get hidden() { return hidden; },
    set hidden(value: boolean) { hidden = value; },
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => listeners.add(listener as () => void),
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => listeners.delete(listener as () => void),
    emit: () => listeners.forEach((listener) => listener()),
  };
}

describe('camera refresh scheduling', () => {
  afterEach(() => vi.useRealTimers());

  it('loads immediately and refreshes once per configured interval', async () => {
    vi.useFakeTimers();
    const doc = fakeDocument();
    const load = vi.fn(async () => ({ fetchedAt: 1 }));
    const stop = startCameraRefresh({ load, onSnapshot: vi.fn(), document: doc });
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(CAMERA_REFRESH_INTERVAL_MS);
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });

  it('pauses hidden-tab polls and refreshes when the document becomes visible', async () => {
    vi.useFakeTimers();
    const doc = fakeDocument();
    const load = vi.fn(async () => ({ fetchedAt: 1 }));
    const stop = startCameraRefresh({ load, onSnapshot: vi.fn(), document: doc });
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    doc.hidden = true;
    await vi.advanceTimersByTimeAsync(CAMERA_REFRESH_INTERVAL_MS * 2);
    expect(load).toHaveBeenCalledTimes(1);
    doc.hidden = false;
    doc.emit();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    stop();
  });

  it('does not overlap requests and ignores late results after teardown', async () => {
    vi.useFakeTimers();
    const doc = fakeDocument();
    let resolveLoad: ((value: { fetchedAt: number }) => void) | undefined;
    const load = vi.fn(() => new Promise<{ fetchedAt: number }>((resolve) => { resolveLoad = resolve; }));
    const onSnapshot = vi.fn();
    const stop = startCameraRefresh({ load, onSnapshot, document: doc });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(CAMERA_REFRESH_INTERVAL_MS);
    expect(load).toHaveBeenCalledTimes(1);
    stop();
    resolveLoad?.({ fetchedAt: 5 });
    await Promise.resolve();
    expect(onSnapshot).not.toHaveBeenCalled();
  });
});
