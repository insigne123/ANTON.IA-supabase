import { LeadDropFlow } from '@/components/lead-drops/LeadDropFlow';

/** «Contactos de la semana»: the link of the morning email opens «Buscar prospectos» in this mode (src/lib/lead-drops.ts). */
export default async function LeadDropPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LeadDropFlow dropId={id} />;
}
