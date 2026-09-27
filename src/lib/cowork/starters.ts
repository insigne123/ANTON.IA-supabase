import type { CoworkIconKey } from './presentation';

/** Starting points on the Cowork home, one per task a new user comes for:
 * email, LinkedIn, prospects and results. Each prompt is also a corpus case
 * (scripts/fixtures/cowork-marketing-corpus.ts), so every button is checked
 * against the real loop. A [placeholder] is selected in the composer for the
 * person to replace before sending. */
export type CoworkStarter = { id: string; icon: CoworkIconKey; title: string; prompt: string };

export const COWORK_STARTERS: CoworkStarter[] = [
  { id: 'escribir', icon: 'send', title: 'Escribir a mis contactos',
    prompt: 'Prepara un correo sobre lo que vendo para mis contactos guardados que tienen correo y todavía no reciben nada. Muéstrame el correo y a quiénes iría.' },
  { id: 'a-quien', icon: 'target', title: '¿A quién le escribo hoy?',
    prompt: '¿A quién le escribo hoy? Prioriza a mis contactos con correo que aún no contacto y los seguimientos sin respuesta.' },
  { id: 'linkedin', icon: 'linkedin', title: 'Invitar por LinkedIn',
    prompt: '¿A quién de mis contactos guardados con perfil de LinkedIn debería invitar esta semana? Revisa mi cupo de invitaciones.' },
  { id: 'mejorar', icon: 'pen', title: 'Mejorar un correo',
    prompt: 'Mejora este correo para que sea más claro y fácil de responder: [pega aquí tu correo]' },
  { id: 'prospectos', icon: 'search', title: 'Buscar prospectos nuevos',
    prompt: 'Busca 10 prospectos nuevos en Chile que encajen con lo que vendo.' },
  { id: 'como-voy', icon: 'chart', title: '¿Cómo voy?',
    prompt: '¿Cómo me ha ido esta semana con mis correos y campañas? Dame los números y qué conviene mejorar.' },
];

export function coworkStarter(id: string): CoworkStarter {
  const starter = COWORK_STARTERS.find(item => item.id === id);
  if (!starter) throw new Error(`Unknown Cowork starter: ${id}`);
  return starter;
}
