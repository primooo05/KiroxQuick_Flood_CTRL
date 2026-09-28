/**
 * App shell for BahaRoute — Milestone 1.
 *
 * Responsibilities (design → Architecture, "Missing-key handling"):
 * - Load the runtime config (Tile_Provider API key) via loadConfig().
 * - If the key is absent, render the shell WITHOUT mounting MapView and show a
 *   config-incomplete message; NO tile request is made (Req 17.4).
 * - If the key is present, render MapView wrapped in an ErrorBoundary so a
 *   render error shows a message instead of a blank crash (Req 1.4).
 *
 * The config and its loader are injectable props so the shell can be tested
 * without stubbing the global env; defaults preserve production behavior.
 *
 * When the key is absent the shell renders the ConfigIncomplete overlay
 * component (Task 15.2) — the missing-key behavior is unchanged: the shell
 * renders, no tiles are requested, and nothing crashes (Req 17.4).
 */
import { MapView } from './components/MapView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ConfigIncomplete } from './components/overlays/ConfigIncomplete';
import { loadConfig as defaultLoadConfig } from './services/env';
import type { AppConfig } from './types/config';
import type { MapViewProps } from './components/MapView';

export interface AppProps {
  /** Pre-resolved config. When provided, `loadConfig` is not called. */
  config?: AppConfig;
  /** Config loader override for testing. Defaults to the env-based loader. */
  loadConfig?: () => AppConfig;
  /**
   * Props forwarded to MapView (e.g. an injected MapManager/mapFactory seam for
   * tests). Ignored when the config has no tile key.
   */
  mapViewProps?: Pick<MapViewProps, 'createMapManager' | 'mapFactory' | 'onReady' | 'onTileFailure'>;
}

export default function App({
  config,
  loadConfig = defaultLoadConfig,
  mapViewProps,
}: AppProps = {}) {
  const resolvedConfig = config ?? loadConfig();

  return (
    <main className="baharoute-app">
      {/* Enhancement: restrained floating brand pill instead of a full-width
          header, so the map fills the screen (navigation spec Req 3). */}
      <header className="baharoute-header baharoute-brand">
        <h1 className="baharoute-brand__name">BahaRoute</h1>
        <span className="baharoute-brand__scope">Metro Manila</span>
      </header>

      {resolvedConfig.hasTileKey ? (
        <ErrorBoundary>
          <MapView config={resolvedConfig} {...mapViewProps} />
        </ErrorBoundary>
      ) : (
        <ConfigIncomplete />
      )}
    </main>
  );
}
