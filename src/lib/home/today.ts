/**
 * «Hoy»: what a person should do next, from what is really there (docs/inicio-hoy.md). Production showed why the home needed it:
 * in the main organization 1 of 28 people had a mailbox connected, 3 had told the app what they sell, and nobody had ever sent
 * an email, while 94 contacts with an email waited. A home with four zeros and generic links did not say any of that.
 * Pure: the route reads, this decides.
 */

export type TodaySetupStepId = 'profile' | 'mail' | 'contacts' | 'first_send';

export type TodaySetupStep = { id: TodaySetupStepId; title: string; description: string; href: string; cta: string; done: boolean };

export type TodayQueueItem = {
  id: string;
  kind: 'reply' | 'commitment' | 'ready';
  title: string;
  description: string;
  href: string;
  /** Meeting requests and overdue commitments first. */
  urgent: boolean;
};

export type TodayPrimary = { title: string; description: string; href: string; cta: string };

export type TodayPlan = {
  setup: TodaySetupStep[];
  setupDone: number;
  primary: TodayPrimary;
  queue: TodayQueueItem[];
};

export type TodayInput = {
  now: Date;
  profile: { companyName: string; hasOffer: boolean };
  mailProviders: string[];
  counts: { saved: number; withEmail: number; readyToWrite: number; sent: number };
  replies: Array<{ id: string; name: string; company: string; intent: string | null; repliedAt: string }>;
  commitments: Array<{ id: string; name: string; company: string; kind: string; title: string; dueAt: string }>;
};

const QUEUE_LIMIT = 6;

function plural(count: number, one: string, many: string) {
  return `${count.toLocaleString('es-CL')} ${count === 1 ? one : many}`;
}

function who(name: string, company: string) {
  const person = name.trim() || 'un contacto';
  return company.trim() ? `${person} (${company.trim()})` : person;
}

export function conversationHref(contactedId: string) {
  return `/contacted?c=${encodeURIComponent(contactedId)}`;
}

export function buildTodayPlan(input: TodayInput): TodayPlan {
  const { counts } = input;
  const mailConnected = input.mailProviders.length > 0;
  const setup: TodaySetupStep[] = [
    {
      id: 'profile', title: 'Cuéntanos qué vendes', href: '/profile', cta: 'Completar perfil',
      description: 'Tu empresa y tu oferta. Con eso la IA escribe correos que suenan a ti.',
      done: Boolean(input.profile.companyName.trim()) && input.profile.hasOffer,
    },
    {
      id: 'mail', title: 'Conecta tu correo', href: '/connections', cta: 'Conectar correo',
      description: 'Gmail u Outlook: los correos salen desde tu cuenta y las respuestas llegan aquí.',
      done: mailConnected,
    },
    {
      id: 'contacts', title: 'Guarda tus primeros contactos', href: '/search', cta: 'Buscar prospectos',
      description: 'Busca por cargo y empresa, o pega un perfil de LinkedIn.',
      done: counts.saved + counts.withEmail > 0,
    },
    {
      id: 'first_send', title: 'Envía tu primer correo', cta: 'Escribir',
      href: counts.withEmail > 0 ? '/saved/leads/enriched' : '/search',
      description: 'Elige un contacto con correo, revisa el borrador de la IA y envíalo.',
      done: counts.sent > 0,
    },
  ];
  const setupDone = setup.filter((step) => step.done).length;

  const nowMs = input.now.getTime();
  const replies = [...input.replies].sort((a, b) =>
    Number(b.intent === 'meeting_request') - Number(a.intent === 'meeting_request') || Date.parse(b.repliedAt) - Date.parse(a.repliedAt));
  const commitments = [...input.commitments].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));

  const queue: TodayQueueItem[] = [];
  for (const reply of replies) {
    const meeting = reply.intent === 'meeting_request';
    queue.push({
      id: `reply:${reply.id}`, kind: 'reply', urgent: meeting, href: conversationHref(reply.id),
      title: meeting ? `${who(reply.name, reply.company)} pidió una reunión` : `${who(reply.name, reply.company)} te respondió`,
      description: meeting ? 'Propón horarios hoy: es lo que más acerca un cierre.' : 'Léelo y contesta en el mismo hilo.',
    });
  }
  for (const commitment of commitments) {
    const overdue = Date.parse(commitment.dueAt) <= nowMs;
    queue.push({
      id: `commitment:${commitment.id}`, kind: 'commitment', urgent: overdue, href: conversationHref(commitment.id),
      title: `${commitment.title} · ${who(commitment.name, commitment.company)}`,
      description: overdue ? 'Venció: cúmplelo o reprográmalo.' : 'Vence hoy.',
    });
  }
  if (counts.readyToWrite > 0 && mailConnected) {
    queue.push({
      id: 'ready', kind: 'ready', urgent: false, href: '/saved/leads/enriched',
      title: `${plural(counts.readyToWrite, 'contacto con correo espera', 'contactos con correo esperan')} tu primer mensaje`,
      description: 'La IA prepara el borrador; tú lo revisas y lo envías.',
    });
  }
  queue.sort((a, b) => Number(b.urgent) - Number(a.urgent));
  const visibleQueue = queue.slice(0, QUEUE_LIMIT);

  return { setup, setupDone, primary: primaryAction(input, setup, visibleQueue), queue: visibleQueue };
}

/** One clear next step: people waiting for an answer beat everything; then what blocks sending; then writing; then finding. */
function primaryAction(input: TodayInput, setup: TodaySetupStep[], queue: TodayQueueItem[]): TodayPrimary {
  const firstUrgent = queue.find((item) => item.urgent) || queue.find((item) => item.kind === 'reply');
  if (firstUrgent) return { title: firstUrgent.title, description: firstUrgent.description, href: firstUrgent.href, cta: 'Abrir conversación' };
  const blocking = setup.find((step) => !step.done && (step.id === 'profile' || step.id === 'mail'));
  if (blocking) return { title: blocking.title, description: blocking.description, href: blocking.href, cta: blocking.cta };
  const commitment = queue.find((item) => item.kind === 'commitment');
  if (commitment) return { title: commitment.title, description: commitment.description, href: commitment.href, cta: 'Abrir conversación' };
  if (input.counts.readyToWrite > 0) {
    return {
      title: `Escríbeles a tus ${plural(input.counts.readyToWrite, 'contacto con correo', 'contactos con correo')}`,
      description: 'Elige a quién, revisa el borrador de la IA y envíalo desde tu correo.',
      href: '/saved/leads/enriched', cta: 'Escribir ahora',
    };
  }
  if (input.counts.saved > 0) {
    return {
      title: `Completa el correo de ${plural(input.counts.saved, 'contacto guardado', 'contactos guardados')}`,
      description: 'Sin correo no se les puede escribir. Complétalo con un clic (usa créditos).',
      href: '/saved/leads', cta: 'Completar correos',
    };
  }
  return {
    title: 'Encuentra tus primeros prospectos',
    description: 'Elige un punto de partida según lo que vendes o pega un perfil de LinkedIn.',
    href: '/search', cta: 'Buscar prospectos',
  };
}

const ATTENTION_INTENTS_EXCLUDED = new Set(['negative', 'unsubscribe', 'delivery_failure', 'auto_reply']);

/** Same rule as «Por responder» in Conversaciones (src/lib/contacted-conversations.ts#needsReply), on the columns the route reads. */
export function replyNeedsAnswer(row: { replied_at?: string | null; reply_intent?: string | null; conversation_resolved_at?: string | null; conversation_outbound_at?: string | null }) {
  if (!row.replied_at || ATTENTION_INTENTS_EXCLUDED.has(row.reply_intent || '')) return false;
  return Date.parse(row.replied_at) > Math.max(Date.parse(row.conversation_resolved_at || '') || 0, Date.parse(row.conversation_outbound_at || '') || 0);
}

/** A commitment counts today when it is open and due before the end of the day. */
export function commitmentDueToday(commitment: unknown, now: Date): { kind: string; title: string; dueAt: string } | null {
  if (!commitment || typeof commitment !== 'object') return null;
  const value = commitment as Record<string, unknown>;
  if (value.completedAt) return null;
  const dueAt = typeof value.dueAt === 'string' ? value.dueAt : '';
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) return null;
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  if (due > endOfDay.getTime()) return null;
  return { kind: String(value.kind || 'reminder'), title: String(value.title || 'Compromiso').slice(0, 120), dueAt };
}
