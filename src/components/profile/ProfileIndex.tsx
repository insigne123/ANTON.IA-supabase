'use client';

import { useEffect, useState } from 'react';

import { chipClass } from '@/components/ui/chip';

/** The parts of «Perfil», in the order of the page, by the id of their heading. */
export const PROFILE_INDEX = [
  { id: 'identity-heading', label: 'Tú' },
  { id: 'company-heading', label: 'Tu empresa' },
  { id: 'offer-heading', label: 'Tu oferta' },
  { id: 'icp-heading', label: 'Tu cliente ideal' },
  { id: 'security-heading', label: 'Seguridad' },
] as const;

/**
 * The index of «Perfil» (APP-07): a page of some 3.200 px with five parts and no way to see where one is. A row that stays under
 * the top bar names them, marks the one on screen and jumps to each. Nothing is hidden, so the links to /profile#icp-heading and the
 * screen guide keep working.
 */
export function ProfileIndex() {
  const [current, setCurrent] = useState<string>(PROFILE_INDEX[0].id);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) visible.add(entry.target.id); else visible.delete(entry.target.id);
      const first = PROFILE_INDEX.find(item => visible.has(item.id));
      if (first) setCurrent(first.id);
    }, { rootMargin: '-110px 0px -55% 0px' });
    for (const item of PROFILE_INDEX) { const node = document.getElementById(item.id); if (node) observer.observe(node); }
    return () => observer.disconnect();
  }, []);
  return <nav aria-label="Partes del perfil" className="sticky top-12 z-[5] -mx-1 mb-4 flex gap-1.5 overflow-x-auto bg-background/85 px-1 py-2 backdrop-blur-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    {PROFILE_INDEX.map(item => <a key={item.id} href={`#${item.id}`} aria-current={current === item.id ? 'location' : undefined} className={chipClass(current === item.id, 'sm')}
      onClick={() => setCurrent(item.id)}>{item.label}</a>)}
  </nav>;
}
