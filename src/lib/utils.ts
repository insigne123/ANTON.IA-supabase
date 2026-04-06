import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateInitialOutreach(args: {
  leadName?: string;
  leadTitle?: string;
  companyName?: string;
  vacancySnippet?: string;
  myCompanyProfile?: any;
}) {
  const { leadName, leadTitle, companyName, vacancySnippet, myCompanyProfile } = args;
  const firstName = leadName?.split(' ')[0] || 'Hola';
  const intro = `Hola ${firstName},`;

  const me = myCompanyProfile?.name
    ? `Soy parte de ${myCompanyProfile.name}${myCompanyProfile.industry ? ` (${myCompanyProfile.industry})` : ''}.`
    : `Trabajo en soluciones de automatización y apoyo en procesos de selección.`;

  const hook = leadTitle
    ? `Vi que tu rol como ${leadTitle} puede beneficiarse de nuevas herramientas.`
    : `Pensé que podríamos aportar valor a tu trabajo.`;

  const ref = vacancySnippet
    ? `Estuve revisando una vacante relacionada y me llamó la atención: “${truncate(vacancySnippet, 160)}”.`
    : '';

  const value =
    myCompanyProfile?.valueProposition ||
    'Reducimos tiempos de gestión y mejoramos resultados con apoyo de IA.';

  // Asunto enfocado en el lead, no en la empresa
  const subject = `${firstName}, una propuesta para ti`;

  const body = [
    intro,
    '',
    me,
    hook,
    ref,
    '',
    `Propuesta: ${value}`,
    '',
    '¿Te parece si coordinamos 15 min esta semana para mostrarte cómo trabajamos y casos recientes?',
    '',
    'Saludos,',
    myCompanyProfile?.name || 'Equipo de Automatización',
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, body };
}

function truncate(s?: string, n=160) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
