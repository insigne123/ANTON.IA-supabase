type StorageShim = {
  readonly length: number;
  clear: () => void;
  getItem: (key: string) => string | null;
  key: (index: number) => string | null;
  removeItem: (key: string) => void;
  setItem: (key: string, value: string) => void;
};

function createStorageShim(): StorageShim {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      const normalizedKey = String(key);
      return store.has(normalizedKey) ? store.get(normalizedKey)! : null;
    },
    key(index: number) {
      const keys = Array.from(store.keys());
      return typeof keys[index] === 'string' ? keys[index] : null;
    },
    removeItem(key: string) {
      store.delete(String(key));
    },
    setItem(key: string, value: string) {
      store.set(String(key), String(value));
    },
  };
}

function ensureServerStorage(name: 'localStorage' | 'sessionStorage') {
  if (typeof window !== 'undefined') return;

  const current = (globalThis as any)[name];
  if (current && typeof current.getItem === 'function' && typeof current.setItem === 'function') {
    return;
  }

  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: false,
    writable: true,
    value: createStorageShim(),
  });
}

export async function register() {
  ensureServerStorage('localStorage');
  ensureServerStorage('sessionStorage');
}
