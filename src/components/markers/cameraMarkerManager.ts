import type { MetroManilaTrafficCamera } from '../../types/camera';
import { CAMERA_REFRESH_INTERVAL_MS } from '../../services/cameraRefresh';
import type { CameraWeatherSnapshot } from '../../services/cameraWeatherService';

export interface CameraMapMarker {
  setLngLat(position: [number, number]): this;
  addTo(map: unknown): this;
  remove(): this;
}
export interface CameraMapPopup {
  setLngLat(position: [number, number]): this;
  setDOMContent(element: HTMLElement): this;
  addTo(map: unknown): this;
  remove(): this;
  on?(type: 'close', listener: () => void): this;
}
export interface CameraMarkerFactory {
  marker(element: HTMLElement): CameraMapMarker;
  popup(): CameraMapPopup;
}

interface PlacedCamera {
  camera: MetroManilaTrafficCamera;
  marker: CameraMapMarker;
  button: HTMLButtonElement;
}

export interface CameraMarkerManagerOptions {
  map: unknown;
  factory: CameraMarkerFactory;
  document?: Document;
  canOpenPopup?: (camera: MetroManilaTrafficCamera) => boolean;
  refreshImageUrl?: (webcamId: string, signal: AbortSignal) => Promise<string | null>;
  loadWeather?: (
    coordinates: readonly [longitude: number, latitude: number],
    signal: AbortSignal,
  ) => Promise<CameraWeatherSnapshot>;
  imageRefreshIntervalMs?: number;
}

/** Owns custom, accessible camera markers and one interactive media popup. */
export class CameraMarkerManager {
  private readonly map: unknown;
  private readonly factory: CameraMarkerFactory;
  private readonly doc: Document;
  private readonly canOpenPopup?: (camera: MetroManilaTrafficCamera) => boolean;
  private readonly refreshImageUrl?: CameraMarkerManagerOptions['refreshImageUrl'];
  private readonly loadWeather?: CameraMarkerManagerOptions['loadWeather'];
  private readonly imageRefreshIntervalMs: number;
  private readonly markers = new Map<string, PlacedCamera>();
  private activePopup: CameraMapPopup | null = null;
  private activePopupContent: HTMLElement | null = null;
  private activeId: string | null = null;
  private activeImage: HTMLImageElement | null = null;
  private activeImageErrorHandler: (() => void) | null = null;
  private imageRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private imageRefreshController: AbortController | null = null;
  private imageRefreshInFlight = false;
  private weatherController: AbortController | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: CameraMarkerManagerOptions) {
    this.map = options.map;
    this.factory = options.factory;
    this.doc = options.document ?? document;
    this.canOpenPopup = options.canOpenPopup;
    this.refreshImageUrl = options.refreshImageUrl;
    this.loadWeather = options.loadWeather;
    this.imageRefreshIntervalMs = options.imageRefreshIntervalMs ?? CAMERA_REFRESH_INTERVAL_MS;
  }

  setCameras(cameras: readonly MetroManilaTrafficCamera[]): void {
    const next = new Map<string, MetroManilaTrafficCamera>();
    for (const camera of cameras) next.set(cameraKey(camera), camera);

    for (const [key, placed] of this.markers) {
      const updated = next.get(key);
      if (!updated) {
        placed.marker.remove();
        this.markers.delete(key);
        if (this.activeId === key) this.closePopup();
        continue;
      }
      placed.camera = updated;
      placed.marker.setLngLat([...updated.coordinates]);
      next.delete(key);
    }

    for (const [key, camera] of next) {
      const button = createCameraMarkerElement(camera, this.doc);
      const placed: PlacedCamera = {
        camera,
        button,
        marker: this.factory.marker(button).setLngLat([...camera.coordinates]).addTo(this.map),
      };
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        this.openPopup(key);
      });
      button.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.openPopup(key);
        }
      });
      this.markers.set(key, placed);
    }

    if (this.activeId) {
      const current = this.markers.get(this.activeId);
      if (current && this.activePopupContent) {
        const title = this.activePopupContent.querySelector('.baharoute-camera-popup__title');
        if (title) title.textContent = current.camera.name;
        const location = this.activePopupContent.querySelector('.baharoute-camera-popup__location');
        if (location) location.textContent = formatCameraPlace(current.camera);
        updateCameraSummary(current.camera, this.activePopupContent);
        const timestamp = this.activePopupContent.querySelector('.baharoute-camera-popup__timestamp');
        if (timestamp) {
          timestamp.textContent = current.camera.observedAt !== undefined
            ? `Source update: ${new Date(current.camera.observedAt * 1000).toLocaleString()}`
            : 'Source update time unavailable';
        }
        this.activePopupContent.setAttribute('aria-label', `${current.camera.name} webcam details`);
        if (this.activeImage && this.activeImage.getAttribute('src') !== current.camera.mediaUrl) {
          this.activeImage.src = current.camera.mediaUrl;
        }
      }
    }
  }

  destroy(): void {
    this.closePopup();
    for (const marker of this.markers.values()) marker.marker.remove();
    this.markers.clear();
  }

  private openPopup(key: string): void {
    const placed = this.markers.get(key);
    if (!placed) return;
    if (this.canOpenPopup && !this.canOpenPopup(placed.camera)) {
      return;
    }
    this.closePopup();
    this.activeId = key;
    const popup = this.factory.popup();
    const content = createCameraPopupContent(placed.camera, this.doc);
    this.activePopupContent = content;
    this.activePopup = popup;
    popup.on?.('close', () => {
      if (this.activePopup === popup) {
        this.stopImageRefresh();
        this.stopWeatherRefresh();
        this.stopClock();
        this.activePopup = null;
        this.activePopupContent = null;
        this.activeId = null;
      }
    });
    const image = content.querySelector('img');
    if (image && placed.camera.mediaKind === 'image' && this.refreshImageUrl) {
      this.activeImage = image;
      this.activeImageErrorHandler = () => { void this.refreshActiveImage(key); };
      image.addEventListener('error', this.activeImageErrorHandler);
    }
    popup
      .setLngLat([...placed.camera.coordinates])
      .setDOMContent(content)
      .addTo(this.map);
    if (this.loadWeather) {
      this.clockTimer = setInterval(() => updateCurrentTime(content), 30_000);
      void this.refreshActiveWeather(key, placed.camera.coordinates);
    }
    if (this.activeImage && this.refreshImageUrl) {
      void this.refreshActiveImage(key);
      this.imageRefreshTimer = setInterval(
        () => { void this.refreshActiveImage(key); },
        this.imageRefreshIntervalMs,
      );
    }
  }

  private closePopup(): void {
    const popup = this.activePopup;
    this.stopImageRefresh();
    this.stopWeatherRefresh();
    this.stopClock();
    this.activePopup = null;
    this.activePopupContent = null;
    this.activeId = null;
    popup?.remove();
  }

  private async refreshActiveImage(key: string): Promise<void> {
    const placed = this.markers.get(key);
    const image = this.activeImage;
    if (!placed || !image || this.activeId !== key || !this.refreshImageUrl || this.imageRefreshInFlight) return;

    this.imageRefreshInFlight = true;
    const controller = new AbortController();
    this.imageRefreshController = controller;
    try {
      const mediaUrl = await this.refreshImageUrl(placed.camera.sourceId, controller.signal);
      if (mediaUrl && this.activeId === key && this.activeImage === image && image.getAttribute('src') !== mediaUrl) {
        placed.camera = { ...placed.camera, mediaUrl };
        image.src = mediaUrl;
      }
    } catch {
      // A failed silent renewal leaves the current image in place; an image
      // error can retry immediately, and the interval will try again later.
    } finally {
      if (this.imageRefreshController === controller) {
        this.imageRefreshController = null;
        this.imageRefreshInFlight = false;
      }
    }
  }

  private stopImageRefresh(): void {
    if (this.imageRefreshTimer !== null) clearInterval(this.imageRefreshTimer);
    this.imageRefreshTimer = null;
    this.imageRefreshController?.abort();
    this.imageRefreshController = null;
    this.imageRefreshInFlight = false;
    if (this.activeImage && this.activeImageErrorHandler) {
      this.activeImage.removeEventListener('error', this.activeImageErrorHandler);
    }
    this.activeImage = null;
    this.activeImageErrorHandler = null;
  }

  private async refreshActiveWeather(
    key: string,
    coordinates: readonly [longitude: number, latitude: number],
  ): Promise<void> {
    if (!this.loadWeather || this.activeId !== key || !this.activePopupContent) return;
    this.weatherController?.abort();
    const controller = new AbortController();
    this.weatherController = controller;
    setWeatherLoading(this.activePopupContent);
    try {
      const weather = await this.loadWeather(coordinates, controller.signal);
      if (this.activeId === key && !controller.signal.aborted && this.activePopupContent) {
        setWeatherSummary(this.activePopupContent, weather);
      }
    } catch {
      if (this.activeId === key && !controller.signal.aborted && this.activePopupContent) {
        setWeatherUnavailable(this.activePopupContent);
      }
    } finally {
      if (this.weatherController === controller) this.weatherController = null;
    }
  }

  private stopWeatherRefresh(): void {
    this.weatherController?.abort();
    this.weatherController = null;
  }

  private stopClock(): void {
    if (this.clockTimer !== null) clearInterval(this.clockTimer);
    this.clockTimer = null;
  }
}

export function createCameraMarkerElement(
  camera: MetroManilaTrafficCamera,
  doc: Document = document,
): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'baharoute-camera-marker baharoute-focus-ring';
  button.dataset.cameraId = cameraKey(camera);
  button.setAttribute('aria-label', `Open ${camera.name} webcam, ${camera.city.name}`);
  button.title = `${camera.name} · ${camera.city.name}`;
  button.textContent = 'CAM';
  return button;
}

export function createCameraPopupContent(
  camera: MetroManilaTrafficCamera,
  doc: Document = document,
): HTMLElement {
  const root = doc.createElement('article');
  root.className = 'baharoute-camera-popup';
  root.setAttribute('aria-label', `${camera.name} webcam details`);

  const title = doc.createElement('h2');
  title.className = 'baharoute-camera-popup__title';
  title.textContent = camera.name;
  root.appendChild(title);

  const location = doc.createElement('p');
  location.className = 'baharoute-camera-popup__location';
  location.textContent = formatCameraPlace(camera);
  root.appendChild(location);

  const summary = doc.createElement('section');
  summary.className = 'baharoute-camera-popup__summary';
  summary.setAttribute('aria-label', 'Camera summary');
  const summaryTitle = doc.createElement('h3');
  summaryTitle.textContent = 'Summary';
  summary.appendChild(summaryTitle);
  const fields = doc.createElement('dl');
  fields.className = 'baharoute-camera-popup__summary-fields';
  appendSummaryField(fields, 'Location', 'location', formatCameraLocation(camera), doc);
  appendSummaryField(fields, 'Current time', 'current-time', formatCurrentTime(), doc);
  appendSummaryField(fields, 'Date', 'date', formatCurrentDate(), doc);
  appendSummaryField(fields, 'Camera status', 'camera-status', formatCameraStatus(camera), doc);
  appendSummaryField(fields, 'Weather status', 'weather-status', 'Loading…', doc);
  appendSummaryField(fields, 'Temperature', 'temperature', 'Loading…', doc);
  appendSummaryField(fields, 'Heat index', 'heat-index', 'Loading…', doc);
  summary.appendChild(fields);
  const weatherSource = doc.createElement('p');
  weatherSource.className = 'baharoute-camera-popup__weather-source';
  const weatherSourceLink = doc.createElement('a');
  weatherSourceLink.href = 'https://open-meteo.com/';
  weatherSourceLink.target = '_blank';
  weatherSourceLink.rel = 'noopener noreferrer';
  weatherSourceLink.textContent = 'Open-Meteo';
  weatherSource.append('Estimated weather from ', weatherSourceLink, '. Heat index is derived using the NWS formula.');
  summary.appendChild(weatherSource);
  root.appendChild(summary);

  const media = doc.createElement('div');
  media.className = 'baharoute-camera-popup__media';
  if (camera.mediaKind === 'video') {
    if (isWindyEmbed(camera.mediaUrl)) {
      const frame = doc.createElement('iframe');
      frame.className = 'baharoute-camera-popup__video';
      frame.src = camera.mediaUrl;
      frame.title = `${camera.name} webcam player`;
      frame.loading = 'lazy';
      frame.referrerPolicy = 'no-referrer';
      frame.allow = 'autoplay; fullscreen; picture-in-picture';
      frame.allowFullscreen = true;
      media.appendChild(frame);
    } else {
      const unavailable = doc.createElement('p');
      unavailable.textContent = 'Windy player URL unavailable.';
      media.appendChild(unavailable);
    }
  } else {
    const mediaLink = doc.createElement('a');
    mediaLink.className = 'baharoute-camera-popup__media-link';
    mediaLink.href = camera.detailUrl ?? 'https://www.windy.com/webcams';
    mediaLink.target = '_blank';
    mediaLink.rel = 'noopener noreferrer';
    mediaLink.setAttribute('aria-label', `Open ${camera.name} on Windy`);
    const image = doc.createElement('img');
    image.className = 'baharoute-camera-popup__image';
    image.src = camera.mediaUrl;
    image.alt = `${camera.name} current webcam image`;
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    mediaLink.appendChild(image);
    media.appendChild(mediaLink);
  }
  root.appendChild(media);

  const timestamp = doc.createElement('p');
  timestamp.className = 'baharoute-camera-popup__timestamp';
  timestamp.textContent = camera.observedAt !== undefined
    ? `Source update: ${new Date(camera.observedAt * 1000).toLocaleString()}`
    : 'Source update time unavailable';
  root.appendChild(timestamp);

  const attribution = doc.createElement('p');
  attribution.className = 'baharoute-camera-popup__attribution';
  const providerLink = doc.createElement('a');
  providerLink.href = 'https://www.windy.com/';
  providerLink.target = '_blank';
  providerLink.rel = 'noopener noreferrer';
  providerLink.textContent = 'Windy.com';
  attribution.append('Webcams provided by ', providerLink, ' — ');
  const addLink = doc.createElement('a');
  addLink.href = 'https://www.windy.com/webcams/add';
  addLink.target = '_blank';
  addLink.rel = 'noopener noreferrer';
  addLink.textContent = 'add a webcam';
  attribution.append(addLink);
  root.appendChild(attribution);
  return root;
}

function cameraKey(camera: MetroManilaTrafficCamera): string {
  return `${camera.source}\u0000${camera.sourceId}`;
}

function appendSummaryField(
  fields: HTMLDListElement,
  label: string,
  key: string,
  value: string,
  doc: Document,
): void {
  const term = doc.createElement('dt');
  term.textContent = label;
  const description = doc.createElement('dd');
  description.dataset.summary = key;
  description.textContent = value;
  fields.append(term, description);
}

function updateCameraSummary(camera: MetroManilaTrafficCamera, root: HTMLElement): void {
  const location = root.querySelector<HTMLElement>('[data-summary="location"]');
  if (location) location.textContent = formatCameraLocation(camera);
  const status = root.querySelector<HTMLElement>('[data-summary="camera-status"]');
  if (status) status.textContent = formatCameraStatus(camera);
}

function formatCameraLocation(camera: MetroManilaTrafficCamera): string {
  const [longitude, latitude] = camera.coordinates;
  return `${formatCameraPlace(camera)} · ${Math.abs(latitude).toFixed(4)}° ${latitude < 0 ? 'S' : 'N'}, ${Math.abs(longitude).toFixed(4)}° ${longitude < 0 ? 'W' : 'E'}`;
}

function formatCameraPlace(camera: MetroManilaTrafficCamera): string {
  const areaLabel = camera.areaLabel?.trim();
  if (areaLabel && areaLabel.toLocaleLowerCase() !== camera.city.name.toLocaleLowerCase()) {
    return `${areaLabel}, ${camera.city.name}`;
  }
  return camera.city.name;
}

function formatCameraStatus(camera: MetroManilaTrafficCamera): string {
  if (camera.status === 'active') return 'Active';
  if (camera.status === 'inactive') return 'Inactive';
  return 'Unavailable';
}

function formatCurrentTime(now = new Date()): string {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  }).format(now);
}

function formatCurrentDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
  }).format(now);
}

function updateCurrentTime(root: HTMLElement): void {
  const time = root.querySelector<HTMLElement>('[data-summary="current-time"]');
  if (time) time.textContent = formatCurrentTime();
  const date = root.querySelector<HTMLElement>('[data-summary="date"]');
  if (date) date.textContent = formatCurrentDate();
}

function setWeatherLoading(root: HTMLElement): void {
  setSummaryValue(root, 'weather-status', 'Loading…');
  setSummaryValue(root, 'temperature', 'Loading…');
  setSummaryValue(root, 'heat-index', 'Loading…');
}

function setWeatherSummary(root: HTMLElement, weather: CameraWeatherSnapshot): void {
  setSummaryValue(root, 'weather-status', weather.weatherStatus);
  setSummaryValue(root, 'temperature', `${weather.temperatureC.toFixed(1)} °C`);
  setSummaryValue(root, 'heat-index', `${weather.heatIndexC.toFixed(1)} °C`);
}

function setWeatherUnavailable(root: HTMLElement): void {
  setSummaryValue(root, 'weather-status', 'Unavailable');
  setSummaryValue(root, 'temperature', 'Unavailable');
  setSummaryValue(root, 'heat-index', 'Unavailable');
}

function setSummaryValue(root: HTMLElement, key: string, value: string): void {
  const element = root.querySelector<HTMLElement>(`[data-summary="${key}"]`);
  if (element) element.textContent = value;
}

function isWindyEmbed(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (host === 'windy.com' || host.endsWith('.windy.com'));
  } catch { return false; }
}
