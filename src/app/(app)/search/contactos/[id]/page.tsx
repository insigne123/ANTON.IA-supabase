import { LeadDropFlow } from '@/components/lead-drops/LeadDropFlow';

/** «Contacto del día»: the link of the morning email, or «Hoy», opens «Buscar prospectos» in this mode (src/lib/lead-drops.ts). */
export default async function LeadDropPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Keyed by the drop: going from one that is not there to today's starts the flow again.
  return <LeadDropFlow key={id} dropId={id} />;
}
