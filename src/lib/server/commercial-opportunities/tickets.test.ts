import assert from 'node:assert/strict';
import test from 'node:test';
import { encryptStoredToken } from '@/lib/server/token-crypto';
import {
  NO_ORGANIZATION_TICKET, TICKET_REJECTED, TICKET_UNREADABLE, checkMercadoPublicoTicket, deleteTicket, markTicketRejected, normalizeTicket,
  resolveTicketForOrganization, resolveTicketForUser, saveTicket, sharedTicketFor, ticketHint, ticketWasRejected,
} from './tickets';

type Row = Record<string, any>;
const OWN = 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B1A2B';
const OTHER = 'B1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B9F9F';
const NEWER = 'C1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B7777';
const SHARED = 'D1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B5555';
const confirmed = '2026-09-01T00:00:00Z';
const users: Record<string, { id: string; email: string; email_confirmed_at: string | null }> = {
  nico: { id: 'nico', email: 'nicolas.yarur.g@yago.cl', email_confirmed_at: confirmed },
  ana: { id: 'ana', email: 'ana@empresa.cl', email_confirmed_at: confirmed },
  luis: { id: 'luis', email: 'luis@empresa.cl', email_confirmed_at: confirmed },
  ex: { id: 'ex', email: 'ex@empresa.cl', email_confirmed_at: confirmed },
  pending: { id: 'pending', email: 'nicolas.yarur.g@yago.cl', email_confirmed_at: null },
};
const ENV = {
  MERCADO_PUBLICO_TICKET: SHARED, MERCADO_PUBLICO_SHARED_TICKET_EMAILS: 'nicolas.yarur.g@yago.cl',
  OPPORTUNITIES_ALLOWED_EMAILS: 'nicolas.yarur.g@yago.cl,ana@empresa.cl,luis@empresa.cl',
};
const ticketRow = (userId: string, ticket: string, extra: Row = {}) => ({
  user_id: userId, ticket_encrypted: encryptStoredToken(ticket), ticket_hint: ticketHint(ticket), verified_at: '2026-10-01T12:00:00Z', last_error: null, ...extra,
});

/** Just enough of the query builder for the ticket queries: select/eq/in, maybeSingle, upsert, update, delete and auth users. */
function fakeClient(tables: Record<string, Row[]>) {
  const client = {
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: users[id] ?? null }, error: users[id] ? null : { message: 'not found' } }) } },
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let action: { kind: 'update'; patch: Row } | { kind: 'delete' } | null = null;
      const rows = () => (tables[table] || []).filter(row => filters.every(keep => keep(row)));
      const run = () => {
        if (action?.kind === 'delete') tables[table] = (tables[table] || []).filter(row => !filters.every(keep => keep(row)));
        if (action?.kind === 'update') for (const row of rows()) Object.assign(row, action.patch);
        return { data: action ? null : rows(), error: null };
      };
      const builder: any = {
        select() { return builder; },
        eq(column: string, value: unknown) { filters.push(row => row[column] === value); return builder; },
        in(column: string, values: unknown[]) { filters.push(row => values.includes(row[column])); return builder; },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        upsert: async (row: Row) => {
          const list = (tables[table] ||= []);
          const existing = list.find(item => item.user_id === row.user_id);
          if (existing) Object.assign(existing, row); else list.push({ ...row });
          return { error: null };
        },
        update(patch: Row) { action = { kind: 'update', patch }; return builder; },
        delete() { action = { kind: 'delete' }; return builder; },
        then(resolve: (value: unknown) => void) { resolve(run()); },
      };
      return builder;
    },
  };
  return client as any;
}

test('a ticket is a GUID: spaces are dropped, letters go upper case, and only the last four characters are shown', () => {
  assert.equal(normalizeTicket(' a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b1a2b \n'), OWN);
  assert.equal(normalizeTicket('A1B2C3D4E5F64A7B8C9D0E1F2A3B1A2B'), null, 'without hyphens it is not a ticket');
  assert.equal(normalizeTicket('mi-ticket'), null);
  assert.equal(normalizeTicket(42), null);
  assert.equal(ticketHint(OWN), '1A2B');
});

test('the shared ticket is only for the confirmed accounts on its list', () => {
  assert.equal(sharedTicketFor(users.nico, ENV), SHARED);
  assert.equal(sharedTicketFor(users.ana, ENV), undefined, 'another allowed account brings its own');
  assert.equal(sharedTicketFor(users.pending, ENV), undefined, 'an unconfirmed email is not enough');
  assert.equal(sharedTicketFor(users.nico, { ...ENV, MERCADO_PUBLICO_SHARED_TICKET_EMAILS: '' }), undefined);
  assert.equal(sharedTicketFor(users.nico, { ...ENV, MERCADO_PUBLICO_TICKET: '' }), undefined);
});

test('a person searches with their own ticket, else the shared one when listed, else none; the page gets the hint only', async () => {
  const client = fakeClient({ commercial_opportunity_tickets: [ticketRow('ana', OWN)] });
  const own = await resolveTicketForUser(client, users.ana, ENV);
  assert.deepEqual([own.ticket, own.source], [OWN, 'own']);
  assert.deepEqual(own.status, { connected: true, hint: '1A2B', verifiedAt: '2026-10-01T12:00:00Z', lastError: null, shared: false });
  assert.ok(!JSON.stringify(own.status).includes(OWN), 'the status never carries the ticket');

  const shared = await resolveTicketForUser(client, users.nico, ENV);
  assert.deepEqual([shared.ticket, shared.source, shared.status.connected, shared.status.shared], [SHARED, 'shared', false, true]);

  const none = await resolveTicketForUser(client, users.luis, ENV);
  assert.deepEqual([none.ticket, none.source, none.status.connected, none.status.shared], [undefined, null, false, false]);

  // Nicolás with his own ticket uses his own, not the shared one.
  const both = await resolveTicketForUser(fakeClient({ commercial_opportunity_tickets: [ticketRow('nico', OTHER)] }), users.nico, ENV);
  assert.deepEqual([both.ticket, both.source, both.status.shared], [OTHER, 'own', false]);
});

test('a saved ticket that can no longer be read asks to be pasted again', async () => {
  const client = fakeClient({ commercial_opportunity_tickets: [{ ...ticketRow('ana', OWN), ticket_encrypted: 'enc:v1.aaaa.bbbb.cccc' }] });
  const result = await resolveTicketForUser(client, users.ana, ENV);
  assert.equal(result.ticket, undefined);
  assert.equal(result.status.lastError, TICKET_UNREADABLE);
});

test('saving keeps the ticket encrypted with its hint; removing and rejecting touch only that person', async () => {
  const tables: Record<string, Row[]> = { commercial_opportunity_tickets: [ticketRow('luis', OTHER)] };
  const client = fakeClient(tables);
  await saveTicket(client, 'ana', OWN, '2026-10-05T12:00:00Z');
  const saved = tables.commercial_opportunity_tickets.find(row => row.user_id === 'ana')!;
  assert.match(saved.ticket_encrypted, /^enc:v1\./);
  assert.ok(!saved.ticket_encrypted.includes(OWN));
  assert.deepEqual([saved.ticket_hint, saved.verified_at, saved.last_error], ['1A2B', '2026-10-05T12:00:00Z', null]);
  assert.equal((await resolveTicketForUser(client, users.ana, ENV)).ticket, OWN, 'it reads back');

  await markTicketRejected(client, 'ana');
  assert.equal(tables.commercial_opportunity_tickets.find(row => row.user_id === 'ana')!.last_error, TICKET_REJECTED);
  await saveTicket(client, 'ana', NEWER);
  assert.equal(tables.commercial_opportunity_tickets.find(row => row.user_id === 'ana')!.last_error, null, 'a new ticket clears the rejection');

  await deleteTicket(client, 'ana');
  assert.deepEqual(tables.commercial_opportunity_tickets.map(row => row.user_id), ['luis']);
});

test('the daily search uses the creator\'s ticket, else the newest of an allowed member, else the shared one for the creator', async () => {
  const members = (ids: string[]) => ids.map(id => ({ organization_id: 'org', user_id: id }));
  const org = (tickets: Row[], ids = ['nico', 'ana', 'luis', 'ex']) => fakeClient({ organization_members: members(ids), commercial_opportunity_tickets: tickets });

  assert.deepEqual(await resolveTicketForOrganization(org([ticketRow('ana', OWN), ticketRow('nico', OTHER, { verified_at: '2026-09-01T00:00:00Z' })]),
    { organizationId: 'org', creatorId: 'nico', env: ENV }), { ticket: OTHER, userId: 'nico', source: 'own' }, 'the creator first');

  assert.deepEqual(await resolveTicketForOrganization(org([
    ticketRow('ana', OWN, { verified_at: '2026-09-01T00:00:00Z' }), ticketRow('luis', NEWER, { verified_at: '2026-10-04T00:00:00Z' }),
  ]), { organizationId: 'org', creatorId: 'nico', env: ENV }), { ticket: NEWER, userId: 'luis', source: 'own' }, 'then the newest verified');

  assert.deepEqual(await resolveTicketForOrganization(org([
    ticketRow('luis', NEWER, { last_error: TICKET_REJECTED }), ticketRow('ex', OTHER), ticketRow('outsider', SHARED),
  ], ['ana', 'luis', 'ex']), { organizationId: 'org', creatorId: 'ana', env: ENV }), null,
  'a rejected ticket, a member without access and someone outside the organization are skipped');

  assert.deepEqual(await resolveTicketForOrganization(org([]), { organizationId: 'org', creatorId: 'nico', env: ENV }),
    { ticket: SHARED, userId: 'nico', source: 'shared' }, 'the shared ticket only when the creator is on its list');
  assert.equal(await resolveTicketForOrganization(org([]), { organizationId: 'org', creatorId: 'ana', env: ENV }), null);
  assert.match(NO_ORGANIZATION_TICKET, /Nadie de la organización/);
});

test('checking a ticket costs one light request and tells a real ticket from an unknown one', async () => {
  const urls: string[] = [];
  const answer = (status: number, body: unknown) => (async (url: string) => { urls.push(url); return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch;
  assert.equal(await checkMercadoPublicoTicket(OWN, { fetch: answer(200, { Cantidad: 0, Listado: [] }) }), 'valid');
  assert.equal(new URL(urls[0]).searchParams.get('codigo'), '1000-1-L126');
  assert.equal(await checkMercadoPublicoTicket(OWN, { fetch: answer(203, { Codigo: 203, Mensaje: 'Ticket no válido.' }) }), 'invalid');
  assert.equal(await checkMercadoPublicoTicket(OWN, { fetch: answer(429, { Codigo: 10500, Mensaje: 'peticiones simultáneas' }) }), 'busy');
  assert.equal(await checkMercadoPublicoTicket(OWN, { fetch: answer(500, { Codigo: 10000 }) }), 'unavailable');
  assert.equal(await checkMercadoPublicoTicket(OWN, { fetch: (async () => { throw new Error('offline'); }) as unknown as typeof fetch }), 'unavailable');
});

test('a search that ended with the ticket refused is told apart from any other failure', () => {
  assert.equal(ticketWasRejected({ sources: [{ error: null }, { error: 'Mercado Público rechazó el ticket.' }] }), true);
  assert.equal(ticketWasRejected({ sources: [{ error: '1 de 11 búsquedas fallaron: Compra Ágil respondió 500.' }] }), false);
});
