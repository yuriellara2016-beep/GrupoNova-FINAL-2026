// ... existing code ...
// new file: lib/date.ts

/**
 * Centralized date utilities.
 * - Internal storage uses ISO date strings (YYYY-MM-DD) where appropriate.
 * - Display format throughout the app should be DD/MM/YYYY.
 */

export function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

// Convert a Date to YYYY-MM-DD (ISO date without time)
export function dateToIso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Parse an ISO date (YYYY-MM-DD or full ISO) to a Date
export function isoToDate(iso: string): Date {
  // If passed a full ISO with time, Date constructor handles it. For YYYY-MM-DD, append T00:00:00 to ensure local date parsing consistency.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return new Date(`${iso}T00:00:00`);
  return new Date(iso);
}

// Format an ISO date (YYYY-MM-DD or full ISO) to display DD/MM/YYYY
export function isoToDisplay(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = isoToDate(iso);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  } catch (e) {
    return '';
  }
}

// Format a Date object to display DD/MM/YYYY
export function dateToDisplay(date: Date): string {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

// Parse display string DD/MM/YYYY to ISO YYYY-MM-DD
export function displayToIso(display: string): string | null {
  const m = display.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const day = pad(Number(m[1]));
  const month = pad(Number(m[2]));
  const year = m[3];
  return `${year}-${month}-${day}`;
}

// Return today's date in ISO (YYYY-MM-DD)
export function todayIso(date?: Date | string): string {
  if (!date) return dateToIso(new Date());
  if (typeof date === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    // try parse as display
    const iso = displayToIso(date);
    if (iso) return iso;
    return dateToIso(new Date(date));
  }
  return dateToIso(date);
}

// Exported for convenience: format ISO to locale display
export const formatIsoForDisplay = isoToDisplay;