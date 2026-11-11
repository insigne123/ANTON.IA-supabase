'use client';

import { useEffect } from 'react';

import { setShellTitle } from '@/lib/shell-title';

/** Names the browser tab after the page («Conversaciones · ANTON.IA»), for pages that render on the client. */
export function DocumentTitle({ title }: { title: string }) {
  useEffect(() => {
    document.title = title ? `${title} · ANTON.IA` : 'ANTON.IA';
  }, [title]);
  return null;
}

/** Gives the page's title to the phone's top bar while the page is open. */
export function ShellTitle({ title }: { title: string }) {
  useEffect(() => {
    setShellTitle(title || null);
    return () => setShellTitle(null);
  }, [title]);
  return null;
}
