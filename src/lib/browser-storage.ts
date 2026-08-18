export function getBrowserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;

  try {
    const storage = window.localStorage;
    if (!storage) return null;
    if (typeof storage.getItem !== 'function') return null;
    if (typeof storage.setItem !== 'function') return null;
    if (typeof storage.removeItem !== 'function') return null;
    return storage;
  } catch {
    return null;
  }
}
