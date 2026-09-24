// Prueba el flujo de respuestas a objeciones (generateAntoniaReply) con casos reales.
// Uso: node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-antonia-replies.ts
// Requiere OPENAI_API_KEY. Sin escrituras, sin envíos.
import { generateAntoniaReply } from '../src/ai/flows/generate-antonia-reply';

if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required');

const sender = { name: 'Carla Muñoz', company: 'ServiPro', title: 'Ejecutiva comercial' };
const org = {
  bookingLink: '',
  meetingInstructions: '',
  missionGoal: 'Agendar llamadas de descubrimiento',
  valueProposition: 'Ponemos la dotación que necesitas por el tiempo que la necesitas.',
};
const cases = [
  {
    id: 'objecion-proveedor',
    lead: { name: 'Felipe', email: 'felipe@cdpudahuel.cl', company: 'CD Pudahuel', title: 'Jefe de Centro de Distribución' },
    lastInbound: { subject: 'Re: dotación para turnos de noche', text: 'Gracias, pero ya trabajamos con otra empresa de personal y estamos conformes.', intent: 'neutral' },
  },
  {
    id: 'objecion-presupuesto',
    lead: { name: 'Marcela', email: 'marcela@packingsantarosa.cl', company: 'Packing Santa Rosa', title: 'Gerenta Agrícola' },
    lastInbound: { subject: 'Re: dotación temporal para cerezas', text: 'No tenemos presupuesto para esto este año.', intent: 'neutral' },
  },
  {
    id: 'objecion-info',
    lead: { name: 'Daniela', email: 'daniela@parquesur.cl', company: 'Edificios Parque Sur', title: 'Administradora' },
    lastInbound: { subject: 'Re: dotación temporal en Parque Sur', text: 'Mándame información de sus servicios por correo.', intent: 'neutral' },
  },
];

for (const c of cases) {
  const out = await generateAntoniaReply({
    decisionReason: 'El lead respondió con una objeción blanda; avanzar sin presionar.',
    desiredAction: 'draft',
    lead: c.lead,
    sender,
    organizationContext: org,
    lastInbound: c.lastInbound,
    conversationSummary: [{ role: 'outbound', subject: 'dotación temporal', text: 'Correo inicial de prospección.' }],
    researchSummary: `${c.lead.company}: ${c.lead.title}. Sin señales adicionales.`,
    assets: [],
  });
  const words = (out.bodyText.match(/[\p{L}\p{N}]+/gu) || []).length;
  console.log(`\n===== ${c.id} (${words} palabras) =====\nAsunto: ${out.subject}\n\n${out.bodyText}\n`);
}
