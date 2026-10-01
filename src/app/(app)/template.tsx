'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Each screen arrives with a short fade and a 4 px rise (docs/ui-ux/motion.md, «¿Qué apareció?»). Next.js remounts a
 * template on every navigation, so only the new screen animates; with «reducir movimiento» it simply appears.
 * Cowork keeps its own motion system and full-height layout.
 */
export default function AppTemplate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith('/cowork')) return <>{children}</>;
  return (
    <div className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-300 motion-safe:ease-out">
      {children}
    </div>
  );
}
