// Plan 2, F4: staging, preview and execution of a contacts import, over an in-memory stand-in of the
// tables and the uploads. No database, storage, providers, secrets or env files.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const RUN = '00000000-0000-4000-8000-000000000031';
const USER = '00000000-0000-4000-8000-0000000000aa';
const ORG = '00000000-0000-4000-8000-0000000000bb';
const encode = text => new TextEncoder().encode(text);

const state = {
  workStatus: 'running', runStatus: 'waiting_approval', access: true,
  uploads: {},
  leads: [{ id: 'l1', name: 'Marcela Rojas', email: 'mrojas@sodexo.cl', company: 'Sodexo Chile', user_id: USER, organization_id: ORG }],
  staged: null, upserts: 0,
};
globalThis.__coworkImport = state;
const flag = process.env.COWORK_CONTACTS_IMPORT_ENABLED;
process.env.COWORK_CONTACTS_IMPORT_ENABLED = 'true';

/** A PostgREST-like builder over the in-memory tables: only what the module uses. */
function table(name) {
  const s = globalThis.__coworkImport;
  const query = { filters: [], range: null, pending: null, order: null };
  const rows = () => {
    if (name === 'leads') {
      const found = s.leads.filter(row => query.filters.every(([column, value]) => row[column] === value));
      return query.order ? [...found].sort((a, b) => String(a[query.order]).localeCompare(String(b[query.order]))) : found;
    }
    return [];
  };
  const result = () => {
    if (query.pending) return query.pending();
    const all = rows();
    return { data: query.range ? all.slice(query.range[0], query.range[1] + 1) : all, error: null };
  };
  const builder = {
    select: () => builder,
    eq: (column, value) => { query.filters.push([column, value]); return builder; },
    order: column => { query.order = column; if (name === 'leads') s.leadsOrder = column; return builder; },
    range: (from, to) => { query.range = [from, to]; return builder; },
    maybeSingle: async () => {
      if (query.pending) return query.pending(true);
      if (name === 'cowork_runs') return { data: { status: s.workStatus }, error: null };
      if (name === 'cowork_contacts_import_proposals') return { data: s.staged, error: null };
      return { data: rows()[0] ?? null, error: null };
    },
    upsert: (values, options) => {
      s.upserts++;
      if (name === 'cowork_contacts_import_proposals') {
        query.pending = () => {
          if (s.staged && options.ignoreDuplicates) return { data: null, error: null };
          s.staged = JSON.parse(JSON.stringify(values));
          return { data: { run_id: values.run_id }, error: null };
        };
      }
      if (name === 'leads') {
        query.pending = () => {
          const inserted = [];
          for (const row of values) {
            if (s.leads.some(lead => lead.id === row.id)) continue;
            s.leads.push(row);
            inserted.push({ id: row.id });
          }
          return { data: inserted, error: null };
        };
      }
      return builder;
    },
    then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
  };
  return builder;
}
state.table = table;

const sources = {
  '@/lib/server/supabase-admin': 'export const getSupabaseAdminClient=()=>({from:t=>globalThis.__coworkImport.table(t)});',
  './access': 'export const requireCoworkWorkerAccess=async()=>{if(!globalThis.__coworkImport.access)throw new Error("denied");};',
  './runs': 'export const getCoworkRun=async()=>({run:{status:globalThis.__coworkImport.runStatus},events:[]});',
  './extended-reads': `export async function findCoworkUpload(client,scope,value){
      const asked=String(value).toLowerCase();const hash=asked.lastIndexOf('#');
      const file=hash>0&&!globalThis.__coworkImport.uploads[asked]?asked.slice(0,hash).trim():asked;
      const sheet=hash>0&&file!==asked?asked.slice(hash+1).trim():'';
      if(!globalThis.__coworkImport.uploads[file])return{found:false,missing:{found:false,name:file}};
      return{found:true,upload:{name:file,sheet,runId:'r',size:globalThis.__coworkImport.uploads[file].length}};}
    export async function downloadCoworkUpload(client,scope,upload){return globalThis.__coworkImport.uploads[upload.name];}`,
  '@/lib/messaging-contracts': 'export const deterministicMessagingUuid=s=>{const h=require("node:crypto").createHash("sha256").update(s).digest("hex");return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};',
};
const result = await build({
  entryPoints: ['src/lib/server/cowork/contacts-import.ts'],
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'isolated-import-dependencies', setup(build) {
    build.onResolve({ filter: /^(@\/lib\/server\/supabase-admin|\.\/access|\.\/runs|\.\/extended-reads|@\/lib\/messaging-contracts)$/ },
      args => ({ path: args.path, namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: sources[args.path], loader: 'js' }));
  } }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, loaded, loaded.exports);
const { stageCoworkContactsImport, readCoworkContactsImportPreview, executeCoworkContactsImport, hashCoworkContactsImport } = loaded.exports;
const scope = { userId: USER, organizationId: ORG };
const auth = { user: { id: USER }, organizationId: ORG };
const refusal = async (input, pattern) => assert.rejects(stageCoworkContactsImport(scope, RUN, input), pattern);

// A fair list as exported from a spreadsheet in Chile: «;», one person already saved, one repeated,
// one without a name, one with an address that is not one, and a phone column no contact has.
state.uploads['asistentes-feria.csv'] = encode([
  'Nombre;Correo;Empresa;Cargo;Teléfono',
  'Camila Fuentes;cfuentes@adecco.cl;Adecco;Analista de Selección;+56 9 1111 1111',
  'Tomás Riquelme;triquelme@walmart.cl;Walmart Chile;Jefe de Reclutamiento;',
  'Marcela Rojas;MRojas@sodexo.cl;Sodexo Chile;Gerente de Personas;',
  ';;Sin nombre;;',
  'Daniela Soto;no-es-correo;Cencosud;HR Business Partner;',
  'Camila Fuentes;cfuentes@adecco.cl;Adecco;;',
].join('\r\n'));
try {
  // 1. Staging: the whole file read, its columns mapped and what is saved or repeated left out.
  const staged = await stageCoworkContactsImport(scope, RUN, { file: 'asistentes-feria.csv' });
  assert.equal(staged.label, 'Importar 3 contactos de asistentes-feria.csv (2 ya estaban)');
  assert.match(staged.hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(state.staged.contacts.map(contact => contact.name), ['Camila Fuentes', 'Tomás Riquelme', 'Daniela Soto']);
  assert.deepEqual(state.staged.column_map, { name: 'Nombre', email: 'Correo', company: 'Empresa', title: 'Cargo' });
  assert.deepEqual([state.staged.total_rows, state.staged.duplicates, state.staged.skipped, state.staged.sheet], [6, 2, 1, null]);
  assert.equal(state.leadsOrder, 'id', 'saved contacts are read page by page in a stable order');
  assert.equal(state.staged.contacts[2].email, null, 'an address that is not one is left out, the person stays');
  assert.equal(state.staged.patch_hash, staged.hash);
  // Proposing again the same import keeps it; another import in the same work is refused.
  assert.equal((await stageCoworkContactsImport(scope, RUN, { file: 'asistentes-feria.csv' })).hash, staged.hash);
  state.uploads['otra.csv'] = encode('Nombre;Correo\nAna Díaz;adiaz@x.cl');
  await refusal({ file: 'otra.csv' }, /otra importación/);

  // 2. The card: the file, which column is which, the contacts and what was left out; pinned by the target.
  const preview = await readCoworkContactsImportPreview(auth, RUN, `contactsimport:${staged.hash}`);
  assert.deepEqual(preview.columns.map(column => `${column.label} ← ${column.header}`), ['Nombre ← Nombre', 'Correo ← Correo', 'Cargo ← Cargo', 'Empresa ← Empresa']);
  assert.deepEqual([preview.count, preview.total, preview.duplicates, preview.skipped, preview.withoutEmail, preview.overLimit], [3, 6, 2, 1, 1, 0]);
  assert.equal(preview.matches, true);
  assert.equal((await readCoworkContactsImportPreview(auth, RUN, `contactsimport:${'f'.repeat(64)}`)).matches, false, 'another target does not match');

  // 3. Execution: exactly the staged contacts, in the contacts Cowork searches, once.
  const before = state.leads.length;
  // With the flag off, an approved import does not run: the flag is the switch that stops it.
  delete process.env.COWORK_CONTACTS_IMPORT_ENABLED;
  await assert.rejects(executeCoworkContactsImport(auth, RUN, `contactsimport:${staged.hash}`), /desactivada por ahora: no se guardó ningún contacto/);
  assert.equal(state.leads.length, before);
  process.env.COWORK_CONTACTS_IMPORT_ENABLED = 'true';
  const done = await executeCoworkContactsImport(auth, RUN, `contactsimport:${staged.hash}`);
  assert.equal(done.reply, 'Importé 3 contactos de asistentes-feria.csv a tus contactos.');
  assert.deepEqual(done.result, { file: 'asistentes-feria.csv', imported: 3, alreadySaved: 0, withoutEmail: 1 });
  const added = state.leads.slice(before);
  assert.deepEqual(added.map(lead => [lead.name, lead.email, lead.company, lead.title, lead.status, lead.source_provider, lead.user_id, lead.organization_id]), [
    ['Camila Fuentes', 'cfuentes@adecco.cl', 'Adecco', 'Analista de Selección', 'saved', 'cowork_import', USER, ORG],
    ['Tomás Riquelme', 'triquelme@walmart.cl', 'Walmart Chile', 'Jefe de Reclutamiento', 'saved', 'cowork_import', USER, ORG],
    ['Daniela Soto', null, 'Cencosud', 'HR Business Partner', 'saved', 'cowork_import', USER, ORG],
  ]);
  assert.ok(added.every(lead => /^[0-9a-f-]{36}$/.test(lead.id)));
  const again = await executeCoworkContactsImport(auth, RUN, `contactsimport:${staged.hash}`);
  assert.equal(again.result.imported, 0, 'approving twice saves nobody twice');
  assert.match(again.reply, /No hubo contactos nuevos/);
  assert.equal(state.leads.length, before + 3);

  // A staged import changed after the proposal is refused, and so is another target.
  state.staged = { ...state.staged, contacts: [...state.staged.contacts, { name: 'Intrusa', email: 'x@x.cl', title: null, company: null, linkedinUrl: null, location: null }] };
  await assert.rejects(executeCoworkContactsImport(auth, RUN, `contactsimport:${staged.hash}`), /cambió desde tu revisión/);
  await assert.rejects(executeCoworkContactsImport(auth, RUN, 'enrichbatch:abc'), /no es válida/);

  // 4. Refusals say why, in words the model can pass on.
  state.staged = null;
  await refusal({ file: 'no-existe.csv' }, /No encontré «no-existe\.csv»/);
  state.uploads['sin-nombre.csv'] = encode('Correo;Empresa\na@x.cl;X');
  await refusal({ file: 'sin-nombre.csv' }, /columna con el nombre de cada persona; las columnas del archivo son «Correo», «Empresa»/);
  await refusal({ file: 'sin-nombre.csv', columns: { name: 'Persona' } }, /no tiene la columna «Persona»; sus columnas son «Correo», «Empresa»/);
  state.uploads['ya-estan.csv'] = encode('Nombre,Correo\nMarcela Rojas,mrojas@sodexo.cl\nCamila Fuentes,cfuentes@adecco.cl');
  await refusal({ file: 'ya-estan.csv' }, /No hay contactos nuevos: las 2 personas del archivo ya están en tus contactos/);
  state.uploads['brief.pdf'] = encode('%PDF-1.4');
  await refusal({ file: 'brief.pdf' }, /CSV, un Excel \(\.xlsx\) o una lista JSON/);
  state.uploads['viejo.xls'] = encode('x');
  await refusal({ file: 'viejo.xls' }, /\.xls antiguo/);
  state.workStatus = 'completed';
  await refusal({ file: 'asistentes-feria.csv' }, /ya no admite propuestas/);
  state.workStatus = 'running';

  // 5. An Excel: the sheet asked for, a header that the guess would miss named by the model, and the limit.
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Resumen'], ['Total', 3]]), 'Resumen');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['Quién', 'Dónde trabaja', 'Mail'],
    ...Array.from({ length: 510 }, (_, index) => [`Persona ${index}`, `Empresa ${index % 7}`, `p${index}@empresa${index % 7}.cl`]),
  ]), 'Prospectos');
  state.uploads['prospectos.xlsx'] = new Uint8Array(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
  const excel = await stageCoworkContactsImport(scope, RUN, { file: 'prospectos.xlsx#prospectos', columns: { name: 'quien', company: 'donde trabaja' } });
  assert.equal(excel.label, 'Importar 500 contactos de prospectos.xlsx');
  assert.equal(state.staged.sheet, 'Prospectos');
  assert.deepEqual(state.staged.column_map, { name: 'Quién', company: 'Dónde trabaja', email: 'Mail' });
  const limited = await readCoworkContactsImportPreview(auth, RUN, `contactsimport:${excel.hash}`);
  assert.deepEqual([limited.count, limited.total, limited.overLimit, limited.contacts.length], [500, 510, 10, 8], 'the page gets only the rows the card shows and counts the rest');
  assert.equal(hashCoworkContactsImport(RUN, 'prospectos.xlsx', 'Prospectos', state.staged.contacts), excel.hash);
  console.log('PASS: whole file read and mapped, saved and repeated people left out, card pinned to the proposal, exact and idempotent save, stopped by the flag, refusals with reasons, Excel sheet and limit.');
} finally {
  delete globalThis.__coworkImport;
  if (flag === undefined) delete process.env.COWORK_CONTACTS_IMPORT_ENABLED; else process.env.COWORK_CONTACTS_IMPORT_ENABLED = flag;
}
