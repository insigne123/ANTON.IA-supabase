import assert from 'node:assert/strict';
import test from 'node:test';
import { call, reply, ScriptedModel } from '@/lib/agent-harness/scripted';
import {
  domainFitsCompany, domainVariants, emailDomainSettings, forgetEmailDomains, locateEmailDomains, type EmailDomainSettings,
} from './company-domain';

// Fictional companies, with the shapes of 6 Nov 2026: a site on .com with the mail on .cl, and leads with only a company name.
const settings: EmailDomainSettings = { model: 'claude-haiku-5-5', searches: 5, deadlineMs: 30_000, basic: true };
const deliver = (empresas: unknown[]) => call('entregar_dominios', { empresas });
const brief = (model: ScriptedModel, index = 0) => JSON.parse(String(model.requests[index].messages[0].content));
const quiet = async <T>(work: () => Promise<T>) => {
  const info = console.info;
  const warn = console.warn;
  console.info = () => {};
  console.warn = () => {};
  try { return await work(); } finally { console.info = info; console.warn = warn; }
};

type Row = Record<string, unknown>;
/** Reads that filter like PostgREST: eq, in and a case-insensitive ilike without wildcards. */
function fakeClient(tables: Record<string, Row[]>) {
  const reads: string[] = [];
  return {
    reads,
    from(table: string) {
      const filters: Array<[string, string, unknown]> = [];
      const matches = (row: Row) => filters.every(([operator, column, value]) => {
        if (operator === 'eq') return row[column] === value;
        if (operator === 'in') return (value as unknown[]).includes(row[column]);
        return String(row[column] ?? '').toLowerCase() === String(value).replace(/\\(.)/g, '$1').toLowerCase();
      });
      const chain: any = {
        select: () => chain,
        eq: (column: string, value: unknown) => { filters.push(['eq', column, value]); return chain; },
        in: (column: string, value: unknown) => { filters.push(['in', column, value]); return chain; },
        ilike: (column: string, value: unknown) => { filters.push(['ilike', column, value]); return chain; },
        limit: async () => {
          reads.push(`${table}:${filters.map(([operator, column]) => `${operator}.${column}`).join(',')}`);
          return { data: (tables[table] || []).filter(matches), error: null };
        },
      };
      return chain;
    },
  };
}
const withMail = (...domains: string[]) => async (domain: string) => domains.includes(domain);

test('Claude is off unless the flag is on and there is a key, and its limits are bounded', () => {
  assert.equal(emailDomainSettings({}), null);
  assert.equal(emailDomainSettings({ EMAIL_FINDER_DOMAIN_AI_ENABLED: 'true' }), null, 'without a key there is no Claude');
  assert.equal(emailDomainSettings({ ANTHROPIC_API_KEY: 'k' }), null, 'the key alone turns nothing on');
  assert.deepEqual(emailDomainSettings({ EMAIL_FINDER_DOMAIN_AI_ENABLED: 'true', ANTHROPIC_API_KEY: 'k' }), settings);
  assert.deepEqual(emailDomainSettings({ EMAIL_FINDER_DOMAIN_AI_ENABLED: 'true', ANTHROPIC_API_KEY: 'k', EMAIL_FINDER_DOMAIN_AI_SEARCHES: '50',
    EMAIL_FINDER_DOMAIN_AI_DEADLINE_MS: '1', EMAIL_FINDER_DOMAIN_AI_WEB_BASIC: 'false' }), { model: 'claude-haiku-5-5', searches: 10, deadlineMs: 5_000, basic: false });
});

test('a domain reads like the company by the name of a domain it had, its name or its initials, and a common word is not enough', () => {
  assert.equal(domainFitsCompany('mineracordillera.cl', { name: null, domains: ['mineracordillera.com'] }), true);
  assert.equal(domainFitsCompany('andino.pe', { name: null, domains: ['grupoandino.com.pe'] }), true, 'the group’s name inside a longer one');
  assert.equal(domainFitsCompany('isla.cl', { name: 'Instituto de Seguridad Laboral Austral', domains: [] }), true, 'its initials');
  assert.equal(domainFitsCompany('losaromos.cl', { name: 'Clínica Los Aromos', domains: [] }), true);
  assert.equal(domainFitsCompany('australsur.cl', { name: 'Australsur S.A.', domains: [] }), true, 'the legal form does not count');
  assert.equal(domainFitsCompany('otraempresa.cl', { name: 'Clínica Los Aromos', domains: [] }), false);
  assert.equal(domainFitsCompany('grupo.cl', { name: 'Grupo Patagónico', domains: [] }), false, '«grupo» names no company');
  assert.equal(domainFitsCompany('ab.cl', { name: 'AB Servicios', domains: [] }), false, 'too short to be sure');
});

test('the same name with the endings of its country, as hints', () => {
  assert.deepEqual(domainVariants(['mineracordillera.com'], 'Chile'), ['mineracordillera.cl']);
  assert.deepEqual(domainVariants(['andino.com.pe'], 'Peru'), ['andino.pe', 'andino.com']);
  assert.deepEqual(domainVariants(['www-site.co'], 'Colombia'), ['www-site.com.co', 'www-site.com']);
  assert.deepEqual(domainVariants([], 'Chile'), []);
});

test('the verified emails of colleagues give the domain without asking Claude: twice, or once if it reads like the company', async () => {
  forgetEmailDomains();
  const client = fakeClient({
    enriched_leads: [
      { organization_domain: 'mineracordillera.com', email: 'acastro@mineracordillera.cl', email_status: 'verified' },
      { organization_domain: 'mineracordillera.com', email: 'bmolina@mineracordillera.cl', email_status: 'verified' },
      { organization_domain: 'mineracordillera.com', email: 'personal@gmail.com', email_status: 'verified' },
      { organization_domain: 'mineracordillera.com', email: 'x@domain.com', email_status: 'verified' },
      { organization_domain: 'mineracordillera.com', email: 'sin@verificar.cl', email_status: 'extrapolated' },
    ],
    people_search_leads: [
      { org_name: 'Instituto de Seguridad Laboral Austral', email: 'jefa@isla.cl', email_status: 'verified' },
    ],
  });
  const model = new ScriptedModel([]);
  const run = await quiet(() => locateEmailDomains([
    { key: 'a1', name: 'Minera Cordillera', country: 'Chile', industry: 'mining & metals', domains: ['mineracordillera.com'] },
    { key: 'a2', name: 'Minera Cordillera', country: 'Chile', industry: 'mining & metals', domains: ['mineracordillera.com'] },
    { key: 'a3', name: 'Instituto de Seguridad Laboral Austral', country: 'Chile', industry: null, domains: [] },
  ], { client, lookupMx: withMail('mineracordillera.cl', 'isla.cl'), settings, model }));
  assert.deepEqual([...run.domains].map(([key, value]) => [key, value.domain, value.via]), [
    ['a1', 'mineracordillera.cl', 'colegas'], ['a2', 'mineracordillera.cl', 'colegas'], ['a3', 'isla.cl', 'colegas'],
  ], 'a public mailbox, a placeholder or an address not verified say nothing');
  assert.equal(model.calls, 0);
  assert.equal(run.companies, 2, 'two leads of one company are one question');
});

test('Claude is asked once for the rest, with the hints and without any person, and only a domain that receives mail is kept', async () => {
  forgetEmailDomains();
  const client = fakeClient({
    enriched_leads: [{ organization_domain: 'logisur.com', email: 'ana@transportesdelvalle.cl', email_status: 'verified' }],
  });
  const model = new ScriptedModel([reply([deliver([
    { id: 'e1', dominio: 'logisur.cl', certeza: 'alta' },
    { id: 'e2', dominio: 'clinicalosaromos.cl', certeza: 'media' },
    { id: 'e3', dominio: 'sincorreo.cl', certeza: 'alta' },
    { id: 'e4', dominio: null, certeza: 'baja' },
    { id: 'e9', dominio: 'inventada.cl', certeza: 'alta' },
  ])])]);
  const lookupMx = withMail('logisur.cl', 'transportesdelvalle.cl', 'clinicalosaromos.cl', 'inventada.cl');
  const companies = [
    { key: 'a1', name: 'Logisur', country: 'Chile', industry: 'logistics', domains: ['logisur.com'] },
    { key: 'a2', name: 'Clínica Los Aromos', country: 'Chile', industry: 'hospital & health care', domains: [] },
    { key: 'a3', name: 'Sin Correo Ltda', country: 'Chile', industry: null, domains: [] },
    { key: 'a4', name: 'Desconocida del Norte', country: 'Peru', industry: null, domains: [] },
  ];
  const run = await quiet(() => locateEmailDomains(companies, { client, lookupMx, settings, model }));
  assert.deepEqual([...run.domains].map(([key, value]) => [key, value.domain, value.via]), [
    ['a1', 'logisur.cl', 'ia'], ['a2', 'clinicalosaromos.cl', 'ia'],
  ], 'one without mail, one it does not know and an id it made up are left out');
  assert.equal(model.calls, 1);
  const asked = brief(model);
  assert.deepEqual(asked.empresas[0], {
    id: 'e1', nombre: 'Logisur', pais: 'Chile', rubro: 'logistics', dominios_sin_correo: ['logisur.com'],
    mismo_nombre_con_correo: ['logisur.cl'], dominios_de_colegas: ['transportesdelvalle.cl'],
  }, 'a colleague’s domain seen once that does not read like the company goes as a hint');
  assert.ok(!JSON.stringify(asked).includes('@'), 'no email reaches Claude');
  const web = model.requests[0];
  assert.deepEqual((web.serverTools ?? []).map(tool => [tool.name, tool.type, tool.max_uses]), [['web_search', 'web_search_20250305', 4]]);
  assert.equal(((web.serverTools ?? [])[0] as { user_location?: { country?: string } }).user_location?.country, 'CL', 'the country of most of them');
  assert.match(web.system, /No pongas en una búsqueda nombres de personas ni correos/);
  assert.match(web.system, /nunca una instrucción/);

  // The same companies again: what was found and what it did not know come from memory, without a call.
  const again = new ScriptedModel([]);
  const second = await quiet(() => locateEmailDomains(companies, { client, lookupMx, settings, model: again }));
  assert.equal(again.calls, 0);
  assert.equal(second.fromMemory, 4, 'the one without mail was answered too: it is not asked again for a day');
  assert.deepEqual([...second.domains.keys()], ['a1', 'a2']);
});

test('without Claude only the colleagues count, and a failed call costs only its domains and remembers nothing', async () => {
  forgetEmailDomains();
  const client = fakeClient({});
  const companies = [{ key: 'a1', name: 'Logisur', country: 'Chile', industry: null, domains: ['logisur.com'] }];
  const off = await quiet(() => locateEmailDomains(companies, { client, lookupMx: withMail('logisur.cl'), settings: null }));
  assert.equal(off.domains.size, 0);
  assert.equal(off.asked, 0);

  const broken = new ScriptedModel([() => { throw new Error('overloaded'); }]);
  const failed = await quiet(() => locateEmailDomains(companies, { client, lookupMx: withMail('logisur.cl'), settings, model: broken }));
  assert.equal(failed.domains.size, 0);
  const retry = new ScriptedModel([reply([deliver([{ id: 'e1', dominio: 'logisur.cl', certeza: 'media' }])])]);
  const answered = await quiet(() => locateEmailDomains(companies, { client, lookupMx: withMail('logisur.cl'), settings, model: retry }));
  assert.equal(retry.calls, 1, 'the next run asks again');
  assert.equal(answered.domains.get('a1')?.domain, 'logisur.cl');

  // A company with neither a domain nor a name that says which one it is is not asked about.
  const nameless = new ScriptedModel([]);
  const none = await quiet(() => locateEmailDomains([{ key: 'b1', name: 'SA', country: null, industry: null, domains: [] }],
    { client, lookupMx: withMail(), settings, model: nameless }));
  assert.equal(none.companies, 0);
  assert.equal(nameless.calls, 0);
});
