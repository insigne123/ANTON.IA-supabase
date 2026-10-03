import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { disconnectWarning } from '../mail-connections';

const route = readFileSync('src/app/api/integrations/store-token/route.ts', 'utf8');
const card = readFileSync('src/components/settings/MailConnectionsCard.tsx', 'utf8');
const page = readFileSync('src/app/(app)/connections/page.tsx', 'utf8');

test('disconnecting needs a session and a known provider, and answers only the new state', () => {
  const remove = route.slice(route.indexOf('export async function DELETE'));
  assert.match(remove, /if \(!user\) \{\s*return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/);
  assert.match(remove, /if \(!isMailProvider\(provider\)\)/);
  assert.match(remove, /disconnectMailProvider\(getSupabaseAdminClient\(\), user\.id, provider\)/, 'always the signed-in person, never an id from the request');
  assert.doesNotMatch(remove, /refresh_token/);
  assert.doesNotMatch(route.slice(route.indexOf('export async function GET')), /select\('[^']*refresh_token/, 'the status never reads the token back');
});

test('Conexiones asks before disconnecting and says what stops', () => {
  assert.match(card, /await confirm\(\{[\s\S]*tone: 'danger'/);
  assert.match(card, /method: 'DELETE'/);
  assert.match(page, /<ConnectionsPanel \/>/);
  assert.equal(
    disconnectWarning('google', { google: true, outlook: true, approvedCampaigns: 3 }),
    'ANTON.IA dejará de enviar desde Gmail y de leer sus respuestas. Outlook sigue conectado y envía desde ahora.',
  );
  assert.equal(
    disconnectWarning('outlook', { google: false, outlook: true, approvedCampaigns: 2 }),
    'ANTON.IA dejará de enviar desde Outlook y de leer sus respuestas. No te queda otra cuenta: los envíos pendientes de tus 2 campañas aprobadas esperarán hasta que conectes una.',
  );
  assert.match(disconnectWarning('google', { google: true, outlook: false, approvedCampaigns: 1 }), /los envíos pendientes de tu campaña aprobada esperarán/);
  assert.match(disconnectWarning('google', { google: true, outlook: false }), /para volver a enviar tendrás que conectar una/);
});
