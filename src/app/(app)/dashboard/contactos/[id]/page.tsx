import { LeadDropFlow } from '@/components/lead-drops/LeadDropFlow';

/**
 * «Tus contactos de hoy», a screen of «Hoy» (16 Nov 2026, the owner: «que sea una subsección de Hoy, para que todo conviva en la
 * misma app»): the contacts of one drop. The buttons of its emails and «Hoy» open it (src/lib/lead-drops.ts, dropHref).
 */
export default async function LeadDropPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Keyed by the drop: going from one that is not there to today's starts the flow again.
  return <LeadDropFlow key={id} dropId={id} />;
}
