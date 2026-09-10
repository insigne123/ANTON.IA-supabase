import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import * as validation from '@/lib/profile/password-change';

const compiled = ts.transpileModule(readFileSync('src/components/profile/password-change-form.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;

test('password form updates only the signed-in account, handles reauthentication and clears secrets', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.example.test/profile' });
  const globals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const descriptors = globals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const updates: any[] = [];
  let reauth = 0;
  const exports: any = {};
  const primitive = (tag: string) => function TestPrimitive(props: any) { return React.createElement(tag, props); };
  const modules: Record<string, any> = {
    react: React,
    '@/context/AuthContext': { useAuth: () => ({ user: { id: 'current-user', identities: [{ provider: 'email' }] }, loading: false }) },
    '@/lib/supabase': { supabase: { auth: {
      updateUser: async (attributes: any) => { updates.push(attributes); return { error: updates.length === 1 ? { code: 'reauthentication_needed' } : null }; },
      reauthenticate: async () => { reauth++; return { error: null }; },
    } } },
    '@/lib/profile/password-change': validation,
    '@/components/ui/button': { Button: primitive('button') },
    '@/components/ui/input': { Input: primitive('input') },
    '@/components/ui/label': { Label: primitive('label') },
    '@/components/ui/card': Object.fromEntries(['Card', 'CardContent', 'CardDescription', 'CardHeader', 'CardTitle'].map((key) => [key, primitive('div')])),
  };
  new Function('require', 'exports', 'React', compiled)((name: string) => {
    assert.ok(name in modules, `Unexpected dependency ${name}`);
    return modules[name];
  }, exports, React);
  const root = createRoot(dom.window.document.getElementById('root')!);
  const input = async (id: string, value: string) => {
    const element = dom.window.document.getElementById(id) as HTMLInputElement;
    // Invoke the rendered React handler without depending on ReactDOM's import-time DOM detection.
    const propsKey = Object.keys(element).find((key) => key.startsWith('__reactProps'))!;
    await act(async () => { (element as any)[propsKey].onChange({ target: { value } }); });
  };
  const submit = () => act(async () => { dom.window.document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
  try {
    await act(async () => { root.render(React.createElement(exports.PasswordChangeForm)); });
    await input('current-password', 'old-password');
    await input('new-password', 'new-password');
    await input('confirm-password', 'mismatch');
    await submit();
    assert.equal(updates.length, 0);
    assert.match(dom.window.document.body.textContent!, /no coinciden/);
    await input('confirm-password', 'new-password');
    await submit();
    assert.equal(reauth, 1);
    assert.ok(dom.window.document.getElementById('password-code'));
    await input('password-code', '123456');
    await submit();
    assert.deepEqual(updates[1], { password: 'new-password', current_password: 'old-password', nonce: '123456' });
    assert.equal((dom.window.document.getElementById('new-password') as HTMLInputElement).value, '');
    assert.equal((dom.window.document.getElementById('current-password') as HTMLInputElement).value, '');
    assert.match(dom.window.document.body.textContent!, /Contrasena actualizada/);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    globals.forEach((key, index) => {
      if (descriptors[index]) Object.defineProperty(globalThis, key, descriptors[index]!);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});
