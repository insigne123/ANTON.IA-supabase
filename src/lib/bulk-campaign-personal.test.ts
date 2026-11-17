import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CampaignInputSchema, defaultAudience, type CampaignInput } from '@/lib/bulk-campaigns';
import {
  PERSONALIZE_BATCH, PersonalizeInputSchema, keptOverrides, personalBatches, personalEstimate, personalMissing, sequenceDays, withPersonalEmails, writePersonalEmails,
  type PersonalizeResult,
} from './bulk-campaign-personal';

const people = (count: number) => Array.from({ length: count }, (_, index) => `persona${index + 1}@ejemplo.cl`);
const messages = [
  { subject: 'Base 1', body: 'Hola {{nombre}}, base uno.', delayDays: 0 },
  { subject: 'Base 2', body: 'Hola {{nombre}}, base dos.', delayDays: 3 },
  { subject: 'Base 3', body: 'Hola {{nombre}}, base tres.', delayDays: 4 },
];
const definition = (count = 3, overrides: CampaignInput['overrides'] = []): CampaignInput => ({ name: 'Campaña', description: 'Gerentes', objective: 'Una llamada de 20 minutos.',
  criteria: { ...defaultAudience }, emails: people(count), messages, provider: 'google', overrides });
const own = (email: string, steps = [0, 1, 2]) => steps.map(messageIndex => ({ email, messageIndex, subject: `Para ${email} ${messageIndex}`, body: `Texto de ${email} ${messageIndex}` }));
const written = (email: string) => ({ email, messages: messages.map((_, index) => ({ subject: `Asunto ${index} de ${email}`, body: `Hola, ${email} ${index}` })) });

test('the days of a campaign count from the first email, which is day 1', () => {
  assert.deepEqual(sequenceDays(messages), [1, 4, 8]);
  assert.deepEqual(sequenceDays([{ delayDays: 0 }]), [1]);
});

test('whoever lacks one of their emails still reads the base; the emails just written replace whatever those people had', () => {
  const [a, b, c] = people(3);
  assert.deepEqual(personalMissing(definition()), [a, b, c]);
  assert.deepEqual(personalMissing(definition(3, [...own(a), ...own(b, [0])])), [b, c]);
  const next = withPersonalEmails(definition(3, [...own(a), ...own(b, [0])]), [written(b)]);
  assert.equal(next.length, 6);
  assert.deepEqual(next.filter(item => item.email === b).map(item => item.subject), [`Asunto 0 de ${b}`, `Asunto 1 de ${b}`, `Asunto 2 de ${b}`]);
  assert.deepEqual(personalMissing({ ...definition(), overrides: next }), [c]);
  // A hundred people with seven emails each fit in a campaign, and the choice of one text for everyone is kept.
  const big = CampaignInputSchema.safeParse({ ...definition(100), messages: Array.from({ length: 7 }, (_, index) => ({ subject: `S${index}`, body: 'Texto', delayDays: index ? 2 : 0 })),
    overrides: people(100).flatMap(email => Array.from({ length: 7 }, (_, messageIndex) => ({ email, messageIndex, subject: 'Propio', body: 'Propio' }))), personalize: false });
  assert.equal(big.success, true);
  assert.equal(big.success && big.data.personalize, false);
  assert.equal(CampaignInputSchema.parse(definition()).personalize, undefined);
});

test('when the base or the audience change, each person keeps the emails whose base did not change', () => {
  const [a, b] = people(2);
  const before = definition(2, [...own(a), ...own(b)]);
  // Only the days changed: nothing is written again.
  assert.equal(keptOverrides(before, { emails: before.emails, messages: messages.map((message, index) => (index === 1 ? { ...message, delayDays: 5 } : message)) }).length, 6);
  // The second email was rewritten: that one goes, for everyone.
  const edited = keptOverrides(before, { emails: before.emails, messages: messages.map((message, index) => (index === 1 ? { ...message, body: 'Otro texto' } : message)) });
  assert.deepEqual(edited.map(item => item.messageIndex).sort(), [0, 0, 2, 2]);
  // One follow-up less, and one person out.
  assert.deepEqual(keptOverrides(before, { emails: [a], messages: messages.slice(0, 2) }).map(item => `${item.email}:${item.messageIndex}`), [`${a}:0`, `${a}:1`]);
});

test('the people go in groups of a request, each with where it starts, and the wait is said before', () => {
  const batches = personalBatches(people(12));
  assert.deepEqual(batches.map(batch => [batch.offset, batch.emails.length]), [[0, PERSONALIZE_BATCH], [5, 5], [10, 2]]);
  assert.equal(personalEstimate(6), 'menos de un minuto');
  assert.equal(personalEstimate(100), 'unos 5 minutos');
  assert.equal(PersonalizeInputSchema.safeParse({ emails: people(6), objective: '', relationship: 'never_contacted', messages }).success, false);
  assert.deepEqual(PersonalizeInputSchema.parse({ emails: ['ANA@Ejemplo.cl'], objective: 'x', relationship: 'never_contacted', messages }).emails, ['ana@ejemplo.cl']);
});

test('writing a campaign: every group is asked, progress is told, and whoever failed is tried once more', async () => {
  const emails = people(12);
  const asked: string[][] = [];
  const progress: Array<[number, number]> = [];
  const failOnce = new Set([emails[3], emails[11]]);
  const send = async (body: any): Promise<PersonalizeResult> => {
    asked.push(body.emails);
    assert.equal(body.objective, 'Una llamada de 20 minutos.');
    assert.equal(body.relationship, 'never_contacted');
    const failed = body.emails.filter((email: string) => failOnce.delete(email));
    return { written: body.emails.filter((email: string) => !failed.includes(email)).map(written), failed: failed.map((email: string) => ({ email, reason: 'La IA tardó más de lo esperado.' })) };
  };
  const run = await writePersonalEmails({ definition: definition(12), emails, send, onProgress: (done, total) => progress.push([done, total]) });
  assert.equal(run.written.length, 12);
  assert.deepEqual(run.failed, []);
  assert.deepEqual(asked.at(-1), [emails[3], emails[11]]);
  assert.deepEqual(progress[0], [0, 12]);
  assert.deepEqual(progress.at(-1), [12, 12]);
  assert.ok(progress.every(([done]) => done <= 12));
  // Whoever fails twice keeps the base.
  const twice = await writePersonalEmails({ definition: definition(2), emails: people(2),
    send: async body => ({ written: body.emails.slice(1).map(written), failed: [{ email: body.emails[0], reason: 'No se pudieron escribir sus correos.' }] }) });
  assert.deepEqual([twice.written.length >= 1, twice.failed.map(person => person.email)], [true, [people(2)[0]]]);
});

test('whoever already has a first email of their own goes alone, and their emails are written from it', async () => {
  const emails = people(7);
  const mine = { subject: 'Vi la planta nueva', body: 'Hola Ana,\nvi que abrieron una planta.' };
  assert.deepEqual(personalBatches(emails, [emails[1]]).map(batch => [batch.offset, batch.emails]), [[0, [emails[0], ...emails.slice(2, 6)]], [5, [emails[6]]], [6, [emails[1]]]]);
  const asked: any[] = [];
  const run = await writePersonalEmails({ definition: definition(7), emails, own: { [emails[1]]: mine },
    send: async body => { asked.push(body); return { written: body.emails.map(written), failed: [] }; } });
  assert.equal(run.written.length, 7);
  const alone = asked.find(body => body.emails.length === 1 && body.emails[0] === emails[1]);
  assert.deepEqual([alone.messages[0].subject, alone.messages[0].body, alone.messages[0].delayDays, alone.messages[1].subject], ['Vi la planta nueva', mine.body, 0, 'Base 2']);
  assert.ok(asked.filter(body => body !== alone).every(body => body.messages[0].subject === 'Base 1'));
});

test('the day\'s limit stops the writing with the server\'s words, and the person can stop it too', async () => {
  let calls = 0;
  const limited = await writePersonalEmails({ definition: definition(12), emails: people(12), send: async body => {
    calls++;
    if (calls > 1) throw Object.assign(new Error('Alcanzaste el límite diario de correos escritos con IA.'), { status: 429 });
    return { written: body.emails.map(written), failed: [] };
  } });
  assert.equal(limited.limit, 'Alcanzaste el límite diario de correos escritos con IA.');
  assert.equal(limited.written.length, 5);
  assert.equal(limited.failed.length, 7);
  let stop = false;
  const stopped = await writePersonalEmails({ definition: definition(12), emails: people(12), stopped: () => stop,
    send: async body => { stop = true; return { written: body.emails.map(written), failed: [] }; } });
  assert.equal(stopped.stopped, true);
  assert.ok(stopped.written.length < 12);
});

test('Campañas writes an email for each person on saving, shows how it goes and says who stayed with the base', () => {
  const workspace = readFileSync('src/components/campaigns/BulkCampaignWorkspace.tsx', 'utf8');
  const editor = readFileSync('src/components/campaigns/CampaignSequenceEditor.tsx', 'utf8');
  const preview = readFileSync('src/components/campaigns/CampaignPreview.tsx', 'utf8');
  assert.match(workspace, /onSave=\{\(\) => void run\(\(\) => writeAndSave\(\)\)\}/);
  assert.match(workspace, /request\('\/personalize', body\)/);
  assert.match(workspace, /Escribiendo un correo para cada persona…/);
  assert.match(workspace, /<Progress value=/);
  assert.match(workspace, /stopWriting\.current = true/);
  assert.match(workspace, /todavía el texto base/);
  assert.match(workspace, /keptOverrides\(value, \{ emails: patch\.emails \?\? value\.emails, messages: patch\.messages \?\? value\.messages \}\)/);
  assert.match(editor, /Escribir un correo para cada persona/);
  assert.match(editor, /Enviar este mismo texto a todos, sin escribir uno para cada persona/);
  assert.match(editor, /onChange\(\{ personalize: checked === true \? false : undefined \}\)/);
  assert.match(preview, /'Texto base'/);
  // The one-contact campaign of a recommended contact is already written for that person.
  assert.match(readFileSync('src/lib/server/lead-drop-campaign.ts', 'utf8'), /personalize: false/);
});
