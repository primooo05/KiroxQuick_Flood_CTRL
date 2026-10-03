/** Provider-neutral public traffic-camera metadata. Times are epoch seconds. */
export type CameraMediaKind = 'image' | 'video';
export type CameraStatus = 'active' | 'inactive';

export interface TrafficCamera {
  /** Stable ID assigned by the source. */
  readonly sourceId: string;
  readonly source: string;
  readonly name: string;
  /** WGS84 coordinates in [longitude, latitude] order. */
  readonly coordinates: readonly [longitude: number, latitude: number];
  readonly mediaKind: CameraMediaKind;
  /** Provider-reported availability, when supplied. */
  readonly status?: CameraStatus;
  /** Direct media URL authorized by the source for embedding/use. */
  readonly mediaUrl: string;
  /** Provider page or player page the media must link to. */
  readonly detailUrl?: string;
  /** Source capture/update time, when supplied. */
  readonly observedAt?: number;
  /** Optional provider-recommended still-image refresh interval in seconds. */
  readonly refreshIntervalSeconds?: number;
  /** Attribution/license information required by the source. */
  readonly attribution?: string;
  /** Original city/road label retained for display and diagnostics. */
  readonly areaLabel?: string;
}

export interface MetroManilaTrafficCamera extends TrafficCamera {
  /** Resolved NCR city based on local administrative boundary geometry. */
  readonly city: { readonly id: string; readonly name: string };
}

export interface CameraSnapshot {
  readonly cameras: readonly TrafficCamera[];
  readonly fetchedAt: number;
}
