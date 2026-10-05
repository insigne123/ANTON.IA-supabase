import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ticketRoute = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');
const viewRoute = readFileSync(new URL('../route.ts', import.meta.url), 'utf8');
const runsRoute = readFileSync(new URL('../runs/route.ts', import.meta.url), 'utf8');

test('each person reads, saves and removes only their own ticket, behind the Oportunidades access check', () => {
  for (const handler of ['GET', 'PUT', 'DELETE']) {
    const body = ticketRoute.slice(ticketRoute.indexOf(`export async function ${handler}`));
    assert.match(body.slice(0, 400), /await requireOpportunitiesAccess\(\)/, `${handler} checks the access first`);
  }
  assert.match(ticketRoute, /saveTicket\(auth\.admin, auth\.user\.id, ticket\)/);
  assert.match(ticketRoute, /deleteTicket\(auth\.admin, auth\.user\.id\)/);
  assert.doesNotMatch(ticketRoute, /params|searchParams|user_id/, 'never an id from the request');
});

test('the ticket never goes back to the browser nor into a log', () => {
  // Every answer of the ticket route is the status (hint and dates) and, after saving, the result of the check.
  const answers = ticketRoute.match(/opportunitiesJson\(\{[^}]*\}/g) || [];
  assert.equal(answers.length, 3);
  for (const answer of answers) assert.match(answer, /^opportunitiesJson\(\{ ticket: status(, check)? \}$/);
  for (const source of [ticketRoute, viewRoute, runsRoute]) assert.doesNotMatch(source, /console\.(log|info|warn|error)\([^)]*ticket/i);
  assert.match(viewRoute, /ticket: Boolean\(ticket\.ticket\), ticketStatus: ticket\.status/, 'the page learns whether there is a ticket, not which');
  assert.match(runsRoute, /ticket: resolved\.ticket/, 'the manual search uses the ticket of whoever clicks');
  assert.doesNotMatch(runsRoute, /process\.env\.MERCADO_PUBLICO_TICKET/, 'the shared ticket is only reached through its list');
});
