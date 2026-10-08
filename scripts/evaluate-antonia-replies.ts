// Prueba las respuestas a clientes que ya contestaron (generateAntoniaReply) con lo que la app le pasa: la oferta del vendedor
// (Perfil), el correo enviado y la respuesta del cliente. Seis casos: tres objeciones, un precio, un servicio y una reunión.
// Uso: node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-antonia-replies.ts [--repeat=2] [--output=respuestas.json]
// Requiere OPENAI_API_KEY. Usa el modelo de OPENAI_MODEL (gpt-6-luna por defecto). Sin escrituras, sin envíos.
import { writeFileSync } from 'node:fs';
import { generateAntoniaReply } from '../src/ai/flows/generate-antonia-reply';

if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY required');
const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const repeat = Math.max(1, Number(arg('repeat') || 1));

const sender = { name: 'Carla Muñoz', company: 'ServiPro', title: 'Ejecutiva comercial' };
const sellerOffer = {
  description: 'Empresa de outsourcing y servicios transitorios en Chile.',
  services: ['Dotación de personal temporal', 'Reemplazo de turnos el mismo día', 'Administración laboral (contratos, anexos y finiquitos)'],
  valueProposition: 'Ponemos la dotación que necesitas por el tiempo que la necesitas, y el costo se va con el peak.',
  proofPoints: [] as string[],
};

const cases = [
  {
    id: 'objecion-proveedor', intent: 'neutral',
    lead: { name: 'Felipe', email: 'felipe@cdpudahuel.cl', company: 'CD Pudahuel', title: 'Jefe de Centro de Distribución' },
    research: 'CD Pudahuel es un centro de distribución en Santiago que opera turnos noche de domingo a jueves.',
    sent: { subject: 'turnos de noche en CD Pudahuel', text: 'Hola Felipe,\n\nVi que en CD Pudahuel operan turnos de noche de domingo a jueves. En ServiPro reemplazamos turnos el mismo día cuando alguien falta, y ponemos dotación temporal por el tiempo que se necesita.\n\n¿Te parece si lo conversamos 15 minutos esta semana?' },
    reply: 'Gracias, pero ya trabajamos con otra empresa de personal y estamos conformes.',
  },
  {
    id: 'objecion-presupuesto', intent: 'neutral',
    lead: { name: 'Marcela', email: 'marcela@packingsantarosa.cl', company: 'Packing Santa Rosa', title: 'Gerenta Agrícola' },
    research: 'Packing Santa Rosa procesa cerezas en la Sexta Región; su temporada alta va de noviembre a enero.',
    sent: { subject: 'dotación para la temporada de cerezas', text: 'Hola Marcela,\n\nPara la temporada de cerezas de Packing Santa Rosa, en ServiPro ponemos la dotación que necesitan por el tiempo que la necesitan, y el costo se va con el peak.\n\n¿Te parece si lo conversamos 15 minutos esta semana?' },
    reply: 'No tenemos presupuesto para esto este año.',
  },
  {
    id: 'objecion-info', intent: 'neutral',
    lead: { name: 'Daniela', email: 'daniela@parquesur.cl', company: 'Edificios Parque Sur', title: 'Administradora' },
    research: 'Edificios Parque Sur administra 8 edificios residenciales y 2 centros comerciales en Santiago.',
    sent: { subject: 'conserjería en Parque Sur', text: 'Hola Daniela,\n\nCon 8 edificios y 2 centros comerciales a cargo, en ServiPro reemplazamos el mismo día un turno de conserjería o aseo cuando alguien falta.\n\n¿Te parece si lo conversamos 15 minutos esta semana?' },
    reply: 'Mándame información de sus servicios por correo.',
  },
  {
    id: 'pregunta-precio', intent: 'positive',
    lead: { name: 'Rodrigo', email: 'rodrigo@tiendasejemplo.cl', company: 'Tiendas Ejemplo', title: 'Gerente de Operaciones' },
    research: 'Tiendas Ejemplo es una cadena de retail con 40 tiendas en la zona sur; abrirá dos tiendas nuevas antes de diciembre.',
    sent: { subject: 'dotación para las tiendas nuevas', text: 'Hola Rodrigo,\n\nVi que Tiendas Ejemplo abrirá dos tiendas nuevas en la zona sur antes de diciembre. En ServiPro ponemos personal temporal para el período de apertura, y el costo se va cuando termina.\n\n¿Te parece si lo conversamos 15 minutos esta semana?' },
    reply: '¿Cuánto cobran por persona? Necesitaríamos unas 10 personas para noviembre.',
  },
  {
    id: 'pregunta-servicio', intent: 'positive',
    lead: { name: 'Carolina', email: 'carolina@pehuen.cl', company: 'Constructora Pehuén', title: 'Jefa de Recursos Humanos' },
    research: 'Constructora Pehuén contratará trabajadores para dos obras nuevas en el Biobío.',
    sent: { subject: 'personal para las obras del Biobío', text: 'Hola Carolina,\n\nPara las obras nuevas de Constructora Pehuén en el Biobío, en ServiPro ponemos personal temporal por el tiempo que dure cada etapa y nos encargamos de sus contratos.\n\n¿Te parece si lo conversamos 15 minutos esta semana?' },
    reply: '¿Ustedes también hacen los finiquitos cuando termina la obra?',
  },
  {
    id: 'reunion', intent: 'meeting_request',
    lead: { name: 'Paula', email: 'paula@mineracascada.cl', company: 'Minera Cascada', title: 'Jefa de Recursos Humanos' },
    research: 'Minera Cascada opera una faena con más de 2.000 trabajadores entre propios y contratistas.',
    sent: { subject: 'dotación temporal en Minera Cascada', text: 'Hola Paula,\n\nEn la faena de Minera Cascada, en ServiPro reemplazamos turnos el mismo día cuando alguien falta y ponemos dotación temporal por el tiempo que se necesita.\n\n¿Le parece si lo conversamos 15 minutos esta semana?' },
    reply: 'Me interesa. ¿Podemos hablar el jueves en la tarde?',
  },
];

const results: unknown[] = [];
for (let round = 1; round <= repeat; round += 1) {
  for (const c of cases) {
    const out = await generateAntoniaReply({
      decisionReason: 'reply autopilot desactivado; generar borrador solamente',
      desiredAction: 'draft',
      lead: c.lead,
      sender,
      organizationContext: { bookingLink: '', meetingInstructions: '', missionGoal: 'Agendar llamadas de descubrimiento', valueProposition: sellerOffer.valueProposition },
      lastInbound: { subject: `Re: ${c.sent.subject}`, text: c.reply, intent: c.intent, summary: '' },
      conversationSummary: [{ role: 'outbound', subject: c.sent.subject, text: c.sent.text }, { role: 'inbound', text: c.reply }],
      researchSummary: c.research,
      assets: [],
      sellerOffer,
    });
    const words = (out.bodyText.match(/[\p{L}\p{N}]+/gu) || []).length;
    results.push({ id: c.id, round, reply: c.reply, subject: out.subject, body: out.bodyText, words });
    console.log(`\n===== ${c.id} #${round} (${words} palabras) =====\nCliente: ${c.reply}\nAsunto: ${out.subject}\n\n${out.bodyText}\n`);
  }
}
const output = arg('output');
if (output) writeFileSync(output, JSON.stringify({ results }, null, 2));
