import { describe, expect, it } from 'vitest';
import type { MetroManilaTrafficCamera } from '../../types/camera';
import {
  CameraMarkerManager,
  createCameraMarkerElement,
  createCameraPopupContent,
  type CameraMapMarker,
  type CameraMapPopup,
} from './cameraMarkerManager';

function camera(overrides: Partial<MetroManilaTrafficCamera> = {}): MetroManilaTrafficCamera {
  return {
    sourceId: 'windy-1', source: 'Windy', name: 'Test camera',
    coordinates: [121.0, 14.6], mediaKind: 'image',
    mediaUrl: 'https://images.example.test/frame.jpg', detailUrl: 'https://www.windy.com/webcams/1',
    city: { id: 'manila', name: 'Manila' }, observedAt: 1_797_000_000,
    ...overrides,
  };
}

class FakeMarker implements CameraMapMarker {
  position: [number, number] = [0, 0];
  removed = false;
  constructor(readonly element: HTMLElement) {}
  setLngLat(position: [number, number]) { this.position = position; return this; }
  addTo(_map: unknown) { return this; }
  remove() { this.removed = true; return this; }
}

class FakePopup implements CameraMapPopup {
  position: [number, number] = [0, 0];
  content: HTMLElement | null = null;
  removed = false;
  closeListener: (() => void) | null = null;
  setLngLat(position: [number, number]) { this.position = position; return this; }
  setDOMContent(element: HTMLElement) { this.content = element; return this; }
  addTo(_map: unknown) { return this; }
  remove() { this.removed = true; this.closeListener?.(); return this; }
  on(_type: 'close', listener: () => void) { this.closeListener = listener; return this; }
}

function setup() {
  const markers: FakeMarker[] = [];
  const popups: FakePopup[] = [];
  const manager = new CameraMarkerManager({
    map: {},
    factory: {
      marker: (el) => { const marker = new FakeMarker(el); markers.push(marker); return marker; },
      popup: () => { const popup = new FakePopup(); popups.push(popup); return popup; },
    },
  });
  return { manager, markers, popups };
}

describe('camera markers and popup media', () => {
  it('builds an accessible custom button marker', () => {
    const marker = createCameraMarkerElement(camera());
    expect(marker.tagName).toBe('BUTTON');
    expect(marker.getAttribute('aria-label')).toContain('Manila');
  });

  it('opens an image preview linked to the Windy camera detail page with attribution', () => {
    const popup = createCameraPopupContent(camera());
    const image = popup.querySelector('img');
    expect(image?.src).toBe('https://images.example.test/frame.jpg');
    expect(image?.alt).toContain('Test camera');
    expect(image?.closest('a')?.href).toBe('https://www.windy.com/webcams/1');
    expect(popup.textContent).toContain('Webcams provided by');
    expect(popup.textContent).toContain('add a webcam');
    expect(popup.textContent).toContain('Source update:');
  });

  it('embeds only HTTPS Windy player URLs and safely renders provider text', () => {
    const live = createCameraPopupContent(camera({
      mediaKind: 'video', mediaUrl: 'https://webcams.windy.com/embed/live',
      name: '<img src=x onerror=alert(1)>',
    }));
    expect(live.querySelector('iframe')?.src).toBe('https://webcams.windy.com/embed/live');
    expect(live.querySelector('img')).toBeNull();
    expect(live.querySelector('h2')?.textContent).toBe('<img src=x onerror=alert(1)>');

    const untrusted = createCameraPopupContent(camera({
      mediaKind: 'video', mediaUrl: 'https://evil.example.test/embed',
    }));
    expect(untrusted.querySelector('iframe')).toBeNull();
    expect(untrusted.textContent).toContain('Windy player URL unavailable');
  });

  it('updates moved cameras, removes disappeared cameras, and keeps one popup', () => {
    const { manager, markers, popups } = setup();
    const initial = camera();
    manager.setCameras([initial]);
    expect(markers).toHaveLength(1);
    (markers[0].element as HTMLButtonElement).click();
    expect(popups).toHaveLength(1);
    expect(popups[0].position).toEqual(initial.coordinates);

    const updated = camera({ coordinates: [121.02, 14.62], name: 'Updated camera' });
    manager.setCameras([updated]);
    expect(markers).toHaveLength(1);
    expect(markers[0].position).toEqual(updated.coordinates);
    expect(popups[0].content?.textContent).toContain('Updated camera');

    manager.setCameras([]);
    expect(markers[0].removed).toBe(true);
    expect(popups[0].removed).toBe(true);
    manager.destroy();
  });

  it('removes old markers when source data changes and destroy is idempotent', () => {
    const { manager, markers } = setup();
    manager.setCameras([camera()]);
    manager.setCameras([camera({ sourceId: 'windy-2' })]);
    expect(markers).toHaveLength(2);
    expect(markers[0].removed).toBe(true);
    expect(markers[1].removed).toBe(false);
    manager.destroy();
    manager.destroy();
    expect(markers[1].removed).toBe(true);
  });

  it('respects canOpenPopup predicate and prevents opening popup if false', () => {
    const markers: FakeMarker[] = [];
    const popups: FakePopup[] = [];
    let allowPopup = false;
    const manager = new CameraMarkerManager({
      map: {},
      factory: {
        marker: (el) => { const marker = new FakeMarker(el); markers.push(marker); return marker; },
        popup: () => { const popup = new FakePopup(); popups.push(popup); return popup; },
      },
      canOpenPopup: () => allowPopup,
    });

    const cam = camera();
    manager.setCameras([cam]);
    expect(markers).toHaveLength(1);

    // Clicking when allowPopup is false
    (markers[0].element as HTMLButtonElement).click();
    expect(popups).toHaveLength(0);

    // Clicking when allowPopup is true
    allowPopup = true;
    (markers[0].element as HTMLButtonElement).click();
    expect(popups).toHaveLength(1);
    expect(popups[0].position).toEqual(cam.coordinates);
  });
});

