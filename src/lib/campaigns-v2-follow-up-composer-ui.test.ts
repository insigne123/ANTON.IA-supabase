import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const composerSource = readFileSync('src/components/campaigns-v2/FirstContactFollowUpPlan.tsx', 'utf8');
const composeSource = readFileSync('src/app/(app)/contact/compose/page.tsx', 'utf8');

test('follow-up composer is inline below the initial email and receives compose state', () => {
  const editorBody = composeSource.indexOf('id="compose-body"');
  const inlineComposer = composeSource.indexOf('<FirstContactFollowUpPlan', editorBody);
  const aside = composeSource.indexOf('<aside', editorBody);

  assert.ok(editorBody >= 0 && inlineComposer > editorBody && aside > inlineComposer);
  assert.match(composeSource.slice(inlineComposer, aside), /styleProfiles=\{styleProfiles\}/);
  assert.match(composeSource.slice(inlineComposer, aside), /disabled=\{nativeDraftArchived \|\| hasNativeEdits/);
  assert.equal(composeSource.indexOf('<FirstContactFollowUpPlan', inlineComposer + 1), -1);
});

test('empty setup stays inline and generates an automatic progressive cadence', () => {
  assert.match(composerSource, /Añadir seguimientos/);
  assert.match(composerSource, /¿Cómo deberían sentirse\?/);
  assert.match(composerSource, /\[1, 2, 3, 4\]\.map/);
  assert.match(composerSource, /const FOLLOW_UP_OFFSETS = \[3, 4, 5, 7\]/);
  assert.match(composerSource, /styleProfileId: styleProfileId \|\| null/);
  assert.match(composerSource, /sequenceInstruction: instruction/);
  assert.match(composerSource, /steps: buildFollowUpSteps\(followUpCount\)/);
  assert.match(composerSource, /Generar \{followUpCount\}/);
  assert.doesNotMatch(composerSource, /SheetTrigger/);
});

test('generated drafts remain editable, retryable, and stable while generation runs', () => {
  assert.match(composerSource, /<GenerationSkeleton count=\{followUpCount\}/);
  assert.match(composerSource, /aria-busy="true"/);
  assert.match(composerSource, /<ol className="divide-y/);
  assert.match(composerSource, /Día \{day\}/);
  assert.match(composerSource, /Guardar cambios/);
  assert.match(composerSource, /method: 'PATCH'/);
  assert.match(composerSource, /retryFirstContactFollowUpDraft\(\{ draftId, stepId \}\)/);
  assert.match(composerSource, /Reintentar generación/);
});

test('AI notes save local edits first and global notes preserve sequential partial progress', () => {
  const rewriteFunction = composerSource.slice(
    composerSource.indexOf('async function rewriteDraft'),
    composerSource.indexOf('async function generatePlan'),
  );
  assert.ok(rewriteFunction.indexOf('await patchDraft(stepId)') < rewriteFunction.indexOf('/rewrite`'));
  assert.match(rewriteFunction, /method: 'POST'/);
  assert.match(composerSource, /for \(const \[index, step\] of generatedSteps\.entries\(\)\) \{[\s\S]+await rewriteDraft\(step\.id, coherentInstruction/);
  assert.match(composerSource, /Mantén coherencia entre todos los seguimientos/);
  assert.match(composerSource, /Los demás seguimientos conservaron sus cambios/);
  assert.match(composerSource, /await loadPlan\(undefined, false\)/);
  assert.match(composerSource, /todos los seguimientos\. El correo inicial no cambiará/);
  assert.match(composerSource, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(composerSource, /side="bottom"/);
  assert.match(composerSource, /sm:right-0[\s\S]+sm:h-full[\s\S]+sm:max-w-lg/);
});

test('dirty and busy follow-up state fences send and navigation in compose', () => {
  assert.match(composerSource, /onDirtyChange\?: \(dirty: boolean\) => void/);
  assert.match(composerSource, /onBusyChange\?: \(busy: boolean\) => void/);
  assert.match(composeSource, /onDirtyChange=\{setFollowUpDirty\}/);
  assert.match(composeSource, /onBusyChange=\{setFollowUpBusy\}/);
  assert.match(composeSource, /\|\| followUpDirty[\s\S]+\|\| followUpBusy/);
  assert.match(composeSource, /beforeunload/);
});
