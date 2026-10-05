import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workspace = readFileSync('src/components/commercial-opportunities/OpportunitiesWorkspace.tsx', 'utf8');
const connections = readFileSync('src/components/settings/ConnectionsPanel.tsx', 'utf8');
const connectionCard = readFileSync('src/components/settings/MercadoPublicoConnectionCard.tsx', 'utf8');

test('the tenders tab asks each person for their own ticket, with the guide, instead of sending them to an administrator', () => {
  assert.doesNotMatch(workspace, /Mercado Público no está conectado/);
  assert.match(workspace, /ticketNeedsAction\(overview\.tenderSearch\.ticketStatus\) \? \(\s*<MercadoPublicoTicketCard /);
  assert.match(workspace, /<TicketGuide open=\{guideOpen\} onOpenChange=\{setGuideOpen\} onSaved=\{updateTicket\} \/>/);
  assert.match(workspace, /title="Conecta tu ticket para buscar licitaciones"/);
  assert.match(workspace, /Sin costo: usa tu ticket de Mercado Público/);
});

test('Conexiones shows the ticket only to people who can open Oportunidades', () => {
  assert.match(connections, /<MercadoPublicoConnectionCard \/>/);
  assert.match(connectionCard, /fetch\('\/api\/commercial-opportunities\/access'/, 'asks like the menu, so nobody gets a 404 in the console');
  assert.ok(connectionCard.indexOf("/api/commercial-opportunities/access") < connectionCard.indexOf("/api/commercial-opportunities/ticket"));
  assert.match(connectionCard, /if \(hidden \|\| !loaded\) return null;/);
});
