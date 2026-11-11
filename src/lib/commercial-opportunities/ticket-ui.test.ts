import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const connections = readFileSync('src/components/settings/ConnectionsPanel.tsx', 'utf8');
const connectionCard = readFileSync('src/components/settings/MercadoPublicoConnectionCard.tsx', 'utf8');

test('Conexiones shows the ticket only to people who can open Oportunidades', () => {
  assert.match(connections, /<MercadoPublicoConnectionCard \/>/);
  assert.match(connectionCard, /fetch\('\/api\/commercial-opportunities\/access'/, 'asks like the menu, so nobody gets a 404 in the console');
  assert.ok(connectionCard.indexOf("/api/commercial-opportunities/access") < connectionCard.indexOf("/api/commercial-opportunities/ticket"));
  assert.match(connectionCard, /if \(hidden \|\| !loaded\) return null;/);
  // A member who sees «Oportunidades» without managing it gets a 403 from the ticket: no card, never an error to retry.
  assert.match(connectionCard, /answer\.available !== true \|\| answer\.ticket === false\) \{ setHidden\(true\); return; \}/, 'and is not even asked for the ticket');
  assert.match(readFileSync('src/app/api/commercial-opportunities/access/route.ts', 'utf8'), /ticket: !opportunityWorkspaceEnabled\(\) \|\| isOpportunityAdmin\(auth\.organizationRole\)/);
  assert.match(connectionCard, /response\.status === 404 \|\| response\.status === 403\) \{ setHidden\(true\); return; \}/);
});
