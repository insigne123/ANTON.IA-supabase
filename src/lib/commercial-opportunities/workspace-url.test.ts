import assert from 'node:assert/strict';
import test from 'node:test';
import { WORKSPACE_URL_DEFAULTS, readWorkspaceUrl, workspaceUrl } from './workspace-url';

test('a filtered view has an address a teammate can open, and the plain page keeps its plain one', () => {
  const state = { view: 'list' as const, filter: 'review', source: 'tender' as const, query: ' hospital ', categories: ['aseo' as const], sort: 'amount' as const };
  const url = workspaceUrl('/opportunities', state);
  assert.equal(url, '/opportunities?vista=lista&etapa=review&fuente=tender&q=hospital&rubro=aseo&orden=amount');
  assert.deepEqual(readWorkspaceUrl(url.split('?')[1]), { ...state, query: 'hospital', op: null });
  assert.equal(workspaceUrl('/opportunities', WORKSPACE_URL_DEFAULTS), '/opportunities');
  assert.equal(workspaceUrl('/opportunities', WORKSPACE_URL_DEFAULTS, 'abc'), '/opportunities?op=abc', 'an open opportunity keeps its own address');
  assert.equal(workspaceUrl('/opportunities', state, 'abc').endsWith('&op=abc'), true, 'and returns to the same filters');
});

test('an address with something unknown opens the default for that part', () => {
  assert.deepEqual(readWorkspaceUrl('vista=tablero&etapa=todo&fuente=twitter&rubro=nada,aseo&orden=barato&q=' + 'x'.repeat(300)),
    { ...WORKSPACE_URL_DEFAULTS, categories: ['aseo'], query: 'x'.repeat(200), op: null });
  assert.equal(readWorkspaceUrl('etapa=done').filter, 'done', 'a member\'s «Presentadas y cerradas»');
  assert.equal(readWorkspaceUrl('op=123').op, '123');
  assert.equal(readWorkspaceUrl('vista=asistente').view, 'assistant');
});
