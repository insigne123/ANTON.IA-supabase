import { relativeTime } from './view';

/**
 * The Mercado Público ticket in the page (Plan 10): what the person sees about their own ticket and the guide to get one.
 * The server never sends the ticket, only this status. The steps of the guide follow the official portal, checked on
 * 5 Oct 2026 at chilecompra.cl/api: «Pide tu ticket», Clave Única, the form with «Solicitud de Ticket», the code by email.
 */
export type TicketStatus = { connected: boolean; hint: string | null; verifiedAt: string | null; lastError: string | null; shared: boolean };
export type TicketCheck = 'valid' | 'busy';

export const TICKET_PORTAL_URL = 'https://www.chilecompra.cl/api/';
export const TICKET_EXAMPLE = 'XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX';
const TICKET = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

/** The same check as the server, before sending: 36 letters and numbers with hyphens; spaces from the email are ignored. */
export const looksLikeTicket = (value: string) => TICKET.test(value.replace(/\s+/g, ''));

/** Whether the page must ask for a ticket: none of their own nor shared, or the one they have was refused. */
export const ticketNeedsAction = (status: TicketStatus | null | undefined) => !status || Boolean(status.lastError) || (!status.connected && !status.shared);

/** One line about the ticket, without the ticket: «Tu ticket ••••1A2B · verificado hace 2 días». */
export function ticketStatusLine(status: TicketStatus, now = Date.now()) {
  if (status.connected) {
    const checked = status.verifiedAt ? ` · verificado ${relativeTime(status.verifiedAt, now)}` : '';
    return `Tu ticket ${status.hint ? `••••${status.hint}` : 'propio'}${checked}`;
  }
  if (status.shared) return 'Usas el ticket compartido de tu cuenta.';
  return 'Aún no conectas tu ticket.';
}

export const TICKET_SAVED: Record<TicketCheck, string> = {
  valid: 'Listo: tu ticket funciona. Ya puedes buscar licitaciones y Compra Ágil.',
  busy: 'Guardado: Mercado Público estaba ocupado con otra consulta, pero el ticket es real.',
};

export const TICKET_FORMAT_ERROR = `Eso no parece un ticket: son 36 letras y números separados por guiones, como ${TICKET_EXAMPLE}.`;

/** The three steps of «Cómo conseguirlo». */
export const TICKET_GUIDE = {
  title: 'Cómo conseguir tu ticket de Mercado Público',
  description: 'Tres pasos y unos minutos. Es gratis.',
  steps: ['Qué es el ticket', 'Pídelo en ChileCompra', 'Pégalo aquí'] as const,
  what: [
    { lead: 'Gratis y personal.', text: 'ChileCompra entrega un ticket por persona, a tu nombre.' },
    { lead: 'Sirve para licitaciones y Compra Ágil.', text: 'Con él buscamos cada mañana las compras públicas que calzan con tu oferta.' },
    { lead: '10.000 consultas al día.', text: 'Una búsqueda usa menos de 100, así que sobra.' },
    { lead: 'Guardado con cuidado.', text: 'Lo guardamos cifrado y solo mostramos sus últimos 4 caracteres.' },
  ],
  request: [
    'Abre chilecompra.cl/api y pulsa «Pide tu ticket».',
    'Acepta los términos de uso e ingresa con tu Clave Única.',
    'Completa el formulario con tu nombre, RUT y correo, y elige «Solicitud de Ticket».',
    `El ticket llega a tu correo: es un código de 36 caracteres, como ${TICKET_EXAMPLE}.`,
  ],
  noClaveUnica: '¿Aún no tienes Clave Única? Se pide en claveunica.gob.cl.',
} as const;
