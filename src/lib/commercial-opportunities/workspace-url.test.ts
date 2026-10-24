import assert from 'node:assert/strict';
import test from 'node:test';
import { WORKSPACE_URL_DEFAULTS, readWorkspaceUrl, workspaceUrl } from './workspace-url';

test('a filtered view has an address a teammate can open, and the plain page keeps its plain one', () => {
  const state = { view: 'list' as const, filter: 'review', source: 'tender' as const, query: ' hospital ', categories: ['aseo' as const], sort: 'amount' as const };
  const url = workspaceUrl('/opportunities', state);
  assert.equal(url, '/opportunities?vista=lista&etapa=review&fuente=tender&q=hospital&rubro=aseo&orden=amount');
  assert.deepEqual(readWorkspaceUrl(url.split('?')[1]), { ...state, query: 'hospital', op: null, section: null });
  assert.equal(workspaceUrl('/opportunities', WORKSPACE_URL_DEFAULTS), '/opportunities');
  assert.equal(workspaceUrl('/opportunities', WORKSPACE_URL_DEFAULTS, 'abc'), '/opportunities?op=abc', 'an open opportunity keeps its own address');
  assert.equal(workspaceUrl('/opportunities', state, 'abc').endsWith('&op=abc'), true, 'and returns to the same filters');
});

test('an address with something unknown opens the default for that part', () => {
  assert.deepEqual(readWorkspaceUrl('vista=tablero&etapa=todo&fuente=twitter&rubro=nada,aseo&orden=barato&q=' + 'x'.repeat(300)),
    { ...WORKSPACE_URL_DEFAULTS, categories: ['aseo'], query: 'x'.repeat(200), op: null, section: null });
  assert.equal(readWorkspaceUrl('etapa=done').filter, 'done', 'a member\'s «Presentadas y cerradas»');
  assert.equal(readWorkspaceUrl('op=123').op, '123');
  assert.equal(readWorkspaceUrl('vista=asistente').view, 'assistant');
});

test('«Mis tareas» has its address, and the link of an email opens the opportunity on the part it speaks of', () => {
  assert.equal(workspaceUrl('/opportunities', { ...WORKSPACE_URL_DEFAULTS, view: 'tasks' }), '/opportunities?vista=tareas');
  assert.equal(readWorkspaceUrl('vista=tareas').view, 'tasks');
  assert.deepEqual([readWorkspaceUrl('op=abc&seccion=tareas').section, readWorkspaceUrl('op=abc&seccion=actividad').section, readWorkspaceUrl('op=abc&seccion=otra').section],
    ['tasks', 'activity', null]);
});

test('the part on screen stays in the address while the opportunity is open, so a reload opens on it', () => {
  const list = { ...WORKSPACE_URL_DEFAULTS, view: 'tasks' as const };
  assert.equal(workspaceUrl('/opportunities', list, 'abc', 'tasks'), '/opportunities?vista=tareas&op=abc&seccion=tareas');
  assert.equal(workspaceUrl('/opportunities', WORKSPACE_URL_DEFAULTS, 'abc', 'contacts'), '/opportunities?op=abc&seccion=contactos');
  assert.equal(workspaceUrl('/opportunities', WORKSPACE_URL_DEFAULTS, 'abc', 'summary'), '/opportunities?op=abc', 'the report is the plain address');
  assert.equal(workspaceUrl('/opportunities', list, null, 'tasks'), '/opportunities?vista=tareas', 'without an opportunity open there is no part of it');
  assert.equal(workspaceUrl('/opportunities', WORKSPACE_URL_DEFAULTS, 'abc', 'unknown'), '/opportunities?op=abc');
  for (const section of ['apply', 'market', 'documents', 'chat', 'tasks', 'contacts', 'activity'])
    assert.equal(readWorkspaceUrl(workspaceUrl('/opportunities', WORKSPACE_URL_DEFAULTS, 'abc', section).split('?')[1]).section, section, section);
});
