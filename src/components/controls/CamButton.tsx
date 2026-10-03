// src/components/controls/CamButton.tsx
//
// Cambutton on the right side of the map.
// Lists all available webcams in Metro Manila in an on-demand floating panel.
//
// Optimization / Privacy requirement:
// "We should not fetch all data on a certain cam unless clicked."
// - Before click: only basic camera list metadata is rendered.
//   No camera images are loaded (thumbnail shows a placeholder box),
//   and no weather / detail API calls are made.
// - On click: fetches the full camera data (fresh image, Open-Meteo weather),
//   renders the live image, expands camera details, and focuses the map.

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { MetroManilaTrafficCamera } from '../../types/camera';
import {
  fetchWindyCameras,
  fetchWindyCameraImageUrl,
} from '../../services/windyCameraService';
import {
  fetchCameraWeather,
  type CameraWeatherSnapshot,
} from '../../services/cameraWeatherService';
import { CloseIcon, VideoIcon } from './icons';
import { formatCameraDateTime } from './camFormatting';

export interface CameraDetailData {
  loading: boolean;
  imageUrl?: string | null;
  weather?: CameraWeatherSnapshot | null;
  error?: string | null;
}

export interface CamButtonProps {
  /** Initial open state. Defaults to false. */
  defaultOpen?: boolean;
  /** Custom loader for Metro Manila cameras (defaults to fetchWindyCameras). */
  loadCameras?: (signal?: AbortSignal) => Promise<readonly MetroManilaTrafficCamera[]>;
  /** Callback when a camera is clicked / selected. */
  onSelectCamera?: (camera: MetroManilaTrafficCamera) => void;
  /** Custom loader for a specific camera's details when clicked. */
  fetchCameraDetails?: (
    camera: MetroManilaTrafficCamera,
    signal?: AbortSignal,
  ) => Promise<{
    imageUrl?: string | null;
    weather?: CameraWeatherSnapshot | null;
  }>;
}

async function defaultFetchCameraDetails(
  camera: MetroManilaTrafficCamera,
  signal?: AbortSignal,
): Promise<{ imageUrl?: string | null; weather?: CameraWeatherSnapshot | null }> {
  const [imgResult, weatherResult] = await Promise.allSettled([
    camera.mediaKind === 'image'
      ? fetchWindyCameraImageUrl(camera.sourceId, fetch, signal).catch(() => camera.mediaUrl)
      : Promise.resolve(camera.mediaUrl),
    fetchCameraWeather(camera.coordinates, fetch, signal).catch(() => null),
  ]);

  return {
    imageUrl:
      imgResult.status === 'fulfilled' && imgResult.value
        ? imgResult.value
        : camera.mediaUrl,
    weather: weatherResult.status === 'fulfilled' ? weatherResult.value : null,
  };
}

export function CamButton({
  defaultOpen = false,
  loadCameras,
  onSelectCamera,
  fetchCameraDetails = defaultFetchCameraDetails,
}: CamButtonProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [cameras, setCameras] = useState<readonly MetroManilaTrafficCamera[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [cameraData, setCameraData] = useState<Record<string, CameraDetailData>>({});
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(max-width: 767px)').matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 767px)');
    const update = (): void => setIsMobile(media.matches);
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const activeDetailController = useRef<AbortController | null>(null);
  const panelId = useId();

  const close = useCallback((): void => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      close();
    }
  };

  const loadFn = useRef(loadCameras);
  loadFn.current = loadCameras;

  // Fetch all Metro Manila webcams on demand when opened for the first time
  useEffect(() => {
    if (!open || hasLoaded) return;

    setLoading(true);
    setError(null);
    const controller = new AbortController();

    const doFetch = async () => {
      try {
        const list = loadFn.current
          ? await loadFn.current(controller.signal)
          : (await fetchWindyCameras(fetch, controller.signal)).cameras;
        if (!controller.signal.aborted) {
          setCameras(list);
          setHasLoaded(true);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error ? err.message : 'Unable to load Metro Manila webcams',
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void doFetch();

    return () => {
      controller.abort();
    };
  }, [open, hasLoaded]);

  // Handle clicking a specific camera: fetch its details only on click
  const handleCameraClick = async (camera: MetroManilaTrafficCamera) => {
    const isAlreadySelected = selectedCameraId === camera.sourceId;
    if (isAlreadySelected) {
      setSelectedCameraId(null);
      return;
    }

    setSelectedCameraId(camera.sourceId);
    onSelectCamera?.(camera);

    // If details already fetched or currently loading, skip re-fetching
    const existing = cameraData[camera.sourceId];
    if (existing && !existing.error && (existing.imageUrl || existing.weather)) {
      return;
    }

    activeDetailController.current?.abort();
    const controller = new AbortController();
    activeDetailController.current = controller;

    setCameraData((prev) => ({
      ...prev,
      [camera.sourceId]: { loading: true },
    }));

    try {
      const details = await fetchCameraDetails(camera, controller.signal);
      if (!controller.signal.aborted) {
        setCameraData((prev) => ({
          ...prev,
          [camera.sourceId]: {
            loading: false,
            imageUrl: details.imageUrl ?? camera.mediaUrl,
            weather: details.weather ?? null,
          },
        }));
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setCameraData((prev) => ({
          ...prev,
          [camera.sourceId]: {
            loading: false,
            imageUrl: camera.mediaUrl,
            error: err instanceof Error ? err.message : 'Failed to fetch details',
          },
        }));
      }
    }
  };

  const panel = (
      <div
        id={panelId}
        className={"baharoute-cam-panel" + (isMobile ? " baharoute-cam-panel--mobile" : "")}
        data-testid="cam-panel"
        hidden={!open}
        role={isMobile ? 'dialog' : 'region'}
        aria-modal={isMobile ? true : undefined}
        aria-label="Metro Manila webcams"
        onKeyDown={onKeyDown}
      >
        <div className="baharoute-cam-panel__header">
          <div className="baharoute-cam-panel__title-group">
            <h2 className="baharoute-cam-panel__title">Metro Manila Webcams</h2>
            {cameras.length > 0 && (
              <span className="baharoute-cam-panel__badge">
                {cameras.length} available
              </span>
            )}
          </div>
          <button
            type="button"
            className="baharoute-icon-button baharoute-focus-ring"
            aria-label="Close webcam list"
            onClick={close}
          >
            <CloseIcon />
          </button>
        </div>

        <p className="baharoute-cam-panel__hint">
          Click a camera to view live feed and weather conditions.
        </p>

        {loading && (
          <div className="baharoute-cam-panel__loading" data-testid="cam-panel-loading">
            <span className="baharoute-cam-item__spinner" />
            <span>Loading Metro Manila webcams…</span>
          </div>
        )}

        {error && (
          <div className="baharoute-cam-panel__error" role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="baharoute-cam-panel__retry baharoute-focus-ring"
              onClick={() => {
                setHasLoaded(false);
              }}
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && cameras.length === 0 && hasLoaded && (
          <p className="baharoute-cam-panel__empty">
            No webcams currently available in Metro Manila.
          </p>
        )}

        <div className="baharoute-cam-panel__list" role="list">
          {cameras.map((camera) => {
            const isSelected = selectedCameraId === camera.sourceId;
            const details = cameraData[camera.sourceId];
            const { date, time } = formatCameraDateTime(camera.observedAt);
            const statusLabel =
              camera.status === 'inactive' ? 'Inactive' : 'Active';

            return (
              <div
                key={camera.sourceId}
                className={`baharoute-cam-item-container ${isSelected ? 'baharoute-cam-item-container--selected' : ''}`}
                role="listitem"
              >
                <button
                  type="button"
                  className="baharoute-cam-item baharoute-focus-ring"
                  data-testid={`cam-item-${camera.sourceId}`}
                  aria-expanded={isSelected}
                  onClick={() => {
                    void handleCameraClick(camera);
                  }}
                >
                  {/* Left: Square Thumbnail (placeholder until clicked) */}
                  <div
                    className="baharoute-cam-item__thumb"
                    data-testid={`cam-thumb-${camera.sourceId}`}
                  >
                    {details?.imageUrl ? (
                      <img
                        src={details.imageUrl}
                        alt={`${camera.name} preview`}
                        className="baharoute-cam-item__img"
                        loading="lazy"
                      />
                    ) : details?.loading ? (
                      <div
                        className="baharoute-cam-item__thumb-loading"
                        aria-label="Loading feed"
                      >
                        <span className="baharoute-cam-item__spinner" />
                      </div>
                    ) : (
                      <div
                        className="baharoute-cam-item__thumb-placeholder"
                        data-testid={`cam-thumb-placeholder-${camera.sourceId}`}
                        aria-label="Camera placeholder"
                      />
                    )}
                  </div>

                  {/* Center: Camera Name */}
                  <div className="baharoute-cam-item__center">
                    <span className="baharoute-cam-item__name">
                      {camera.name}
                    </span>
                    {camera.city?.name && (
                      <span className="baharoute-cam-item__city">
                        {camera.city.name}
                        {camera.areaLabel ? ` · ${camera.areaLabel}` : ''}
                      </span>
                    )}
                  </div>

                  {/* Right: Date, Time, Status, and 5 Horizontal Bars */}
                  <div className="baharoute-cam-item__right">
                    <div className="baharoute-cam-item__meta-texts">
                      <span className="baharoute-cam-item__date">{date}</span>
                      <span className="baharoute-cam-item__time">{time}</span>
                      <span
                        className={`baharoute-cam-item__status baharoute-cam-item__status--${camera.status ?? 'active'}`}
                      >
                        {statusLabel}
                      </span>
                    </div>
                    <div className="baharoute-cam-item__lines" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                </button>

                {/* Expanded Details Section: Only rendered and fetched for clicked camera */}
                {isSelected && (
                  <div
                    className="baharoute-cam-detail"
                    data-testid={`cam-detail-${camera.sourceId}`}
                  >
                    {details?.loading ? (
                      <div className="baharoute-cam-detail__loading">
                        <span className="baharoute-cam-item__spinner" />
                        <span>Fetching live feed & weather data…</span>
                      </div>
                    ) : (
                      <>
                        <div className="baharoute-cam-detail__media-wrapper">
                          {camera.mediaKind === 'video' ? (
                            <iframe
                              className="baharoute-cam-detail__video"
                              src={details?.imageUrl ?? camera.mediaUrl}
                              title={`${camera.name} live stream`}
                              loading="lazy"
                              allow="autoplay; fullscreen; picture-in-picture"
                              allowFullScreen
                            />
                          ) : (
                            <img
                              className="baharoute-cam-detail__image"
                              src={details?.imageUrl ?? camera.mediaUrl}
                              alt={`${camera.name} current view`}
                            />
                          )}
                        </div>

                        {details?.weather && (
                          <div className="baharoute-cam-detail__weather">
                            <span className="baharoute-cam-detail__weather-status">
                              {details.weather.weatherStatus}
                            </span>
                            <span className="baharoute-cam-detail__weather-temp">
                              🌡 {Math.round(details.weather.temperatureC)}°C
                            </span>
                            <span className="baharoute-cam-detail__weather-heat">
                              Heat Index: {Math.round(details.weather.heatIndexC)}°C
                            </span>
                          </div>
                        )}

                        <div className="baharoute-cam-detail__actions">
                          {camera.detailUrl && (
                            <a
                              href={camera.detailUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="baharoute-cam-detail__link baharoute-focus-ring"
                            >
                              View on Windy.com
                            </a>
                          )}
                          <button
                            type="button"
                            className="baharoute-cam-detail__view-btn baharoute-focus-ring"
                            onClick={() => onSelectCamera?.(camera)}
                          >
                            Focus on Map
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
  );

  return (
    <>
      <div className="baharoute-cambutton-wrapper" onKeyDown={onKeyDown}>
        <button
          ref={buttonRef}
          type="button"
          className="baharoute-round-button baharoute-focus-ring"
          data-testid="cambutton"
          aria-label="Metro Manila webcams"
          title="Metro Manila webcams"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((prev) => !prev)}
        >
          <VideoIcon />
        </button>
        {!isMobile && panel}
      </div>
      {isMobile && open && typeof document !== 'undefined' &&
        createPortal(
          <div
            className="baharoute-cam-modal-backdrop"
            data-testid="cam-modal-backdrop"
            onClick={(event) => {
              if (event.target === event.currentTarget) close();
            }}
          >
            {panel}
          </div>,
          document.body,
        )}
    </>
  );
}

export default CamButton;
