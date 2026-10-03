'use client';

import { useEffect } from 'react';

/** Names the browser tab after the page («Conversaciones · ANTON.IA»), for pages that render on the client. */
export function DocumentTitle({ title }: { title: string }) {
  useEffect(() => {
    document.title = title ? `${title} · ANTON.IA` : 'ANTON.IA';
  }, [title]);
  return null;
}
