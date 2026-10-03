import type { MetroManilaTrafficCamera } from '../../types/camera';

export interface WebcamPopupProps {
  camera: MetroManilaTrafficCamera;
  className?: string;
}

export function WebcamPopup({ camera, className }: WebcamPopupProps) {
  const isVideo = camera.mediaKind === 'video';
  const isWindy = isWindyEmbed(camera.mediaUrl);

  return (
    <article
      className={['baharoute-camera-popup', className].filter(Boolean).join(' ')}
      aria-label={`${camera.name} webcam details`}
      data-testid="webcam-popup"
    >
      <h2 className="baharoute-camera-popup__title">{camera.name}</h2>
      <p className="baharoute-camera-popup__location">
        {camera.city.name}
        {camera.areaLabel ? ` · ${camera.areaLabel}` : ''}
      </p>

      <div className="baharoute-camera-popup__media">
        {isVideo ? (
          isWindy ? (
            <iframe
              className="baharoute-camera-popup__video"
              src={camera.mediaUrl}
              title={`${camera.name} webcam player`}
              loading="lazy"
              referrerPolicy="no-referrer"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <p>Windy player URL unavailable.</p>
          )
        ) : (
          <a
            className="baharoute-camera-popup__media-link"
            href={camera.detailUrl ?? 'https://www.windy.com/webcams'}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${camera.name} on Windy`}
          >
            <img
              className="baharoute-camera-popup__image"
              src={camera.mediaUrl}
              alt={`${camera.name} current webcam image`}
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          </a>
        )}
      </div>

      <p className="baharoute-camera-popup__timestamp">
        {camera.observedAt !== undefined
          ? `Source update: ${new Date(camera.observedAt * 1000).toLocaleString()}`
          : 'Source update time unavailable'}
      </p>

      <p className="baharoute-camera-popup__attribution">
        Webcams provided by{' '}
        <a href="https://www.windy.com/" target="_blank" rel="noopener noreferrer">
          Windy.com
        </a>{' '}
        —{' '}
        <a href="https://www.windy.com/webcams/add" target="_blank" rel="noopener noreferrer">
          add a webcam
        </a>
      </p>
    </article>
  );
}

function isWindyEmbed(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (host === 'windy.com' || host.endsWith('.windy.com'));
  } catch {
    return false;
  }
}
