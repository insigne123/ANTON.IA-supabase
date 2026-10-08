import type { CoworkIconKey } from './presentation';

/**
 * «¿Qué puedes hacer?» (Plan 5, PR-7): everything Cowork does, in groups, each with examples ready to try. In the test of
 * 1 oct the answer was three points; a person new to the app needs the whole map and a way to start. Pure: the guide card,
 * its tests and the instructions share it. Each group points to its page in the help center (src/lib/help/manual.ts).
 */
export type CoworkGuideExample = { label: string; message: string };
export type CoworkGuideGroup = {
  id: string;
  icon: CoworkIconKey;
  title: string;
  /** What Cowork does in this group, in one sentence; what needs your approval says so. */
  summary: string;
  examples: CoworkGuideExample[];
  /** Section of the help center (src/lib/help/manual.ts). */
  helpSection: string;
};

export const COWORK_GUIDE: CoworkGuideGroup[] = [
  {
    id: 'buscar', icon: 'search', title: 'Buscar prospectos', helpSection: 'buscar',
    summary: 'Busca empresas afines a lo que vendes y, dentro de ellas, a quienes deciden. La búsqueda no gasta créditos de correo y te la muestro antes de hacerla.',
    examples: [
      { label: 'Gerentes de personas en retail', message: 'Busca 25 gerentes de personas en empresas de retail en Chile que encajen con lo que vendo.' },
      { label: 'Quienes deciden en mi rubro ideal', message: 'Busca quién decide la compra de lo que vendo en empresas medianas de mi rubro ideal.' },
    ],
  },
  {
    id: 'contactos', icon: 'contacts', title: 'Tus contactos', helpSection: 'por-completar',
    summary: 'Guardo personas, busco su correo (1 crédito cada uno) y te digo quiénes están listos para escribirles. Guardar o buscar correos va con tu aprobación.',
    examples: [
      { label: 'Revisa mis leads', message: 'Revisa mis leads: cuántos tienen correo, cuántos ya contacté y qué me conviene hacer con cada grupo.' },
      { label: '¿Cuántos tengo de un cargo?', message: '¿Cuántos contactos de recursos humanos tengo guardados y cuántos tienen correo?' },
    ],
  },
  {
    id: 'investigar', icon: 'research', title: 'Investigar', helpSection: 'por-escribir',
    summary: 'Investigo a una persona y su empresa antes de escribirle: qué hace, señales recientes con su fuente y qué decirle. Te aviso aquí cuando termina.',
    examples: [
      { label: 'Prepara a mis próximos contactos', message: 'Prepara a mis contactos con correo que aún no investigo para escribirles: investígalos y avísame cuando termines.' },
      { label: '¿Qué sabemos de una empresa?', message: '¿Qué sabemos de la empresa de mi último contacto guardado y por dónde conviene entrar?' },
    ],
  },
  {
    id: 'correos', icon: 'mail', title: 'Correos y campañas', helpSection: 'campanas',
    summary: 'Escribo correos y secuencias con tu oferta, y armo campañas con un correo para cada persona. La campaña queda guardada sin enviar hasta que la actives.',
    examples: [
      { label: 'Escribir a mis contactos', message: 'Prepara un correo sobre lo que vendo para mis contactos guardados que tienen correo y todavía no reciben nada. Muéstrame el correo y a quiénes iría.' },
      { label: 'Secuencia de 3 correos', message: 'Armame una secuencia de 3 correos, tono cercano, para ofrecer lo que vendo a gerentes de personas.' },
    ],
  },
  {
    id: 'linkedin', icon: 'linkedin', title: 'LinkedIn', helpSection: 'por-escribir',
    summary: 'Preparo invitaciones y mensajes para tus contactos con perfil de LinkedIn; los envía tu extensión del navegador después de que los apruebes.',
    examples: [
      { label: '¿A quién invito esta semana?', message: '¿A quién de mis contactos guardados con perfil de LinkedIn debería invitar esta semana? Revisa mi cupo de invitaciones.' },
    ],
  },
  {
    id: 'seguimiento', icon: 'reply', title: 'Seguimiento', helpSection: 'conversaciones',
    summary: 'Te digo quién respondió, a quién le toca un seguimiento y te propongo la respuesta en el mismo hilo.',
    examples: [
      { label: '¿Qué toca hoy?', message: '¿Qué toca hoy?' },
      { label: '¿Quién me respondió?', message: '¿Quién me respondió esta semana y qué me conviene contestarle?' },
    ],
  },
  {
    id: 'informes', icon: 'chart', title: 'Cifras e informes', helpSection: 'hoy',
    summary: 'Te muestro cómo van tus envíos y campañas, con cifras y gráficos que puedes bajar en Excel o CSV, e informes en Word o PDF.',
    examples: [
      { label: '¿Cómo voy?', message: '¿Cómo me ha ido esta semana con mis correos y campañas? Dame los números y qué conviene mejorar.' },
      { label: 'Informe para mi jefe', message: 'Hazme un informe de mis últimos 30 días de prospección para mostrárselo a mi jefe.' },
    ],
  },
];

/** The guide as the model reads it, for when the person asks with their own words: one line per group with an example. */
export function coworkGuideForModel(): string {
  return COWORK_GUIDE.map(group => `${group.title}: ${group.summary} (por ejemplo, «${group.examples[0].label}»)`).join(' · ');
}
