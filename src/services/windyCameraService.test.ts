import { describe, expect, it, vi } from 'vitest';
import { ncrCityInfos } from '../data/geojson/ncrCityContext';
import { fetchWindyCameras, normalizeWindyCamera } from './windyCameraService';

function rawWindy(overrides: Record<string, unknown> = {}) {
  return {
    webcamId: 321,
    title: 'Manila Road Camera',
    lastUpdatedOn: '2026-10-03T12:00:00.000Z',
    location: { latitude: ncrCityInfos.find((city) => city.id === 'manila')!.labelPoint[1], longitude: ncrCityInfos.find((city) => city.id === 'manila')!.labelPoint[0], city: 'Manila' },
    images: { current: { preview: 'https://media.example.test/preview.jpg?token=abc', icon: 'https://media.example.test/icon.jpg' } },
    player: {},
    urls: { detail: 'https://www.windy.com/webcams/321' },
    ...overrides,
  };
}

describe('Windy camera normalization', () => {
  it('normalizes image records and retains provider ID, update time, and detail link', () => {
    const result = normalizeWindyCamera(rawWindy());
    expect(result).toMatchObject({
      source: 'Windy', sourceId: '321', mediaKind: 'image',
      mediaUrl: 'https://media.example.test/preview.jpg?token=abc',
      detailUrl: 'https://www.windy.com/webcams/321',
      observedAt: Math.floor(Date.parse('2026-10-03T12:00:00.000Z') / 1000),
    });
  });

  it('uses a supported live player URL and rejects an untrusted player host', () => {
    const live = normalizeWindyCamera(rawWindy({ player: { live: 'https://webcams.windy.com/embed/321' } }));
    expect(live?.mediaKind).toBe('video');
    expect(live?.mediaUrl).toBe('https://webcams.windy.com/embed/321');

    const untrusted = normalizeWindyCamera(rawWindy({ player: { live: 'https://evil.example.test/embed' } }));
    expect(untrusted?.mediaKind).toBe('image');
    expect(untrusted?.mediaUrl).toContain('/preview.jpg');
  });

  it('skips records with missing coordinates, malformed titles, or no usable media', () => {
    expect(normalizeWindyCamera({ ...rawWindy(), location: {} })).toBeNull();
    expect(normalizeWindyCamera({ ...rawWindy(), title: '  ' })).toBeNull();
    expect(normalizeWindyCamera({ ...rawWindy(), images: {}, player: {} })).toBeNull();
    expect(normalizeWindyCamera(rawWindy({ location: { latitude: 91, longitude: 120 } }))).toBeNull();
  });

  it('fetches through the same-origin proxy and filters out-of-NCR records', async () => {
    const inside = rawWindy();
    const outside = rawWindy({ webcamId: 777, location: { latitude: 0, longitude: 0 } });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      cameras: [inside, outside], fetchedAt: 1_797_000_000, stale: false,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const snapshot = await fetchWindyCameras(fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith('/api/cameras', expect.objectContaining({ cache: 'no-store' }));
    expect(snapshot.cameras).toHaveLength(1);
    expect(snapshot.cameras[0].city.id).toBe('manila');
  });

  it('rejects non-OK proxy responses and invalid snapshot envelopes', async () => {
    const fail = vi.fn(async () => new Response('{}', { status: 503 }));
    await expect(fetchWindyCameras(fail as unknown as typeof fetch)).rejects.toThrow('503');
    const badEnvelope = vi.fn(async () => new Response(JSON.stringify({ cameras: {}, fetchedAt: -1 }), { status: 200 }));
    await expect(fetchWindyCameras(badEnvelope as unknown as typeof fetch)).rejects.toThrow('Invalid camera service response');
  });
});
