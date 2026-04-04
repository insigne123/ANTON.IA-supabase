// src/lib/outreach-templates.ts
// Plantilla V2 (estilo "empresa/ustedes") similar a tu ejemplo.

export function generateCompanyOutreachV2(args: {
  leadFirstName?: string;
  companyName?: string;
  myCompanyProfile?: {
    name?: string;
    industry?: string;
  };
}) {
  const { leadFirstName = '', companyName, myCompanyProfile } = args;

  // Asunto base (solo texto; el prefijo con el nombre lo haremos fuera)
  const subjectBase = 'Optimice sus procesos con IA';

  // Cuerpo con saludo al lead pero tono "ustedes/empresa"
  const body = [
    `Hola ${leadFirstName || ''},`,
    '',
    `Me dirijo a ustedes para presentarles ${myCompanyProfile?.name || '{{sender.company}}'}, una empresa especializada en la automatización de procesos empresariales mediante inteligencia artificial.${myCompanyProfile?.industry ? ` En el sector de ${myCompanyProfile.industry}, la eficiencia operativa y la integración tecnológica son clave para el éxito.` : ''}`,
    '',
    `${myCompanyProfile?.name || '{{sender.company}}'} ofrece soluciones personalizadas que se integran con su stack tecnológico actual, incluyendo Microsoft 365, Google Workspace, CRM/ERP, WhatsApp/Telegram, bases de datos y APIs. Nuestros servicios incluyen:`,
    '',
    '- Automatización de procesos críticos con IA para mejorar la eficiencia operativa.',
    '- Desarrollo de aplicaciones a medida que se integran con sus sistemas existentes.',
    '- Implementación de asistentes virtuales personalizados para soporte interno y atención de consultas de clientes.',
    '',
    'Nos gustaría agendar una breve llamada para explorar cómo podemos colaborar y aportar valor a sus proyectos. ¿Qué día y hora le convendría?',
    '',
    'Quedo atento a su respuesta.',
    '',
    'Saludos cordiales,',
    '',
    // Estos placeholders se rellenan con applySignaturePlaceholders
    '{{sender.name}}',
    '{{sender.title}}',
    '{{sender.company}}',
    '',
    '{{sender.email}}'
  ].join('\n');

  return { subjectBase, body };
}

/** Asegura que el asunto comience con el firstName si está disponible. */
export function ensureSubjectPrefix(subject: string, firstName?: string) {
  const fn = (firstName || '').trim();
  if (!fn) return subject.trim();
  const startsWithName = new RegExp(`^${fn}\\b`, 'i').test((subject || '').trim());
  return startsWithName ? subject.trim() : `${fn}, ${subject.trim()}`;
}
