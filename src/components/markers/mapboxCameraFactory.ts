import mapboxgl from 'mapbox-gl';
import type { CameraMarkerFactory } from './cameraMarkerManager';

export const mapboxCameraMarkerFactory: CameraMarkerFactory = {
  marker: (element) => new mapboxgl.Marker({ element }),
  popup: () => new mapboxgl.Popup({
    anchor: 'bottom',
    closeButton: true,
    closeOnClick: true,
    offset: 18,
    maxWidth: '340px',
  }),
};
