import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WebcamPopup } from './WebcamPopup';
import type { MetroManilaTrafficCamera } from '../../types/camera';

function sampleCam(overrides: Partial<MetroManilaTrafficCamera> = {}): MetroManilaTrafficCamera {
  return {
    sourceId: '1',
    source: 'Windy',
    name: 'Quezon Ave Camera',
    coordinates: [121.02, 14.64],
    mediaKind: 'image',
    mediaUrl: 'https://images.example.test/pic.jpg',
    city: { id: 'quezon-city', name: 'Quezon City' },
    observedAt: 1700000000,
    detailUrl: 'https://www.windy.com/webcams/1',
    areaLabel: 'Diliman',
    ...overrides,
  };
}

describe('WebcamPopup', () => {
  it('renders webcam title, location, image, update time and Windy attribution', () => {
    render(<WebcamPopup camera={sampleCam()} />);

    expect(screen.getByRole('heading', { level: 2, name: 'Quezon Ave Camera' })).toBeInTheDocument();
    expect(screen.getByText(/Quezon City · Diliman/)).toBeInTheDocument();
    const img = screen.getByRole('img', { name: 'Quezon Ave Camera current webcam image' });
    expect(img).toHaveAttribute('src', 'https://images.example.test/pic.jpg');
    expect(screen.getByText(/Webcams provided by/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Windy.com' })).toHaveAttribute('href', 'https://www.windy.com/');
  });

  it('renders iframe for valid Windy video stream', () => {
    render(
      <WebcamPopup
        camera={sampleCam({
          mediaKind: 'video',
          mediaUrl: 'https://webcams.windy.com/embed/player',
        })}
      />,
    );

    const iframe = screen.getByTitle('Quezon Ave Camera webcam player');
    expect(iframe).toHaveAttribute('src', 'https://webcams.windy.com/embed/player');
  });
});
