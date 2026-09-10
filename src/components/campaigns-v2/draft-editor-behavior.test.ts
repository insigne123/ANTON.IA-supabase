import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import * as behavior from './draft-editor-behavior';
import { quickRewrites, readRewriteProposal, reconcileSavedText, versionConflictMessage } from './draft-editor-behavior';

test('preview protocol accepts a proposal without a draft and preserves the original', () => {
  const draft = { versionId: 'v1', content: { subject: 'Antes', text: 'Original' } };
  const proposal = { subject: 'Después', body: 'Propuesto', expectedVersionId: 'v1' };
  assert.deepEqual(readRewriteProposal({ proposal }, 'v1'), proposal);
  assert.deepEqual(readRewriteProposal({ draft, proposal }, 'v1'), proposal);
  assert.equal(draft.content.text, 'Original');
  assert.equal(draft.versionId, 'v1');
});

test('legacy persisted rewrite responses and stale or malformed proposals fail closed', () => {
  for (const payload of [null, { draft: { content: { subject: 'Legacy', text: 'Persisted' } } },
    { proposal: { subject: 'Asunto', body: 'Mensaje', expectedVersionId: 'v2' } },
    { proposal: { subject: '', body: 'Mensaje', expectedVersionId: 'v1' } },
    { proposal: { subject: 'Asunto', text: 'Wrong field', expectedVersionId: 'v1' } }]) {
    assert.throws(() => readRewriteProposal(payload, 'v1'), /propuesta compatible/);
  }
});

test('quick actions include natural, shorter, and subject-only instructions', () => {
  assert.deepEqual(quickRewrites.map((item) => item.label), ['Más natural', 'Más breve', 'Solo asunto']);
  assert.match(quickRewrites[2].instruction, /cuerpo exactamente sin cambios/);
  assert.match(versionConflictMessage, /Tus cambios se conservan/);
  const originalBody = '  Original\r\n\r\nFirma\n';
  const payload = { proposal: { subject: 'New', body: 'Model changed the body', expectedVersionId: 'v1' } };
  assert.equal(readRewriteProposal(payload, 'v1', originalBody).body, originalBody);
  assert.equal(payload.proposal.body, 'Model changed the body', 'projection does not mutate the response');
  assert.throws(() => readRewriteProposal(payload, 'v2', originalBody), /propuesta compatible/);
});

test('preview limits fail closed and save reconciliation preserves post-request edits', () => {
  assert.throws(() => readRewriteProposal({ proposal: { subject: 'A', body: 'B', expectedVersionId: '' } }, ''), /propuesta compatible/);
  assert.throws(() => readRewriteProposal({ proposal: { subject: 'A'.repeat(999), body: 'B', expectedVersionId: 'v1' } }, 'v1'), /propuesta compatible/);
  assert.throws(() => readRewriteProposal({ proposal: { subject: 'A', body: 'B'.repeat(100_001), expectedVersionId: 'v1' } }, 'v1'), /propuesta compatible/);
  const submitted = { subject: 'Original', body: 'Original body' };
  const saved = { subject: 'Proposed', body: 'Proposed body' };
  assert.deepEqual(reconcileSavedText(submitted, submitted, saved), saved);
  assert.deepEqual(reconcileSavedText({ subject: 'Typed later', body: submitted.body }, submitted, saved), { subject: 'Typed later', body: saved.body });
  assert.deepEqual(reconcileSavedText({ subject: submitted.subject, body: 'Typed later' }, submitted, saved), { subject: saved.subject, body: 'Typed later' });
});

test('both editors send optimistic versions on PATCH and use preview-only rewrite', () => {
  for (const path of ['src/app/(app)/contact/compose/page.tsx', 'src/components/campaigns-v2/FirstContactFollowUpPlan.tsx']) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /method: 'PATCH',[\s\S]*?body: JSON.stringify\(\{[^\n]*expectedVersionId:/);
    assert.match(source, /previewOnly: true/);
    assert.match(source, /response.status === 409\) throw new Error\(versionConflictMessage\)/);
    assert.match(source, /<RewriteProposalReview/);
  }
});

test('legacy composer has a canonical creation gate before any editor or send UI', () => {
  const source = readFileSync('src/app/(app)/contact/compose/page.tsx', 'utf8');
  const gate = source.indexOf('if (!isCanonicalDraft) {');
  assert.ok(gate > 0 && gate < source.indexOf('id="compose-body"'));
  assert.match(source.slice(gate), /fetch\('\/api\/native-drafts'/);
  assert.match(source.slice(gate), /Idempotency-Key/);
  assert.match(source.slice(gate), /Ir a investigar el contacto/);
  assert.match(source, /if \(!isCanonicalDraft \|\| proposal/);
});

test('rendered editors preserve edits across proposals/conflicts/overlapping saves; legacy routes use canonical creation', async () => {
  // Compile the real component in memory; only UI primitives and network dependencies are mocked.
  // The repository's unit loader handles .ts, not TSX. No app/env bootstrap is imported.
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.test/contact/compose', pretendToBeVisual: true });
  const globals = globalThis as any;
  const previous = { window: globals.window, document: globals.document, fetch: globals.fetch, act: globals.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(globals, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client');
  dom.window.confirm = () => true;
  const fields = new Map<string, any>();
  let sheetProps: any;
  let sheetContentProps: any;
  const primitive = React.forwardRef<HTMLElement, any>(function TestPrimitive({ children, ...props }, ref) { return React.createElement('div', { ref, id: props.id }, children); });
  const field = (tag: 'input' | 'textarea') => React.forwardRef<HTMLElement, any>(function TestField(props, ref) {
    fields.set(props.id, props);
    return React.createElement(tag, { ...props, ref });
  });
  const ui = new Proxy({
    Button: React.forwardRef<HTMLButtonElement, any>(function TestButton({ children, variant, size, asChild, ...props }, ref) { return asChild ? React.cloneElement(children, props) : React.createElement('button', { ...props, ref }, children); }),
    Input: field('input'), Textarea: field('textarea'),
    Sheet: (props: any) => { sheetProps = props; return props.open ? React.createElement('div', null, props.children) : null; },
    SheetContent: ({ children, ...props }: any) => { sheetContentProps = props; return React.createElement('div', null, children); },
    AlertDialog: ({ open, children }: any) => open ? React.createElement('div', null, children) : null,
  } as Record<string, any>, { get: (target, name: string) => target[name] || primitive });
  const plan = {
    campaignId: 'campaign', enrollmentId: 'enrollment', campaignName: 'Follow up',
    lifecycleState: 'active', enrollmentState: 'pending_initial_send', nextDueAt: null,
    steps: [1, 2].map((n) => ({
      id: `step${n}`, name: `Follow up ${n}`, kind: 'follow_up', offsetDays: 3,
      state: 'review_required', nativeDraftId: `draft${n}`, dueAt: null,
      draftGeneration: { status: 'ready' },
      draft: { draftId: `draft${n}`, versionId: `v${n}`, subject: `Subject ${n}`, body: `Body ${n}`, lifecycle: 'review_required', approval: { status: 'pending' } },
    })),
  };
  const calls: { url: string; method: string; body: any }[] = [];
  let patchResponse: () => Promise<Response> = async () => new Response('{}', { status: 409 });
  globals.fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method!, body: JSON.parse(String(init.body)) });
    if (init.method === 'PATCH') return patchResponse();
    return url.includes('draft1')
      ? new Response(JSON.stringify({ proposal: { subject: 'Proposed subject', body: 'Proposed body', expectedVersionId: 'v1' } }), { status: 200 })
      : new Response('{}', { status: 409 });
  };
  const require = createRequire(import.meta.url);
  const compile = (path: string, extras: Record<string, unknown> = {}) => {
    const source = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports: any = {};
    new Function('require', 'exports', source)((name: string) => {
      if (name in extras) return extras[name];
      if (name.startsWith('@/components/ui/')) return ui;
      if (name === './draft-editor-behavior') return behavior;
      if (name === '@/lib/utils') return { cn: (...args: unknown[]) => args.filter(Boolean).join(' ') };
      if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
      return require(name);
    }, exports);
    return exports;
  };
  const review = compile('src/components/campaigns-v2/RewriteProposalReview.tsx');
  const { FirstContactFollowUpPlan } = compile('src/components/campaigns-v2/FirstContactFollowUpPlan.tsx', {
    './RewriteProposalReview': review,
    '@/lib/campaigns-v2-client': { loadFirstContactFollowUpPlan: async () => ({ enabled: true, plan }) },
  });
  const root = createRoot(dom.window.document.getElementById('root')!);
  let dirty = false;
  let busy = false;
  const onDirtyChange = (value: boolean) => { dirty = value; };
  const onBusyChange = (value: boolean) => { busy = value; };
  const render = (disabled = false) => React.act(async () => root.render(React.createElement(FirstContactFollowUpPlan, { draftId: 'initial', versionId: 'initial-v1', onDirtyChange, onBusyChange, disabled })));
  const buttons = (label: string) => Array.from(dom.window.document.querySelectorAll('button')).filter((button) => button.textContent?.trim() === label);
  const click = async (label: string, index = 0) => React.act(async () => { assert.ok(buttons(label)[index], label); buttons(label)[index].click(); });
  const type = async (id: string, value: string) => React.act(async () => fields.get(id).onChange({ target: { value } }));
  try {
    await render();
    await click('Toda la secuencia');
    await type('follow-up-ai-note', 'Más directo');
    assert.equal(dirty, true, 'unsubmitted note protects navigation');
    await render(true);
    await React.act(async () => fields.get('follow-up-ai-note').onKeyDown({ ctrlKey: true, key: 'Enter', preventDefault() {} }));
    assert.equal(calls.length, 0, 'keyboard shortcut cannot bypass disabled parent');
    await render(false);
    await click('Solo asunto');
    await click('Preparar propuesta');
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => call.method === 'POST' && call.body.previewOnly === true));
    assert.deepEqual(calls.map((call) => [call.body.expectedVersionId, call.body.campaignStepId, call.body.styleProfileId]), [['v1', 'step1', null], ['v2', 'step2', null]]);
    assert.match(dom.window.document.body.textContent!, /1 de 2 propuestas preparadas/);
    assert.match(dom.window.document.body.textContent!, /Las propuestas ya preparadas se conservan/);
    assert.equal(fields.get('follow-up-subject-step1').value, 'Subject 1', 'preview leaves editor untouched');
    await React.act(async () => sheetProps.onOpenChange(false));
    await React.act(async () => sheetContentProps.onCloseAutoFocus({ preventDefault() {} }));
    assert.equal(dom.window.document.activeElement?.textContent, 'Propuesta sin guardar', 'sheet close focuses the first review, not the last proposal or the mobile textarea');
    await click('Aplicar y guardar');
    assert.deepEqual(calls[2], { url: '/api/native-drafts/draft1', method: 'PATCH', body: { subject: 'Proposed subject', text: 'Body 1', expectedVersionId: 'v1' } });
    assert.match(dom.window.document.body.textContent!, /Existe una versión más reciente/);
    assert.equal(buttons('Aplicar y guardar').length, 1, '409 retains proposal');
    assert.equal(fields.get('follow-up-body-step1').value, 'Body 1');
    await click('Descartar propuesta');
    assert.equal(dirty, false);
    await click('Proponer con IA');
    await click('Solo asunto');
    await click('Preparar propuesta');
    await React.act(async () => sheetProps.onOpenChange(false));
    patchResponse = async () => new Response(JSON.stringify({ draft: { draftId: 'draft1', versionId: 'v1-applied', content: { subject: 'Proposed subject', text: 'Body 1' }, lifecycle: 'review_required', approval: { status: 'pending' } } }), { status: 201 });
    await click('Aplicar y guardar');
    assert.equal(fields.get('follow-up-subject-step1').value, 'Proposed subject');
    assert.equal(fields.get('follow-up-body-step1').value, 'Body 1');
    assert.equal(buttons('Aplicar y guardar').length, 0);
    assert.equal(dirty, false, 'successful apply advances the saved baseline');
    await type('follow-up-subject-step1', 'Manual 1');
    await type('follow-up-subject-step2', 'Manual 2');
    let resolveSave!: (response: Response) => void;
    patchResponse = () => new Promise((resolve) => { resolveSave = resolve; });
    await React.act(async () => {
      const saves = buttons('Guardar cambios');
      saves[0].click();
      saves[1].click(); // Same tick, before disabled props render.
    });
    assert.equal(calls.length, 6, 'synchronous operation lock prevents overlapping sequence writes');
    assert.equal(busy, true);
    await type('follow-up-subject-step1', 'Typed after request'); // Deliberately bypass disabled input to probe response reconciliation.
    await React.act(async () => resolveSave(new Response(JSON.stringify({ draft: { draftId: 'draft1', versionId: 'v1-next', content: { subject: 'Manual 1', text: 'Body 1' }, lifecycle: 'review_required', approval: { status: 'pending' } } }), { status: 201 })));
    assert.equal(fields.get('follow-up-subject-step1').value, 'Typed after request');
    assert.equal(fields.get('follow-up-subject-step2').value, 'Manual 2', 'saving one step does not replace sibling edits');
    assert.equal(dirty, true);
    assert.equal(busy, false);

    // Exercise the canonical page's real callbacks too, without loading app services or providers.
    let params = new URLSearchParams('draftId=canonical');
    let report: any = null;
    let replacement = '';
    let followUpProps: any;
    const savedDraft = { draftId: 'canonical', versionId: 'c1', channel: 'email', organizationId: 'org', recipient: { leadRef: 'lead', displayName: 'Contact', email: 'contact@example.com' }, content: { subject: 'Saved subject', text: 'Saved body' }, lifecycle: 'review_required', approval: { status: 'pending' }, preflight: { status: 'passed' } };
    calls.length = 0;
    globals.fetch = async (url: string, init?: RequestInit) => {
      if (!init?.method) return new Response(JSON.stringify(url.startsWith('/api/email-styles') ? { styles: [] } : { draft: savedDraft }));
      calls.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
      if (url === '/api/native-drafts') {
        assert.equal((init.headers as Record<string, string>)['Idempotency-Key'], 'native-draft:snapshot-1');
        return new Response(JSON.stringify({ draft: savedDraft }), { status: 201 });
      }
      if (init.method === 'PATCH') return new Response('{}', { status: 409 });
      return new Response(JSON.stringify({ proposal: { subject: 'New subject', body: 'New body', expectedVersionId: 'c1' } }));
    };
    const modules: Record<string, any> = {
      'next/link': { default: ({ children, ...props }: any) => React.createElement('a', props, children) },
      'next/navigation': { useSearchParams: () => params, useRouter: () => ({ back() {}, replace: (href: string) => { replacement = href; } }) },
      '@/hooks/use-toast': { useToast: () => ({ toast() {} }) },
      '@/hooks/use-contactability': { useContactability: () => ({ loading: false, error: null, result: null }) },
      '@/lib/campaign-qa': { assessCampaignQa: () => ({ status: 'passed', checks: [], reviewCount: 0 }) },
      '@/lib/email-utils': { extractPrimaryEmail: (lead: any) => ({ email: lead?.email || '' }) },
      '@/lib/lead-research-storage': { findReportForLead: () => report },
      '@/lib/services/profile-service': { profileService: { getCurrentProfile: async () => null } },
      '@/lib/services/enriched-leads-service': { enrichedLeadsStorage: { findEnrichedLeadById: async () => ({ id: 'legacy', fullName: 'Legacy contact', email: 'contact@example.com' }) } },
      '@/components/campaigns-v2/RewriteProposalReview': review,
      '@/components/campaigns-v2/draft-editor-behavior': behavior,
      '@/components/campaigns-v2/useComposeUnsavedGuard': { useComposeUnsavedGuard() {} },
      '@/components/campaigns-v2/FirstContactFollowUpPlan': { FirstContactFollowUpPlan: (props: any) => { followUpProps = props; return null; } },
      '@/components/commercial/ContactabilityStatusCard': { ContactabilityStatusCard: () => null },
      '@/components/commercial/CampaignQaPanel': { CampaignQaPanel: () => null },
    };
    // Import-only legacy utilities are intentionally inert: they must not generate or send anything.
    for (const match of readFileSync('src/app/(app)/contact/compose/page.tsx', 'utf8').matchAll(/from '(@\/lib\/[^']+)'/g)) modules[match[1]] ??= {};
    const { default: ComposePage } = compile('src/app/(app)/contact/compose/page.tsx', modules);
    await React.act(async () => root.render(React.createElement(ComposePage)));
    await React.act(async () => followUpProps.onDirtyChange(true));
    assert.equal(fields.get('compose-subject').disabled, true, 'pending sequence work locks its initial context');
    assert.equal(buttons('Más natural')[0].disabled, true);
    await React.act(async () => followUpProps.onDirtyChange(false));
    await click('Más natural');
    assert.deepEqual(calls[0], { url: '/api/native-drafts/canonical/rewrite', method: 'POST', body: { instruction: quickRewrites[0].instruction, previewOnly: true, styleProfileId: null, expectedVersionId: 'c1' } });
    assert.equal(fields.get('compose-subject').value, 'Saved subject');
    assert.equal(followUpProps.disabled, true, 'initial proposal prevents sequence mutation');
    await React.act(async () => {
      fields.get('compose-subject').onChange({ target: { value: 'Same-tick edit' } });
      buttons('Aplicar y guardar')[0].click();
    });
    assert.equal(calls.length, 1, 'apply cannot overwrite an edit before React rerenders');
    await type('compose-subject', 'Saved subject');
    await click('Aplicar y guardar');
    assert.deepEqual(calls[1], { url: '/api/native-drafts/canonical', method: 'PATCH', body: { subject: 'New subject', text: 'New body', expectedVersionId: 'c1' } });
    assert.equal(buttons('Aplicar y guardar').length, 1);
    assert.equal(fields.get('compose-body').value, 'Saved body');
    await click('Descartar propuesta');
    await type('compose-subject', 'Manual canonical');
    await click('Guardar cambios');
    assert.equal(calls[2].body.expectedVersionId, 'c1');
    assert.equal(fields.get('compose-subject').value, 'Manual canonical', 'manual PATCH conflict retains edits');
    await type('compose-subject', 'Saved subject');
    await click('Solo asunto');
    await click('Aplicar y guardar');
    assert.equal(calls.at(-1)?.body.text, 'Saved body', 'subject-only apply projects the original body on the client');
    await click('Descartar propuesta');
    await click('Solo asunto');
    let resolveApply!: (response: Response) => void;
    globals.fetch = () => new Promise((resolve) => { resolveApply = resolve; });
    await click('Aplicar y guardar');
    await React.act(async () => {
      fields.get('compose-body').onChange({ target: { value: 'Typed during apply' } });
      resolveApply(new Response(JSON.stringify({ draft: { ...savedDraft, versionId: 'c2', content: { subject: 'New subject', text: 'Saved body' } } }), { status: 201 }));
    });
    assert.equal(fields.get('compose-body').value, 'Typed during apply', 'apply response preserves same-tick typing');
    assert.equal(fields.get('compose-subject').value, 'New subject');
    assert.equal(buttons('Aplicar y guardar').length, 0);
    await type('compose-body', 'Saved body');
    let resolvePreview!: (response: Response) => void;
    globals.fetch = () => new Promise((resolve) => { resolvePreview = resolve; });
    await click('Más natural');
    await type('compose-body', 'Typed during preview');
    await React.act(async () => resolvePreview(new Response(JSON.stringify({ proposal: { subject: 'Late', body: 'Late body', expectedVersionId: 'c2' } }))));
    assert.equal(buttons('Aplicar y guardar').length, 0, 'late preview cannot lock or replace newly typed text');
    assert.equal(fields.get('compose-body').value, 'Typed during preview');
    globals.fetch = async (url: string, init?: RequestInit) => {
      if (!init?.method) return new Response(JSON.stringify({ styles: [] }));
      calls.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ draft: savedDraft }), { status: 201 });
    };
    params = new URLSearchParams('id=legacy&subject=Fake%20ready&body=Do%20not%20send');
    await React.act(async () => root.render(React.createElement(ComposePage)));
    assert.equal(dom.window.document.querySelector('#compose-subject'), null);
    assert.equal(buttons('Enviar correo').length, 0);
    assert.match(dom.window.document.body.textContent!, /necesita una investigación actualizada/);
    report = { raw: { research_snapshot_id: 'snapshot-1' } };
    await React.act(async () => root.render(React.createElement(ComposePage)));
    await click('Crear borrador para revisar');
    assert.deepEqual(calls.at(-1)?.body, { researchSnapshotId: 'snapshot-1' });
    assert.equal(replacement, '/contact/compose?draftId=canonical');
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    Object.assign(globals, { window: previous.window, document: previous.document, fetch: previous.fetch, IS_REACT_ACT_ENVIRONMENT: previous.act });
  }
});
