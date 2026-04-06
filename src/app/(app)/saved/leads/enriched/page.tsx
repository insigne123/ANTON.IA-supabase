
// src/app/(app)/saved/leads/enriched/page.tsx
import NextDynamic from 'next/dynamic'; // 👈 alias para no chocar con el export segment config

/** Evita cualquier intento de SSG/ISR o prerender en build (solo en la página, NO en el client) */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
// Opcional: fuerza runtime node
export const runtime = 'nodejs';

// Import dinámico del client, sin SSR
const EnrichedLeadsClient = NextDynamic(
  () => import('@/app/(app)/saved/leads/enriched/Client')
);

export default function EnrichedLeadsPage() {
  return <EnrichedLeadsClient />;
}
