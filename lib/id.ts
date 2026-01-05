// Utility to generate unique IDs without relying on external modules
// Works on web and native; uses crypto.getRandomValues when available.

export function generateId(prefix?: string): string {
  const bytes = new Uint8Array(16);
  // Use globalThis.crypto.getRandomValues if available; otherwise fallback to Math.random
  const cryptoObj: any = (typeof globalThis !== 'undefined' && (globalThis as any).crypto) ? (globalThis as any).crypto : null;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // Set version and variant bits to mimic UUID v4 formatting
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const uuidLike = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

  return prefix ? `${prefix}_${uuidLike}` : uuidLike;
}