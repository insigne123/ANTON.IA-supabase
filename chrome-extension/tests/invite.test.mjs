import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
const source = await readFile(new URL('../prospecting-invite.js', import.meta.url), 'utf8');
const target = 'https://www.linkedin.com/in/ana';
function setup({ connect = true, pending = false, messageOnly = false, navigate = false, noPending = false, dialogAfter = 0 } = {}) {
  let delays = 0;
  let dialogArmed = false;
  const header = `<main><section><h1>Ana</h1>${
    pending ? '<button aria-label="Pendiente">Pendiente</button>' : ''
  }${messageOnly ? '<button>Mensaje</button>' : ''}${
    connect && !pending && !messageOnly ? '<button>Conectar</button>' : ''
  }</section></main>`;
  const dom = new JSDOM(header, { url: target });
  let handler, clicks = 0;
  const doc = dom.window.document;
  doc.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    clicks++;
    if (/^conectar$/i.test(button.textContent.trim())) {
      if (dialogAfter > 0) { dialogArmed = true; return; }
      const dialog = doc.createElement('div'); dialog.setAttribute('role', 'dialog');
      dialog.innerHTML = '<button>Añadir nota</button><button>Enviar sin nota</button>';
      doc.body.append(dialog);
    } else if (/enviar sin nota/i.test(button.textContent)) {
      dialogRemove();
      if (!noPending) {
        const state = doc.createElement('button'); state.setAttribute('aria-label', 'Pendiente');
        state.textContent = 'Pendiente';
        doc.querySelector('main section').append(state);
      }
    }
  });
  function dialogRemove() { doc.querySelector('[role="dialog"]')?.remove(); }
  vm.runInNewContext(source, { URL, document: doc, location: dom.window.location,
    chrome: { runtime: { id: 'ext', onMessage: { addListener: fn => { handler = fn; } } } },
    safeClick: button => button.click(),
    delay: async () => {
      delays++;
      if (navigate && delays === 1) dom.reconfigure({ url: 'https://www.linkedin.com/in/changed' });
      if (dialogArmed && delays >= dialogAfter && !doc.querySelector('[role="dialog"]')) {
        const dialog = doc.createElement('div'); dialog.setAttribute('role', 'dialog');
        dialog.innerHTML = '<button>Añadir nota</button><button>Enviar sin nota</button>';
        doc.body.append(dialog);
        dialogArmed = false;
      }
    },
  });
  const invite = (id = 'op') => new Promise(resolve => handler({ action: 'PROSPECT_EXECUTE_INVITE', operationId: id, profileUrl: target, fullName: 'Ana' }, { id: 'ext' }, resolve));
  return { dom, doc, invite, clicks: () => clicks };
}
test('invite without a note confirms only on observed pending state; replay never clicks again', async () => {
  const env = setup();
  const first = await env.invite();
  assert.equal(first.status, 'confirmed');
  assert.equal(env.clicks(), 2);
  assert.ok(env.doc.querySelector('main [aria-label="Pendiente"]'));
  assert.deepEqual(await env.invite(), first);
  assert.equal(env.clicks(), 2);
});
test('already pending counts as confirmed without clicking', async () => {
  const env = setup({ pending: true, connect: false });
  const result = await env.invite();
  assert.equal(result.status, 'confirmed');
  assert.equal(result.alreadyPending, true);
  assert.equal(env.clicks(), 0);
});
test('first-degree contacts and missing connect never invite', async () => {
  const contact = setup({ messageOnly: true, connect: false });
  assert.match((await contact.invite()).error, /primer grado/);
  const none = setup({ connect: false });
  assert.match((await none.invite()).error, /no ofrece/);
  assert.equal(contact.clicks() + none.clicks(), 0);
});
test('navigation or missing pending state never reports a false confirmation', async () => {
  const moved = setup({ navigate: true, dialogAfter: 5 });
  assert.equal((await moved.invite()).status, 'not_sent');
  const lost = setup({ noPending: true });
  assert.equal((await lost.invite()).status, 'uncertain');
  assert.equal(lost.clicks(), 2);
});
