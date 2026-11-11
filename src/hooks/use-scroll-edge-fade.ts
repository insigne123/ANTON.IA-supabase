'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

/**
 * A row that scrolls sideways fades at the edge where more of it waits, so a person on a phone sees that it continues
 * (review of 10 Nov 2026, V5: tabs and stage cards were cut at the screen's edge with no sign of more).
 * Returns a callback ref for the row and the style to put on it; nothing changes while everything fits.
 */
export function useScrollEdgeFade<T extends HTMLElement>(): [(node: T | null) => void, CSSProperties | undefined] {
  const node = useRef<T | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const row = node.current;
    if (!row) return;
    const left = row.scrollLeft > 4;
    const right = row.scrollWidth - row.clientWidth - row.scrollLeft > 4;
    setEdges(previous => (previous.left === left && previous.right === right ? previous : { left, right }));
  }, []);
  const ref = useCallback((element: T | null) => { node.current = element; measure(); }, [measure]);
  useEffect(() => {
    const row = node.current;
    if (!row) return;
    measure();
    row.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(row);
    for (const child of Array.from(row.children)) observer?.observe(child);
    return () => { row.removeEventListener('scroll', measure); observer?.disconnect(); };
  }, [measure]);
  if (!edges.left && !edges.right) return [ref, undefined];
  const mask = `linear-gradient(to right, ${edges.left ? 'transparent, #000 28px' : '#000 0'}, ${edges.right ? '#000 calc(100% - 28px), transparent' : '#000 100%'})`;
  return [ref, { maskImage: mask, WebkitMaskImage: mask }];
}
