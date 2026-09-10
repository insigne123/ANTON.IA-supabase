import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useComposeUnsavedGuard } from './useComposeUnsavedGuard';

test('unsaved guard protects links/unload, restores Back, allows Forward, and skips clean sentinel', async () => {
  const url = 'https://app.test/contact/compose?draftId=one';
  const dom = new JSDOM('<div id="root"></div><a id="leave" href="/saved/leads/enriched">Salir</a><a id="hash" href="#editor">Editor</a><a id="mail" href="mailto:test@example.com">Email</a>', { url });
  const globals = globalThis as any;
  const previous = { window: globals.window, document: globals.document, act: globals.IS_REACT_ACT_ENVIRONMENT };
  globals.window = dom.window;
  globals.document = dom.window.document;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  let confirms = 0;
  let allow = false;
  dom.window.confirm = () => { confirms += 1; return allow; };
  let backCalls = 0;
  let forwardCalls = 0;
  dom.window.history.back = () => { backCalls += 1; };
  dom.window.history.forward = () => { forwardCalls += 1; };
  const base = { __NA: true, tree: 'compose', composeUnsavedBase: url };
  const sentinel = { ...base, composeUnsavedGuard: url };
  function Guard({ dirty }: { dirty: boolean }) { useComposeUnsavedGuard(dirty); return null; }
  const root = createRoot(dom.window.document.getElementById('root')!);
  const render = (dirty: boolean) => act(async () => root.render(createElement(StrictMode, null, createElement(Guard, { dirty }))));
  const pop = (state: object, href = url) => {
    dom.window.history.replaceState(state, '', href);
    dom.window.dispatchEvent(new dom.window.PopStateEvent('popstate', { state }));
  };
  const click = (id: string, options = {}) => {
    const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true, ...options });
    // Prevent jsdom's unimplemented native navigation after the document capture listener ran.
    const anchor = dom.window.document.getElementById(id)!;
    let guarded = false;
    anchor.addEventListener('click', (e) => { e.preventDefault(); }, { once: true });
    anchor.dispatchEvent(event);
    guarded = confirms > 0;
    return { event, guarded };
  };
  try {
    dom.window.history.replaceState({ __NA: true, tree: 'compose' }, '', url);
    await render(true);
    assert.equal(dom.window.history.length, 2, 'Strict Mode does not duplicate the sentinel');
    const unload = new dom.window.Event('beforeunload', { cancelable: true });
    dom.window.dispatchEvent(unload);
    assert.equal(unload.defaultPrevented, true);
    click('hash'); click('mail'); click('leave', { ctrlKey: true });
    assert.equal(confirms, 0, 'same-document/external-app/new-tab actions do not discard edits');
    assert.equal(click('leave').event.defaultPrevented, true);
    assert.equal(confirms, 1);
    allow = true;
    click('leave');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const cancelledNavigationUnload = new dom.window.Event('beforeunload', { cancelable: true });
    dom.window.dispatchEvent(cancelledNavigationUnload);
    assert.equal(cancelledNavigationUnload.defaultPrevented, true, 'cancelled accepted navigation must not disable future unload guards');
    allow = false;
    pop(base);
    assert.equal(backCalls, 0);
    assert.equal(forwardCalls, 1, 'cancel Back restores the existing sentinel, not a new entry');
    pop(sentinel);
    assert.equal(confirms, 3, 'restoration does not prompt twice');
    await render(false);
    await render(true);
    assert.equal(dom.window.history.length, 2, 'dirty/clean cycles do not grow history');
    // A cancelled jump/Forward must restore both URL and the compose router tree.
    pop({ __NA: true, tree: 'other' }, 'https://app.test/campaigns');
    assert.equal(dom.window.location.href, url);
    assert.equal(dom.window.history.state.tree, 'compose');
    allow = true;
    pop({ __NA: true, tree: 'other' }, 'https://app.test/campaigns');
    assert.equal(backCalls, 0, 'accepted Forward does not incorrectly navigate Back');
    pop(sentinel);
    await render(false);
    await render(true);
    pop(base);
    assert.equal(backCalls, 1, 'accepted Back skips only the same-URL sentinel');
    await render(false);
    const cleanUnload = new dom.window.Event('beforeunload', { cancelable: true });
    dom.window.dispatchEvent(cleanUnload);
    assert.equal(cleanUnload.defaultPrevented, false);
    pop(base);
    assert.equal(backCalls, 2, 'clean Back also skips the sentinel without confirmation');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    globals.window = previous.window;
    globals.document = previous.document;
    globals.IS_REACT_ACT_ENVIRONMENT = previous.act;
  }
});
