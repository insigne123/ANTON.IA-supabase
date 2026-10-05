import { z } from 'zod';
import { requireOpportunitiesAccess } from '@/lib/server/commercial-opportunities/access';
import { opportunitiesError, opportunitiesJson } from '@/lib/server/commercial-opportunities/responses';
import { HiringSyncError } from '@/lib/server/commercial-opportunities/sync';
import {
  checkMercadoPublicoTicket, deleteTicket, normalizeTicket, resolveTicketForUser, saveTicket,
} from '@/lib/server/commercial-opportunities/tickets';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  ticket: z.string({ required_error: 'Pega tu ticket de Mercado Público.', invalid_type_error: 'Pega tu ticket de Mercado Público.' })
    .max(200, 'Eso no parece un ticket de Mercado Público.'),
}).strict();

/**
 * The signed-in person's own Mercado Público ticket (Plan 10): whether it is connected, saving it after one light request
 * proves it works, and removing it. Each person only ever touches their own row; the ticket itself never comes back.
 */
export async function GET() {
  try {
    const auth = await requireOpportunitiesAccess();
    const { status } = await resolveTicketForUser(auth.admin, auth.user);
    return opportunitiesJson({ ticket: status });
  } catch (error) {
    return opportunitiesError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireOpportunitiesAccess();
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    const ticket = normalizeTicket(body.ticket);
    if (!ticket) throw new HiringSyncError('Eso no parece un ticket de Mercado Público: son 36 letras y números separados por guiones, como XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX.', 400);
    const check = await checkMercadoPublicoTicket(ticket);
    if (check === 'invalid') throw new HiringSyncError('Mercado Público no reconoce ese ticket. Revisa que lo copiaste completo, desde el correo que te enviaron.', 400);
    if (check === 'unavailable') throw new HiringSyncError('Mercado Público no respondió para probar el ticket. Vuelve a intentarlo en unos minutos.', 503);
    await saveTicket(auth.admin, auth.user.id, ticket);
    const { status } = await resolveTicketForUser(auth.admin, auth.user);
    // A ticket busy with another request is a real ticket: it is saved, and the page says it was checked anyway.
    return opportunitiesJson({ ticket: status, check });
  } catch (error) {
    return opportunitiesError(error);
  }
}

export async function DELETE() {
  try {
    const auth = await requireOpportunitiesAccess();
    await deleteTicket(auth.admin, auth.user.id);
    const { status } = await resolveTicketForUser(auth.admin, auth.user);
    return opportunitiesJson({ ticket: status });
  } catch (error) {
    return opportunitiesError(error);
  }
}
