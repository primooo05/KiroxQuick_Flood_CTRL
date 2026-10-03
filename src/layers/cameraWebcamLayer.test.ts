import { describe, expect, it, vi } from 'vitest';
import type { MetroManilaTrafficCamera } from '../types/camera';
import {
  buildWebcamLayer,
  cameraFromFeature,
  installWebcamLayer,
  isCameraCityVisible,
  updateWebcamSource,
  webcamsToGeoJSON,
  WEBCAM_LAYER_ID,
  WEBCAM_MIN_ZOOM,
  WEBCAM_SOURCE_ID,
  type WebcamLayerMapAdapter,
} from './cameraWebcamLayer';

function sampleCamera(): MetroManilaTrafficCamera {
  return {
    sourceId: '101',
    source: 'Windy',
    name: 'EDSA - Guadalupe',
    coordinates: [121.04, 14.57],
    mediaKind: 'image',
    mediaUrl: 'https://images.example.test/cam.jpg',
    city: { id: 'makati', name: 'Makati' },
    observedAt: 1700000000,
  };
}

describe('cameraWebcamLayer', () => {
  it('converts cameras to GeoJSON Point FeatureCollection', () => {
    const fc = webcamsToGeoJSON([sampleCamera()]);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry.coordinates).toEqual([121.04, 14.57]);
    expect(fc.features[0].properties.cityName).toBe('Makati');
    expect(fc.features[0].properties.mediaUrl).toBe('https://images.example.test/cam.jpg');
  });

  it('builds layer with minzoom set so regional/country zoom suppresses markers', () => {
    const layer = buildWebcamLayer();
    expect(layer.id).toBe(WEBCAM_LAYER_ID);
    expect(layer.source).toBe(WEBCAM_SOURCE_ID);
    expect(layer.minzoom).toBe(WEBCAM_MIN_ZOOM);
    expect(layer.minzoom).toBeGreaterThanOrEqual(8.5);
  });

  it('installs source and layer onto map adapter', () => {
    const addedSources = new Map<string, unknown>();
    const addedLayers: unknown[] = [];
    const map: WebcamLayerMapAdapter = {
      addSource: (id, src) => { addedSources.set(id, src); },
      addLayer: (l) => { addedLayers.push(l); },
    };

    installWebcamLayer(map, [sampleCamera()]);
    expect(addedSources.has(WEBCAM_SOURCE_ID)).toBe(true);
    expect(addedLayers).toHaveLength(1);
  });

  it('updates source data via setData', () => {
    const setData = vi.fn();
    const map = {
      getSource: vi.fn(() => ({ setData })),
    };

    updateWebcamSource(map, [sampleCamera()]);
    expect(setData).toHaveBeenCalledWith(webcamsToGeoJSON([sampleCamera()]));
  });

  describe('isCameraCityVisible', () => {
    const cam = sampleCamera(); // Makati: approx [121.04, 14.57]

    it('returns false when zoomed out to regional/country level (< 8.5)', () => {
      expect(isCameraCityVisible(cam, { zoom: 5 })).toBe(false);
      expect(isCameraCityVisible(cam, { zoom: 8.0 })).toBe(false);
    });

    it('allows popup when zoomed in at street level (>= 15.5) as long as city/camera is in view', () => {
      expect(
        isCameraCityVisible(cam, {
          zoom: 16,
          center: [121.04, 14.57],
        }),
      ).toBe(true);
    });

    it('returns true when zoom is in city range and center is in Makati', () => {
      expect(
        isCameraCityVisible(cam, {
          zoom: 12,
          center: [121.0244, 14.5547], // Ayala Makati center
        }),
      ).toBe(true);
    });

    it('returns false when viewport bounds exclude Makati', () => {
      expect(
        isCameraCityVisible(cam, {
          zoom: 12,
          bounds: [121.08, 14.68, 121.15, 14.75], // Northern QC / outside Makati
        }),
      ).toBe(false);
    });
  });

  it('reconstructs camera from GeoJSON feature properties', () => {
    const cam = sampleCamera();
    const fc = webcamsToGeoJSON([cam]);
    const restored = cameraFromFeature(fc.features[0].properties, [121.04, 14.57]);
    expect(restored).not.toBeNull();
    expect(restored?.name).toBe('EDSA - Guadalupe');
    expect(restored?.city.name).toBe('Makati');
  });
});
