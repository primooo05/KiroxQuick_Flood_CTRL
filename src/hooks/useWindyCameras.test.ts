import { renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWindyCameras } from './useWindyCameras';
import type { MetroManilaTrafficCamera } from '../types/camera';

function makeCamera(id = 'cam-1'): MetroManilaTrafficCamera {
  return {
    sourceId: id,
    source: 'Windy',
    name: `Camera ${id}`,
    coordinates: [120.98, 14.6],
    mediaKind: 'image',
    mediaUrl: 'https://images.example.test/img.jpg',
    city: { id: 'manila', name: 'Manila' },
  };
}

describe('useWindyCameras', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches cameras on mount when enabled', async () => {
    const cam = makeCamera();
    const loadSnapshot = vi.fn(async () => ({
      cameras: [cam],
      fetchedAt: 123456,
      stale: false,
    }));

    const { result } = renderHook(() =>
      useWindyCameras({ enabled: true, loadSnapshot }),
    );

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.cameras).toHaveLength(1);
      expect(result.current.cameras[0].sourceId).toBe('cam-1');
      expect(result.current.fetchedAt).toBe(123456);
      expect(result.current.stale).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  it('does not fetch when enabled is false', async () => {
    const loadSnapshot = vi.fn();
    const { result } = renderHook(() =>
      useWindyCameras({ enabled: false, loadSnapshot }),
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.cameras).toEqual([]);
    expect(loadSnapshot).not.toHaveBeenCalled();
  });

  it('handles load error and exposes error state', async () => {
    const loadSnapshot = vi.fn(async () => {
      throw new Error('Network error');
    });

    const { result } = renderHook(() =>
      useWindyCameras({ enabled: true, loadSnapshot }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeInstanceOf(Error);
      expect((result.current.error as Error).message).toBe('Network error');
      expect(result.current.cameras).toEqual([]);
    });
  });

  it('allows manual refresh', async () => {
    let callCount = 0;
    const loadSnapshot = vi.fn(async () => {
      callCount += 1;
      return {
        cameras: [makeCamera(`cam-${callCount}`)],
        fetchedAt: callCount,
        stale: false,
      };
    });

    const { result } = renderHook(() =>
      useWindyCameras({ enabled: true, loadSnapshot }),
    );

    await waitFor(() => {
      expect(result.current.cameras[0].sourceId).toBe('cam-1');
    });

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.cameras[0].sourceId).toBe('cam-2');
    });
  });
});
