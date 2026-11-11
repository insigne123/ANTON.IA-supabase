import { useSyncExternalStore } from 'react';

// The name the phone's top bar shows for the page that is open. A page with a header says its own («Tu semana», not the «Hoy» of
// the menu entry it lives under), and then does not repeat it as a title below the bar (review of 10 Nov 2026, V5).
let current: string | null = null;
const listeners = new Set<() => void>();

export function setShellTitle(title: string | null) {
  if (current === title) return;
  current = title;
  listeners.forEach(listener => listener());
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** The title the open page gave, or null when it gave none (the bar then names the menu entry). */
export function useShellTitle(): string | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
