import test from 'node:test';
import assert from 'node:assert/strict';
import { COWORK_REPLY_BODY_MAX, COWORK_REPLY_SUBJECT_MAX, coworkReplyBody, coworkReplySubject, coworkReplyThreadSchema } from './reply-proposal';

const ID = '00000000-0000-4000-8000-000000000021';

test('a reply proposal is the conversation, the subject and the text, and nothing else: the recipient is never the model\'s to choose', () => {
  assert.deepEqual(coworkReplyThreadSchema.parse({ contactedId: ID, subject: '  Re: Hola ', body: ' Gracias por responder. ' }),
    { contactedId: ID, subject: 'Re: Hola', body: 'Gracias por responder.' });
  assert.equal(coworkReplyThreadSchema.safeParse({ contactedId: ID, subject: 'Hola', body: 'Texto', to: 'otra@empresa.cl' }).success, false);
  assert.equal(coworkReplyThreadSchema.safeParse({ contactedId: 'mrojas@sernorte.cl', subject: 'Hola', body: 'Texto' }).success, false);
  assert.equal(coworkReplyThreadSchema.safeParse({ contactedId: ID, subject: '   ', body: 'Texto' }).success, false);
  assert.equal(coworkReplyThreadSchema.safeParse({ contactedId: ID, subject: 'Hola', body: '' }).success, false);
  assert.equal(coworkReplyThreadSchema.safeParse({ contactedId: ID, subject: 'Hola', body: 'x'.repeat(COWORK_REPLY_BODY_MAX) }).success, true);
  assert.equal(coworkReplyThreadSchema.safeParse({ contactedId: ID, subject: 'Hola', body: 'x'.repeat(COWORK_REPLY_BODY_MAX + 1) }).success, false);
  assert.equal(coworkReplyThreadSchema.safeParse({ contactedId: ID, subject: 'x'.repeat(COWORK_REPLY_SUBJECT_MAX + 1), body: 'Texto' }).success, false);
});

test('the subject carries «Re: » once, however the model wrote it', () => {
  assert.equal(coworkReplySubject('Antecedentes laborales'), 'Re: Antecedentes laborales');
  assert.equal(coworkReplySubject('Re: Antecedentes laborales'), 'Re: Antecedentes laborales');
  assert.equal(coworkReplySubject('RE: Re: Antecedentes laborales'), 'Re: Antecedentes laborales');
  assert.equal(coworkReplySubject('Rv: re : Antecedentes laborales'), 'Re: Antecedentes laborales');
  assert.equal(coworkReplySubject('Reunión de ajuste'), 'Re: Reunión de ajuste', 'a subject that starts with the letters is not a reply prefix');
  assert.equal(coworkReplySubject('Hola\r\nBcc: otra@empresa.cl'), 'Re: Hola Bcc: otra@empresa.cl', 'a line break cannot add a header');
  assert.ok(coworkReplySubject('x'.repeat(1000)).length <= COWORK_REPLY_SUBJECT_MAX);
});

test('the text goes out as written, only with line breaks normalized and no stray spaces or runs of blank lines', () => {
  assert.equal(coworkReplyBody('  Hola Marcela,  \r\n\r\n\r\n\r\nGracias.  '), 'Hola Marcela,\n\nGracias.');
  assert.equal(coworkReplyBody('Una línea\rotra línea'), 'Una línea\notra línea');
  assert.equal(coworkReplyBody('Con\u0000nulo'), 'Connulo');
  assert.equal(coworkReplyBody('   '), '');
  // Lists and single line breaks are kept.
  assert.equal(coworkReplyBody('- uno\n- dos\n\nSaludos'), '- uno\n- dos\n\nSaludos');
});
