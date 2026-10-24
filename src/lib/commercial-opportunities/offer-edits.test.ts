import assert from 'node:assert/strict';
import test from 'node:test';
import { clampOfferDraft } from './offer-draft';
import { editOfferPart, lastOfferEdit, offerEditSchema, offerPartEdit, offerPartName, offerPartPrompt, offerPartText, offerReviewHolds, offerRewriteSchema,
  withOfferEdits, withPartEdit } from './offer-edits';

const draft = clampOfferDraft({
  summary: 'Ofrecemos el servicio de aseo integral con [N.º de años] de experiencia.',
  technical: [
    { heading: 'Experiencia', criterion: 'Experiencia del oferente', weight: '40 %', body: 'Hemos prestado servicios a [clientes del sector salud].', evidence: [] },
    { heading: 'Plan de trabajo', criterion: 'Metodología', weight: '30 %', body: 'Turnos de lunes a domingo.', evidence: [] },
  ],
  compliance: [{ requirement: 'Dotación mínima de 12 auxiliares', answer: 'Cumplimos con 12 auxiliares.', evidence: [] }],
  economic: { lines: [], priceBasis: 'net', validity: '', paymentTerms: '', notes: [] },
  letter: '[nombre de la empresa] presenta su oferta.',
  missing: [],
});
const ANA = '00000000-0000-4000-8000-000000000011';

test('each part has its AI text and its name; a part the draft does not have is nothing', () => {
  assert.deepEqual(['letter', 'summary', 'technical:1', 'compliance:0'].map(part => offerPartText(draft, part)),
    ['[nombre de la empresa] presenta su oferta.', draft.summary, 'Turnos de lunes a domingo.', 'Cumplimos con 12 auxiliares.']);
  assert.equal(offerPartText(draft, 'technical:7'), null);
  assert.equal(offerPartText(draft, 'prices'), null);
  assert.equal(offerPartName(draft, 'technical:1'), 'la sección «Plan de trabajo»');
  assert.equal(offerPartName(draft, 'letter'), 'la carta de presentación');
});

test('an edit replaces the text the page shows and the Word carries; the AI\'s text stays under it, to go back to', () => {
  const edited = editOfferPart(draft, 'technical:1', { text: '  Turnos de 7 a 22 h, de lunes a domingo, con un supervisor por turno.\r\n', by: ANA, at: '2026-10-24T15:00:00.000Z' });
  assert.deepEqual(offerPartEdit(edited, 'technical:1'), { text: 'Turnos de 7 a 22 h, de lunes a domingo, con un supervisor por turno.', by: ANA, at: '2026-10-24T15:00:00.000Z' });
  const shown = withOfferEdits(edited);
  assert.equal(shown.technical[1].body, 'Turnos de 7 a 22 h, de lunes a domingo, con un supervisor por turno.');
  assert.equal(shown.technical[0].body, draft.technical[0].body, 'the other parts as the AI wrote them');
  assert.equal(edited.technical[1].body, 'Turnos de lunes a domingo.', 'the AI\'s text is kept');
  const back = editOfferPart(edited, 'technical:1', { text: null, by: ANA, at: '2026-10-24T16:00:00.000Z' });
  assert.equal(offerPartEdit(back, 'technical:1'), null);
  assert.equal(withOfferEdits(back).technical[1].body, 'Turnos de lunes a domingo.');
  assert.equal(offerPartEdit(editOfferPart(draft, 'letter', { text: ' [nombre de la empresa] presenta su oferta. ', by: ANA, at: 'x' }), 'letter'), null,
    'the same text as the AI\'s is no edit');
  assert.throws(() => editOfferPart(draft, 'technical:9', { text: 'x', by: ANA, at: 'x' }));
});

test('the page shows the edit the server saved without reading again', () => {
  const edit = { text: 'Cumplimos con 14 auxiliares.', by: ANA, at: '2026-10-24T15:00:00.000Z' };
  const withEdit = withPartEdit(draft, 'compliance:0', edit);
  assert.equal(withOfferEdits(withEdit).compliance[0].answer, 'Cumplimos con 14 auxiliares.');
  assert.equal(offerPartEdit(withPartEdit(withEdit, 'compliance:0', null), 'compliance:0'), null);
});

test('«Revisado por» holds until someone changes a part after it', () => {
  const edited = editOfferPart(draft, 'summary', { text: 'Ofrecemos aseo integral para recintos de salud.', by: ANA, at: '2026-10-24T15:00:00.000Z' });
  assert.equal(lastOfferEdit(draft), null);
  assert.equal(lastOfferEdit(edited), '2026-10-24T15:00:00.000Z');
  assert.equal(offerReviewHolds(draft), false, 'nobody reviewed it yet');
  assert.equal(offerReviewHolds({ ...edited, review: { by: ANA, at: '2026-10-24T16:00:00.000Z' } }), true);
  assert.equal(offerReviewHolds({ ...edited, review: { by: ANA, at: '2026-10-24T14:00:00.000Z' } }), false, 'changed after the review');
});

test('what the page sends is checked: a known part, a bounded text, and indications of a few words at least', () => {
  const draftId = '00000000-0000-4000-8000-000000009631';
  assert.equal(offerEditSchema.safeParse({ draftId, part: 'technical:3', text: 'Nuevo texto', base: null }).success, true);
  assert.equal(offerEditSchema.safeParse({ draftId, part: 'economic', text: 'x', base: null }).success, false);
  assert.equal(offerEditSchema.safeParse({ draftId, part: 'letter', text: null, base: '2026-10-24T15:00:00.000Z' }).success, true, 'back to the AI\'s text');
  assert.equal(offerRewriteSchema.safeParse({ draftId, part: 'summary', instructions: 'ok', base: null, requestId: draftId }).success, false);
  assert.equal(offerRewriteSchema.safeParse({ draftId, part: 'summary', instructions: 'Más breve', base: null, requestId: draftId }).success, true);
});

test('the rewrite of one part sends that part, what to change and the rules of the draft', () => {
  const prompt = offerPartPrompt({ opportunity: { title: 'Aseo Hospital de Castro', buyer: 'Hospital de Castro' }, draft, part: 'technical:1', text: draft.technical[1].body,
    instructions: 'Agrega que hay un supervisor por turno', company: { offer: 'Aseo hospitalario', services: ['Aseo'], territories: ['Los Lagos'], exclusions: [] }, report: null });
  assert.match(prompt, /^Reescribe la sección «Plan de trabajo» del borrador de oferta/);
  assert.match(prompt, /LO QUE PIDE EL EQUIPO: Agrega que hay un supervisor por turno/);
  assert.match(prompt, /SECCION: \{"titulo":"Plan de trabajo","criterio":"Metodología","ponderacion":"30 %"\}/);
  assert.match(prompt, /TEXTO ACTUAL: "Turnos de lunes a domingo\."/);
  assert.match(prompt, /Nunca inventes experiencia/);
  assert.doesNotMatch(prompt, /CUERPO de la carta/);
  assert.match(offerPartPrompt({ opportunity: { title: 'x', buyer: null }, draft, part: 'letter', text: draft.letter, instructions: 'Más formal', company: { offer: '', services: [], territories: [], exclusions: [] }, report: null }),
    /Es solo el CUERPO de la carta/);
});
