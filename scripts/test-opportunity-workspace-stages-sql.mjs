// Isolated Postgres/WASM. No dotenv, credentials, HTTP, fixtures or writes outside this in-memory database.
// opportunity_workspace_page and opportunity_workspace_counts (20261024150000) against the lists they replace: the same rows in the
// same order for every view the old ones had, and the stages of the pipeline for the new ones.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
if (!process.env.PGLITE_MODULE) throw Error('Explicit PGLITE_MODULE required');
const { PGlite } = createRequire(import.meta.url)(process.env.PGLITE_MODULE);
const db = new PGlite();
const org = '01100000-0000-4000-8000-000000000001', other = '01100000-0000-4000-8000-000000000002';
const admin = '01200000-0000-4000-8000-000000000001', member = '01200000-0000-4000-8000-000000000002', outsider = '01200000-0000-4000-8000-000000000003', stranger = '01200000-0000-4000-8000-000000000004';
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
// A seeded generator: the same dataset every run.
let seed = 7; const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = list => list[Math.floor(random() * list.length)];
const uuid = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
try {
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema storage;
    create table auth.users(id uuid primary key);create table organizations(id uuid primary key);
    create table organization_members(organization_id uuid,user_id uuid,role text);
    create table organization_reporting_groups(id uuid primary key,organization_id uuid,is_active boolean);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid,bucket_id text);alter table storage.objects enable row level security;
    create function is_organization_admin(uuid,uuid) returns boolean language sql as $$select exists(select 1 from organization_members where organization_id=$1 and user_id=$2 and role in ('admin','owner'))$$;
    insert into organizations values('${org}'),('${other}');insert into auth.users values('${admin}'),('${member}'),('${outsider}'),('${stranger}');
    insert into organization_members values('${org}','${admin}','admin'),('${org}','${member}','member'),('${other}','${outsider}','admin');`);
  for (const file of ['20261002170000_commercial_opportunities.sql', '20261012160000_opportunity_workspace_assignments.sql', '20261012162000_opportunity_jobs_and_budget.sql',
    '20261012164000_opportunity_document_expedients.sql', '20261012165000_opportunity_workspace_reads.sql', '20261020120000_opportunity_workspace_list_kinds.sql',
    '20261022150000_opportunity_workspace_list_terms.sql', '20261024150000_opportunity_workspace_stages.sql']) await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));

  // 240 opportunities of both workspaces, of every kind, evaluation and deadline, some with the same score (the order breaks ties).
  const words = ['Servicio de guardias', 'Aseo industrial', 'Software de remuneraciones', 'Reclutamiento masivo', 'Mantención de ascensores', 'Outsourcing de casino'];
  const rows = [];
  for (let n = 1; n <= 240; n++) {
    const kind = pick(['tender', 'tender', 'compra_agil', 'hiring', 'linkedin_post', 'private']);
    const evaluation = pick(['recommended', 'review', 'review', 'pending', 'excluded', null]);
    const deadline = pick(['past', 'future', 'future', null]);
    rows.push({ id: uuid('01300000', n), org: n % 12 === 0 ? other : org, kind, title: `${pick(words)} ${n}`, company: pick(['Municipalidad de Providencia', 'Hospital del Salvador', 'Constructora Andes', null]),
      buyer: kind === 'tender' || kind === 'compra_agil' ? pick(['Servicio de Salud Metropolitano', 'Universidad de Chile']) : null,
      score: pick([10, 35, 50, 50, 72, 72, 90]), amount: pick([null, null, 1500000, 48000000, 230000000]),
      deadline: deadline === 'past' ? `now()-interval '${1 + Math.floor(random() * 40)} days'` : deadline === 'future' ? `now()+interval '${1 + Math.floor(random() * 60)} days'` : 'null',
      updated: `now()-interval '${Math.floor(random() * 500)} minutes'`, data: { ...(evaluation ? { evaluation } : {}), ...(random() < 0.3 ? { summary: { text: `Contrato de ${pick(words).toLowerCase()} por 24 meses` } } : {}) } });
  }
  for (const r of rows) await query(`insert into commercial_opportunities(id,organization_id,kind,dedupe_key,title,company_name,buyer_name,score,amount,deadline_at,updated_at,data)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,${r.deadline},${r.updated},$10)`, [r.id, r.org, r.kind, `key-${r.id}`, r.title, r.company, r.buyer, r.score, r.amount, r.data]);
  // A team works 60 of them, in every stage; the member is on half of those. A few were left unassigned after an assignment.
  const states = ['unassigned', 'assigned', 'working', 'blocked', 'submitted', 'won', 'lost', 'archived'];
  const worked = rows.filter(r => r.org === org).slice(0, 60);
  for (const [i, r] of worked.entries()) {
    const state = states[i % states.length];
    await query('insert into opportunity_work(organization_id,opportunity_id,state,revision) values($1,$2,$3,1)', [org, r.id, state]);
    if (i % 2 === 0 && state !== 'unassigned') await query('insert into opportunity_participants(organization_id,opportunity_id,user_id) values($1,$2,$3)', [org, r.id, member]);
  }

  const ids = list => list.map(row => row.id);
  const oldList = (user, view, q, page, kinds, terms) => query('select id from opportunity_workspace_list_terms($1,$2,$3,$4,$5,$6,$7)', [org, user, view, q, page, kinds, terms]).then(ids);
  const page = (user, { stages = [], evaluations = [], q = '', kinds = [], terms = [], biddable = false, sort = 'priority', limit = 100, offset = 0, workspace = org } = {}) =>
    query('select id,kind,deadline_at,amount,score,data from opportunity_workspace_page($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [workspace, user, stages, evaluations, q, kinds, terms, biddable, sort, limit, offset]);
  const counts = (user, { q = '', kinds = [], terms = [], biddable = false, workspace = org } = {}) =>
    query('select stage,evaluation,total::int as total from opportunity_workspace_counts($1,$2,$3,$4,$5,$6)', [workspace, user, q, kinds, terms, biddable]);
  const WORKED = ['assigned', 'working', 'blocked', 'submitted', 'won', 'lost', 'archived'];

  // The same rows in the same order as the lists they replace, for every view, word, source and page.
  let compared = 0;
  for (const kinds of [[], ['tender'], ['tender', 'compra_agil']]) for (const q of ['', 'guard', 'salud']) for (const terms of [[], ['aseo', 'guardia']]) for (const p of [0, 1]) {
    const same = async (user, view, options) => { assert.deepEqual(ids(await page(user, { q, kinds, terms, offset: p * 100, ...options })), await oldList(user, view, q, p, kinds, terms), `${view} ${q} ${kinds} ${terms} ${p}`); compared++; };
    await same(admin, 'all', {});
    for (const view of ['recommended', 'review', 'excluded']) await same(admin, view, { evaluations: [view] });
    await same(admin, 'assigned', { stages: WORKED });
    await same(member, 'recommended', {});
    for (const state of ['assigned', 'working', 'blocked', 'submitted']) await same(member, state, { stages: [state] });
    await same(outsider, 'all', {});
  }

  // «Por revisar» of the pipeline: nobody works it, the AI left it to review (or has not evaluated it yet) and it can still be bid.
  const review = await page(admin, { stages: ['open'], evaluations: ['review', 'pending'], biddable: true, limit: 600 });
  const workOf = new Map(worked.map((r, i) => [r.id, states[i % states.length]]));
  assert.ok(review.length > 10);
  for (const row of review) {
    assert.ok(!workOf.has(row.id) || workOf.get(row.id) === 'unassigned', 'a worked opportunity leaves «Por revisar»');
    assert.ok(['review', 'pending'].includes(row.data.evaluation ?? (row.kind === 'private' ? 'review' : null)));
    assert.ok(row.deadline_at === null || Date.parse(row.deadline_at) > Date.now(), 'what closed cannot be bid');
  }
  const expected = rows.filter(r => r.org === org && (!workOf.has(r.id) || workOf.get(r.id) === 'unassigned') && ['review', 'pending'].includes(r.data.evaluation ?? (r.kind === 'private' ? 'review' : null)) && r.deadline !== `past` && !String(r.deadline).startsWith('now()-'));
  assert.equal(review.length, expected.length, 'every open one to review is there');
  // An opportunity unassigned after an assignment is open again; a worked one is in its stage whatever its deadline.
  assert.ok((await page(admin, { stages: ['open'], limit: 600 })).some(row => workOf.get(row.id) === 'unassigned'));
  for (const state of WORKED) assert.equal((await page(admin, { stages: [state], biddable: true, limit: 600 })).length, worked.filter(r => workOf.get(r.id) === state).length, `${state} keeps its closed ones`);

  // The counts are the pages' sizes, stage by stage and evaluation by evaluation, with the same words and read rules.
  for (const [user, options] of [[admin, {}], [admin, { biddable: true }], [admin, { kinds: ['tender'], q: 'servicio' }], [admin, { terms: ['aseo'] }], [member, {}], [outsider, {}]]) {
    const groups = await counts(user, options);
    const total = groups.reduce((sum, group) => sum + group.total, 0);
    assert.equal(total, (await page(user, { ...options, limit: 600 })).length, 'the counts add up to the list');
    for (const group of groups) {
      const stagePage = await page(user, { ...options, stages: [group.stage], limit: 600 });
      assert.equal(stagePage.filter(row => (row.data.evaluation ?? (row.kind === 'private' ? 'review' : null)) === group.evaluation).length, group.total, `${group.stage}/${group.evaluation}`);
    }
  }
  assert.ok((await counts(member)).every(group => group.stage !== 'open'), 'a member is never shown what nobody works');
  assert.equal((await page(stranger)).length, 0, 'someone outside the workspace reads nothing');
  assert.equal((await counts(stranger)).length, 0);
  assert.equal((await page(outsider, { workspace: org })).length, 0, 'the administrator of another workspace reads nothing of this one');

  // The orders: soonest deadline first (no deadline last), largest amount first (no amount last), and pages that do not repeat.
  const byDeadline = await page(admin, { stages: ['open'], biddable: true, sort: 'deadline', limit: 600 });
  const deadlines = byDeadline.map(row => row.deadline_at === null ? Infinity : Date.parse(row.deadline_at));
  assert.deepEqual(deadlines, [...deadlines].sort((a, b) => a - b));
  const byAmount = await page(admin, { sort: 'amount', limit: 600 });
  const amounts = byAmount.map(row => row.amount === null ? -1 : Number(row.amount));
  assert.deepEqual(amounts, [...amounts].sort((a, b) => b - a));
  // The last moved first: what was just put aside heads «Archivadas».
  await query("update opportunity_work set updated_at=now()-interval '3 days' where organization_id=$1", [org]);
  const lastArchived = worked.filter((r, i) => states[i % states.length] === 'archived').at(-1);
  await query("update opportunity_work set updated_at=now() where opportunity_id=$1", [lastArchived.id]);
  assert.equal((await page(admin, { stages: ['archived'], sort: 'recent', limit: 1 }))[0].id, lastArchived.id);
  const first = ids(await page(admin, { limit: 50 })), second = ids(await page(admin, { limit: 50, offset: 50 }));
  assert.equal(new Set([...first, ...second]).size, 100);
  assert.equal((await page(admin, { limit: 5000 })).length <= 600, true, 'a page is 600 at most');

  assert.equal((await query("select has_function_privilege('authenticated','opportunity_workspace_page(uuid,uuid,text[],text[],text,text[],text[],boolean,text,integer,integer)','execute') browser"))[0].browser, false);
  assert.equal((await query("select has_function_privilege('anon','opportunity_workspace_counts(uuid,uuid,text,text[],text[],boolean)','execute') browser"))[0].browser, false);
  assert.equal((await query("select has_function_privilege('service_role','opportunity_workspace_counts(uuid,uuid,text,text[],text[],boolean)','execute') server"))[0].server, true);
  console.log(`PASS: ${compared} pages identical to the old lists (views, words, sources, categories, pages, members, other workspaces); open stages, closed deadlines, counts, orders, limits and grants.`);
} catch (error) { console.error(error); process.exitCode = 1; }
finally { await db.close(); }
