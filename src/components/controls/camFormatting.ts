// src/components/controls/camFormatting.ts

/** Formats epoch seconds (or current time) to MonthName DD, YYYY and HH:MM:SS in Asia/Manila. */
export function formatCameraDateTime(observedAt?: number): { date: string; time: string } {
  const d =
    observedAt !== undefined && Number.isFinite(observedAt)
      ? new Date(observedAt * 1000)
      : new Date();
  const date = d.toLocaleDateString('en-US', {
    month: 'long',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  });
  const time = d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Manila',
  });
  return { date, time };
}
