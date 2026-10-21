import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import * as fullName from '@/lib/profile/full-name';

const compiled = ts.transpileModule(readFileSync('src/components/profile/FullNamePrompt.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;

type Profile = { id: string; full_name: string | null } | null;

/** The component in a DOM of its own, with the profile service and the dialog replaced by plain tags. */
async function withPrompt(
  profileService: { getCurrentProfile: () => Promise<Profile>; updateProfile: (updates: { full_name?: string | null }) => Promise<unknown> },
  run: (ctx: { dom: JSDOM; exports: any; contentProps: any[]; root: ReturnType<typeof createRoot> }) => Promise<void>,
) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.example.test/home' });
  const globals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors = globals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const contentProps: any[] = [];
  const primitive = (tag: string) => function TestPrimitive(props: any) { return React.createElement(tag, props); };
  const modules: Record<string, any> = {
    react: React,
    'lucide-react': { Loader2: primitive('svg'), UserRound: primitive('svg') },
    '@/components/ui/button': { Button: primitive('button') },
    '@/components/ui/input': { Input: primitive('input') },
    '@/components/ui/label': { Label: primitive('label') },
    '@/components/ui/dialog': {
      Dialog: ({ open, children }: any) => (open ? React.createElement('div', { role: 'dialog' }, children) : null),
      DialogContent: ({ children, ...props }: any) => { contentProps.push(props); return React.createElement('div', null, children); },
      DialogHeader: primitive('header'),
      DialogTitle: primitive('h2'),
      DialogDescription: primitive('p'),
      DialogFooter: primitive('footer'),
    },
    '@/lib/profile/full-name': fullName,
    '@/lib/services/profile-service': { profileService },
  };
  const exports: any = {};
  new Function('require', 'exports', 'React', compiled)((name: string) => {
    assert.ok(name in modules, `Unexpected dependency ${name}`);
    return modules[name];
  }, exports, React);
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await run({ dom, exports, contentProps, root });
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    globals.forEach((key, index) => {
      if (descriptors[index]) Object.defineProperty(globalThis, key, descriptors[index]!);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
}

const typeName = async (dom: JSDOM, value: string) => {
  const element = dom.window.document.getElementById('full-name-prompt') as HTMLInputElement;
  const propsKey = Object.keys(element).find((key) => key.startsWith('__reactProps'))!;
  await act(async () => { (element as any)[propsKey].onChange({ target: { value } }); });
};
const submit = (dom: JSDOM) => act(async () => {
  dom.window.document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
});

test('the prompt has no way out but its own button, and asks for a name and surname before saving', async () => {
  const updates: unknown[] = [];
  const saved: string[] = [];
  await withPrompt({ getCurrentProfile: async () => null, updateProfile: async (u) => { updates.push(u); return {}; } }, async ({ dom, exports, contentProps, root }) => {
    await act(async () => { root.render(React.createElement(exports.FullNamePrompt, { open: true, onSaved: (name: string) => saved.push(name) })); });
    const body = dom.window.document.body;
    assert.match(body.textContent!, /¿Cómo te llamas\?/);
    assert.ok(dom.window.document.querySelector('label[for="full-name-prompt"]'));
    // No «Cerrar», and Escape or a click outside never dismiss it.
    assert.equal(contentProps.at(-1).hideClose, true);
    for (const key of ['onEscapeKeyDown', 'onPointerDownOutside', 'onInteractOutside']) {
      let prevented = false;
      contentProps.at(-1)[key]({ preventDefault: () => { prevented = true; } });
      assert.equal(prevented, true, key);
    }
    await submit(dom);
    assert.match(body.textContent!, /Escribe tu nombre y apellido\./);
    await typeName(dom, 'Nicolás');
    await submit(dom);
    assert.match(body.textContent!, /nombre y apellido, por ejemplo/);
    assert.equal(dom.window.document.getElementById('full-name-prompt')!.getAttribute('aria-invalid'), 'true');
    assert.equal(dom.window.document.querySelector('[role="alert"]')!.id, 'full-name-prompt-error');
    assert.equal(dom.window.document.getElementById('full-name-prompt')!.getAttribute('aria-describedby'), 'full-name-prompt-error');
    assert.equal(updates.length, 0);
    assert.equal(saved.length, 0);
    // Typing again clears the message.
    await typeName(dom, 'Nicolás Yarur');
    assert.equal(dom.window.document.querySelector('[role="alert"]'), null);
  });
});

test('saves the name as written in the profile (own row) and tells the app', async () => {
  const updates: Array<{ full_name?: string | null }> = [];
  const saved: string[] = [];
  await withPrompt({ getCurrentProfile: async () => null, updateProfile: async (u) => { updates.push(u); return {}; } }, async ({ dom, exports, root }) => {
    await act(async () => { root.render(React.createElement(exports.FullNamePrompt, { open: true, onSaved: (name: string) => saved.push(name) })); });
    await typeName(dom, '  Vicente   Espinoza  ');
    await submit(dom);
    assert.deepEqual(updates, [{ full_name: 'Vicente Espinoza' }]);
    assert.deepEqual(saved, ['Vicente Espinoza']);
    // A second submit while it closes saves nothing more.
    await submit(dom);
    assert.equal(updates.length, 1);
  });
});

test('a failed save says so, keeps what was typed and lets the person try again', async () => {
  let attempts = 0;
  const saved: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await withPrompt({
    getCurrentProfile: async () => null,
    updateProfile: async () => { attempts += 1; if (attempts === 1) throw new Error('network'); await gate; return {}; },
  }, async ({ dom, exports, root }) => {
    await act(async () => { root.render(React.createElement(exports.FullNamePrompt, { open: true, onSaved: (name: string) => saved.push(name) })); });
    await typeName(dom, 'Vicente Espinoza');
    await submit(dom);
    assert.match(dom.window.document.body.textContent!, /No pudimos guardar tu nombre/);
    assert.equal((dom.window.document.getElementById('full-name-prompt') as HTMLInputElement).value, 'Vicente Espinoza');
    assert.equal(saved.length, 0);
    // The second try is on its way: the field and the button wait, and a second click does not send it twice.
    await submit(dom);
    assert.equal(dom.window.document.querySelector('button')!.hasAttribute('disabled'), true);
    assert.match(dom.window.document.body.textContent!, /Guardando…/);
    assert.equal((dom.window.document.getElementById('full-name-prompt') as HTMLInputElement).hasAttribute('disabled'), true);
    await submit(dom);
    assert.equal(attempts, 2);
    release();
    await act(async () => {});
    assert.deepEqual(saved, ['Vicente Espinoza']);
  });
});

test('nothing shows while the prompt is closed', async () => {
  await withPrompt({ getCurrentProfile: async () => null, updateProfile: async () => ({}) }, async ({ dom, exports, root }) => {
    await act(async () => { root.render(React.createElement(exports.FullNamePrompt, { open: false, onSaved: () => {} })); });
    assert.equal(dom.window.document.querySelector('[role="dialog"]'), null);
  });
});

test('the app asks only the accounts without a name, and never blocks on a profile it cannot read', async () => {
  const cases: Array<{ read: () => Promise<Profile>; userId: string | null; expected: string }> = [
    { read: async () => ({ id: 'u1', full_name: null }), userId: 'u1', expected: 'missing' },
    { read: async () => ({ id: 'u1', full_name: '   ' }), userId: 'u1', expected: 'missing' },
    { read: async () => ({ id: 'u1', full_name: 'Ana Pérez' }), userId: 'u1', expected: 'done' },
    { read: async () => null, userId: 'u1', expected: 'done' },
    { read: async () => { throw new Error('offline'); }, userId: 'u1', expected: 'done' },
    { read: async () => ({ id: 'u1', full_name: null }), userId: null, expected: 'checking' },
  ];
  for (const { read, userId, expected } of cases) {
    await withPrompt({ getCurrentProfile: read, updateProfile: async () => ({}) }, async ({ dom, exports, root }) => {
      function Probe() {
        const { state } = exports.useFullNamePrompt(userId);
        return React.createElement('output', null, state);
      }
      await act(async () => { root.render(React.createElement(Probe)); });
      await act(async () => {});
      assert.equal(dom.window.document.querySelector('output')!.textContent, expected);
    });
  }
});

test('once the name is saved the app marks it done', async () => {
  await withPrompt({ getCurrentProfile: async () => ({ id: 'u1', full_name: null }), updateProfile: async () => ({}) }, async ({ dom, exports, root }) => {
    let finish!: () => void;
    function Probe() {
      const { state, onSaved } = exports.useFullNamePrompt('u1');
      finish = onSaved;
      return React.createElement('output', null, state);
    }
    await act(async () => { root.render(React.createElement(Probe)); });
    await act(async () => {});
    assert.equal(dom.window.document.querySelector('output')!.textContent, 'missing');
    await act(async () => { finish(); });
    assert.equal(dom.window.document.querySelector('output')!.textContent, 'done');
  });
});
