'use client';

import { useEffect } from 'react';

/** Native unload, document links and history traversal. Explicit router actions still need a guard. */
export function useComposeUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    const message = 'Hay cambios o propuestas sin guardar. ¿Salir y descartarlos?';
    let leaving = false;
    let leavingTimer: ReturnType<typeof setTimeout> | undefined;
    let restoring = false;
    const unload = (event: BeforeUnloadEvent) => { if (dirty && !leaving) { event.preventDefault(); event.returnValue = ''; } };
    const click = (event: MouseEvent) => {
      if (!dirty || event.defaultPrevented || event.button !== 0) return;
      const anchor = (event.target as Element)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download') || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const target = new URL(anchor.href);
      if (!['http:', 'https:'].includes(target.protocol)) return;
      if (target.origin === window.location.origin && target.pathname === window.location.pathname && target.search === window.location.search) return;
      if (!window.confirm(message)) { event.preventDefault(); event.stopPropagation(); }
      else {
        leaving = true;
        // A router or another listener can cancel an accepted link navigation.
        clearTimeout(leavingTimer);
        leavingTimer = setTimeout(() => { leaving = false; }, 0);
      }
    };
    // A same-URL entry lets Back be cancelled without unmounting the editor.
    const url = window.location.href;
    if (dirty && window.history.state?.composeUnsavedGuard !== url) {
      window.history.replaceState({ ...window.history.state, composeUnsavedBase: url }, '', url);
      window.history.pushState({ ...window.history.state, composeUnsavedGuard: url }, '', url);
    }
    const guardState = window.history.state;
    const pop = (event: PopStateEvent) => {
      if (restoring) { restoring = false; event.stopImmediatePropagation(); return; }
      const isBase = window.location.href === url && event.state?.composeUnsavedBase === url && event.state?.composeUnsavedGuard !== url;
      if (!dirty && !isBase) return;
      if (!dirty || window.confirm(message)) {
        leaving = true;
        window.removeEventListener('popstate', pop, true);
        if (isBase) { event.stopImmediatePropagation(); window.history.back(); }
        // Forward / multi-entry traversal already reached its destination: do not skip another page.
      } else {
        event.stopImmediatePropagation();
        if (isBase) { restoring = true; window.history.forward(); }
        else window.history.pushState({ ...guardState, composeUnsavedGuard: url }, '', url);
      }
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    window.addEventListener('popstate', pop, true);
    return () => {
      clearTimeout(leavingTimer);
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', click, true);
      window.removeEventListener('popstate', pop, true);
    };
  }, [dirty]);
}
