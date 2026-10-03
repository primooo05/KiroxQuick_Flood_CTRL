// src/components/controls/CamButton.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CamButton } from './CamButton';
import { formatCameraDateTime } from './camFormatting';
import type { MetroManilaTrafficCamera } from '../../types/camera';

const MOCK_CAMERAS: MetroManilaTrafficCamera[] = [
  {
    sourceId: 'cam-101',
    source: 'Windy',
    name: 'EDSA - Guadalupe',
    coordinates: [121.04, 14.56],
    mediaKind: 'image',
    mediaUrl: 'https://images.example.test/cam101.jpg',
    status: 'active',
    detailUrl: 'https://www.windy.com/webcams/101',
    observedAt: 1728000000, // Sun Oct 04 2024 00:00:00 GMT+0000
    city: { id: 'makati', name: 'Makati' },
    areaLabel: 'EDSA',
  },
  {
    sourceId: 'cam-102',
    source: 'Windy',
    name: 'C5 - Bagong Ilog',
    coordinates: [121.07, 14.57],
    mediaKind: 'image',
    mediaUrl: 'https://images.example.test/cam102.jpg',
    status: 'inactive',
    detailUrl: 'https://www.windy.com/webcams/102',
    observedAt: 1728003600,
    city: { id: 'pasig', name: 'Pasig' },
    areaLabel: 'C5 Road',
  },
];

describe('CamButton', () => {
  it('starts closed, opens on click, and closes on Escape with focus returned', async () => {
    const user = userEvent.setup();
    const loadCameras = vi.fn().mockResolvedValue(MOCK_CAMERAS);

    render(<CamButton loadCameras={loadCameras} />);

    const button = screen.getByRole('button', { name: 'Metro Manila webcams' });
    const panel = screen.getByTestId('cam-panel');

    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button.querySelector('svg rect')).toBeInTheDocument();
    expect(panel).not.toBeVisible();
    expect(loadCameras).not.toHaveBeenCalled();

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(panel).toBeVisible();
    expect(loadCameras).toHaveBeenCalledTimes(1);

    await user.keyboard('{Escape}');
    expect(panel).not.toBeVisible();
    expect(button).toHaveFocus();
  });

  it('closes via the panel close button', async () => {
    const user = userEvent.setup();
    const loadCameras = vi.fn().mockResolvedValue(MOCK_CAMERAS);

    render(<CamButton defaultOpen loadCameras={loadCameras} />);

    const closeBtn = screen.getByRole('button', { name: 'Close webcam list' });
    await user.click(closeBtn);

    expect(screen.getByTestId('cam-panel')).not.toBeVisible();
  });

  it('lists all available webcams in Metro Manila with mockup-matching fields', async () => {
    const loadCameras = vi.fn().mockResolvedValue(MOCK_CAMERAS);

    render(<CamButton defaultOpen loadCameras={loadCameras} />);

    await waitFor(() => {
      expect(screen.getByText('EDSA - Guadalupe')).toBeVisible();
      expect(screen.getByText('C5 - Bagong Ilog')).toBeVisible();
      expect(screen.getByText('2 available')).toBeVisible();
    });

    // Check status labels
    expect(screen.getByText('Active')).toBeVisible();
    expect(screen.getByText('Inactive')).toBeVisible();

    // Verify 5 horizontal bars exist in both items
    const allItems = screen.getAllByRole('listitem');
    expect(allItems).toHaveLength(2);
    for (const item of allItems) {
      const lines = item.querySelector('.baharoute-cam-item__lines');
      expect(lines).not.toBeNull();
      expect(lines?.querySelectorAll('span')).toHaveLength(5);
    }
  });

  it('does NOT fetch data or load images for cameras unless clicked', async () => {
    const loadCameras = vi.fn().mockResolvedValue(MOCK_CAMERAS);
    const fetchCameraDetails = vi.fn().mockResolvedValue({
      imageUrl: 'https://images.example.test/cam101-fresh.jpg',
      weather: {
        weatherStatus: 'Partly cloudy',
        temperatureC: 31,
        heatIndexC: 37,
        fetchedAt: 1728000000,
      },
    });

    render(
      <CamButton
        defaultOpen
        loadCameras={loadCameras}
        fetchCameraDetails={fetchCameraDetails}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('EDSA - Guadalupe')).toBeVisible();
    });

    // Before clicking any camera:
    // 1. fetchCameraDetails was NEVER called
    expect(fetchCameraDetails).not.toHaveBeenCalled();

    // 2. Both cameras have placeholder thumbnails (no img elements)
    expect(screen.getByTestId('cam-thumb-placeholder-cam-101')).toBeVisible();
    expect(screen.getByTestId('cam-thumb-placeholder-cam-102')).toBeVisible();
    expect(screen.queryByAltText('EDSA - Guadalupe preview')).toBeNull();
    expect(screen.queryByAltText('C5 - Bagong Ilog preview')).toBeNull();

    // 3. No details section is shown
    expect(screen.queryByTestId('cam-detail-cam-101')).toBeNull();
    expect(screen.queryByTestId('cam-detail-cam-102')).toBeNull();
  });

  it('fetches full details, weather and loads image ONLY when a specific camera is clicked', async () => {
    const user = userEvent.setup();
    const onSelectCamera = vi.fn();
    const loadCameras = vi.fn().mockResolvedValue(MOCK_CAMERAS);
    const fetchCameraDetails = vi.fn().mockResolvedValue({
      imageUrl: 'https://images.example.test/cam101-fresh.jpg',
      weather: {
        weatherStatus: 'Partly cloudy',
        temperatureC: 31.4,
        heatIndexC: 37.2,
        fetchedAt: 1728000000,
      },
    });

    render(
      <CamButton
        defaultOpen
        loadCameras={loadCameras}
        fetchCameraDetails={fetchCameraDetails}
        onSelectCamera={onSelectCamera}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('EDSA - Guadalupe')).toBeVisible();
    });

    // Click the first camera
    const cam1Item = screen.getByTestId('cam-item-cam-101');
    await user.click(cam1Item);

    // Now fetchCameraDetails was called ONLY for cam-101, NOT for cam-102
    expect(fetchCameraDetails).toHaveBeenCalledTimes(1);
    expect(fetchCameraDetails).toHaveBeenCalledWith(
      MOCK_CAMERAS[0],
      expect.any(AbortSignal),
    );
    expect(onSelectCamera).toHaveBeenCalledWith(MOCK_CAMERAS[0]);

    // Detail section opens with weather & image for cam-101
    await waitFor(() => {
      expect(screen.getByTestId('cam-detail-cam-101')).toBeVisible();
      expect(screen.getByAltText('EDSA - Guadalupe current view')).toBeVisible();
      expect(screen.getByText('Partly cloudy')).toBeVisible();
      expect(screen.getByText('🌡 31°C')).toBeVisible();
      expect(screen.getByText('Heat Index: 37°C')).toBeVisible();
    });

    // Thumbnail for cam-101 is now an img
    expect(screen.getByAltText('EDSA - Guadalupe preview')).toBeVisible();

    // Cam 102 is STILL a placeholder and never fetched!
    expect(screen.getByTestId('cam-thumb-placeholder-cam-102')).toBeVisible();
    expect(screen.queryByTestId('cam-detail-cam-102')).toBeNull();
  });

  it('correctly formats date and time to MonthName DD, YYYY and HH:MM:SS', () => {
    // 1728000000 seconds = 2024-10-04 00:00:00 UTC
    // In Manila (UTC+8): 2024-10-04 08:00:00
    const { date, time } = formatCameraDateTime(1728000000);
    expect(date).toBe('October 04, 2024');
    expect(time).toBe('08:00:00');
  });
});
