import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedinMessageIssues, linkedinSellerContext, writeLinkedinMessage } from './linkedin-message-writer';
test('generic seller labels are excluded and specific capabilities preserved', () => {
  const seller = linkedinSellerContext({ companyName: 'Mi empresa', services: ['Selección de personal', 'Mi empresa'], valueProposition: 'Our company' });
  assert.equal(seller.companyName, null); assert.equal(seller.valueProposition, null);
  assert.deepEqual(seller.services, ['Selección de personal']);
});
test('LinkedIn editorial guard rejects email format, placeholders and multiple CTAs', () => {
  assert.ok(linkedinMessageIssues('Hola, desde Mi empresa. ¿Nos reunimos? ¿Con quién hablo?').length >= 2);
  assert.ok(linkedinMessageIssues('Asunto: reunión\n¿Hablamos?\nAtentamente').length);
  assert.deepEqual(linkedinMessageIssues('Hola Bianca, vi tu rol en selección en Apuesta Total.\n\n¿La coordinación de entrevistas forma parte de tu trabajo?'), []);
});
test('writer repairs once and never returns generic seller copy', async () => {
  const calls: any[] = [];
  const result = await writeLinkedinMessage({ instruction: 'Abrir conversación', language: 'es', tone: 'cercano', seller: { companyName: 'Mi empresa' }, lead: {}, evidence: [], previousMessage: 'un borrador' }, (async (input: any) => {
    calls.push(input); return { message: calls.length === 1 ? 'Desde Mi empresa, ¿hablamos?' : 'Hola Bianca, ¿la coordinación de entrevistas forma parte de tu trabajo?' };
  }) as any);
  assert.equal(calls.length, 2); assert.equal(result.sellerProfileIncomplete, true);
  const context = JSON.parse(calls[0].prompt);
  assert.equal(context.seller.companyName, null); assert.equal(context.conversationHistory, 'not_provided');
  assert.ok(JSON.parse(calls[1].prompt).editorialCorrection.length);
});
test('writer rejects a repeated bad result rather than returning an unreviewed message', async () => {
  await assert.rejects(writeLinkedinMessage({ instruction: 'Contactar', language: 'es', tone: 'profesional', seller: {}, lead: {}, evidence: [] }, (async () => ({ message: 'Desde Mi empresa' })) as any), /calidad esperada/);
});

const posts = [
  { text: 'Este año duplicamos el equipo de bodega en Antofagasta y seguimos buscando operarios.', when: '2 sem', kind: 'post' as const },
  { text: 'Felicitaciones al equipo por el récord de seguridad.', when: '1 mes', kind: 'comment' as const },
];
test('with the profile’s posts, the writer may open from one and says which', async () => {
  const calls: any[] = [];
  const result = await writeLinkedinMessage({ instruction: 'Abrir conversación', language: 'es', tone: 'cercano', seller: { companyName: 'Acme' }, lead: {}, evidence: [], recentActivity: posts }, (async (input: any) => {
    calls.push(input); return { message: 'Hola Ana, vi tu publicación sobre duplicar el equipo de bodega en Antofagasta.\n\n¿Cómo están resolviendo la selección de operarios?', activityIndex: 0 };
  }) as any);
  assert.equal(result.activityIndex, 0);
  assert.deepEqual(JSON.parse(calls[0].prompt).recentActivity, posts);
  assert.match(calls[0].systemPrompt, /ACTIVIDAD RECIENTE/);
  // An index that names no given post is none.
  const other = await writeLinkedinMessage({ instruction: 'Abrir', language: 'es', tone: 'cercano', seller: {}, lead: {}, evidence: [], recentActivity: posts },
    (async () => ({ message: 'Hola Ana, ¿cómo están resolviendo la selección de operarios?', activityIndex: 5 })) as any);
  assert.equal(other.activityIndex, null);
});
test('without posts, a message that says it read one is corrected', async () => {
  const calls: any[] = [];
  const result = await writeLinkedinMessage({ instruction: 'Abrir', language: 'es', tone: 'cercano', seller: {}, lead: {}, evidence: [] }, (async (input: any) => {
    calls.push(input);
    return calls.length === 1 ? { message: 'Hola Ana, vi tu publicación sobre bodega. ¿Conversamos?', activityIndex: 0 } : { message: 'Hola Ana, ¿cómo están resolviendo la selección de operarios?', activityIndex: -1 };
  }) as any);
  assert.equal(calls.length, 2);
  assert.ok(JSON.parse(calls[1].prompt).editorialCorrection.includes('No menciones publicaciones: no se aportó ninguna.'));
  assert.deepEqual(JSON.parse(calls[0].prompt).recentActivity, []);
  assert.equal(result.activityIndex, null);
  assert.deepEqual(linkedinMessageIssues('Hola Ana, vi tu publicación. ¿Conversamos?', 1), []);
  assert.deepEqual(linkedinMessageIssues('Hola Ana, ¿el servicio de postventa es parte de tu área?'), [], 'a word inside another is not a post');
});
