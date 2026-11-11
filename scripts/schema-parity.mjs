// Keeps the schema this repository builds equal to the one production has.
//
//   npm run db:parity:update   reads the local database (built from supabase/migrations) and rewrites
//                              supabase/tests/database/production_schema_parity.test.sql and
//                              supabase/schema-parity/production-check.sql
//
// The pgTAP test fails when a migration changes the schema and the fingerprint was not refreshed. The second file is one
// read-only statement to run in production after applying a migration there (and at each deploy): it returns one row per
// table or function that differs from what the repository builds, and no rows when they are equal.
//
// What is compared: for each table, its columns (type, null, default), constraints, indexes, policies, triggers and whether
// row security is on; for each function, its body without comments, spaces or letter case, plus security, volatility,
// settings and result. Privileges are not compared.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DATABASE_URL = process.env.SCHEMA_PARITY_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// Differences that stay, each with its reason. A name here is not compared in either database.
export const ACCEPTED = {
  tables: {
    antonia_app_suggestions: 'Agente de misiones retirado: tabla creada a mano en producción antes de las migraciones.',
    antonia_config: 'Agente de misiones retirado: tabla creada a mano en producción antes de las migraciones.',
    antonia_daily_usage: 'Agente de misiones retirado: tabla creada a mano en producción antes de las migraciones.',
    antonia_logs: 'Agente de misiones retirado: tabla creada a mano en producción antes de las migraciones.',
    antonia_missions: 'Agente de misiones retirado: tabla creada a mano en producción antes de las migraciones.',
    antonia_reports: 'Agente de misiones retirado: tabla creada a mano en producción antes de las migraciones.',
    antonia_tasks: 'Agente de misiones retirado: en producción avisa a un servicio externo al insertar; no se replica en pruebas.',
    antonia_usage_increments: 'Agente de misiones retirado: tabla creada a mano en producción antes de las migraciones.',
    lead_research_reports: 'Producción conserva las columnas del servicio de investigación anterior.',
  },
  functions: {
    'schedule_daily_mission_tasks()': 'Agente de misiones retirado.',
    'delete_research_messaging_subject_v1(p_email text)': 'Devuelve el otro identificador de lead_research_reports (misma tabla aceptada).',
  },
};

const TABLES = `
  select c.relname::text as name, left(md5(
    coalesce((select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' nn' else '' end || coalesce(' d:' || pg_get_expr(d.adbin, d.adrelid), ''), '|' order by a.attname)
      from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '-') || '#' ||
    coalesce((select string_agg(k.contype::text || ' ' || k.conname || ' ' || pg_get_constraintdef(k.oid), '|' order by k.conname) from pg_constraint k where k.conrelid = c.oid), '-') || '#' ||
    coalesce((select string_agg(pg_get_indexdef(i.indexrelid), '|' order by pg_get_indexdef(i.indexrelid)) from pg_index i where i.indrelid = c.oid), '-') || '#' ||
    coalesce((select string_agg(p.polname || ' ' || p.polcmd::text || ' ' || p.polpermissive::text || ' ' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' / ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') || ' ' ||
      coalesce((select string_agg(r.rolname, ',' order by r.rolname) from pg_roles r where r.oid = any(p.polroles)), 'public'), '|' order by p.polname) from pg_policy p where p.polrelid = c.oid), '-') || '#' ||
    coalesce((select string_agg(pg_get_triggerdef(g.oid), '|' order by g.tgname) from pg_trigger g where g.tgrelid = c.oid and not g.tgisinternal), '-') || '#' || c.relrowsecurity::text), 12) as hash
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')`;

const FUNCTIONS = `
  select p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name, left(md5(
    lower(regexp_replace(regexp_replace(p.prosrc, '--[^\\n]*', '', 'g'), '\\s+', '', 'g')) || '#' || p.prosecdef::text || '#' || p.provolatile::text || '#' ||
    coalesce(array_to_string(p.proconfig, ','), '') || '#' || pg_get_function_result(p.oid)), 12) as hash
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind in ('f', 'p') and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`;

/** The key of an object in the fingerprint: short, so the whole list fits in one statement that can be pasted anywhere. */
const keyOf = row => createHash('md5').update(`${row.kind}:${row.name}`).digest('hex').slice(0, 8);

/** One statement, the same in both databases: the rows that differ from `expected`. `strict` also reports what the repository does not know. */
function differences(expected, strict) {
  const list = expected.map(row => `${keyOf(row)}${row.hash.slice(0, 8)}`).join(',');
  const accepted = kind => Object.keys(ACCEPTED[kind]).map(name => `'${name.replaceAll("'", "''")}'`).join(', ');
  return `with expected as (
  select left(x, 8) as key, substr(x, 9) as hash from regexp_split_to_table(
    '${list}', ',') as x
),
current as (
  select 'table' as kind, t.name, t.hash from (${TABLES}) t where t.name not in (${accepted('tables')})
  union all
  select 'function', f.name, f.hash from (${FUNCTIONS}) f where f.name not in (${accepted('functions')})
),
keyed as (select kind, name, left(hash, 8) as hash, left(md5(kind || ':' || name), 8) as key from current)
select coalesce(k.kind, '?') as kind, coalesce(k.name, 'clave ' || e.key || ' (búscala con npm run db:parity:update -- --find=' || e.key || ')') as name,
  case when k.key is null then 'falta' when e.key is null then 'no está en la huella' else 'distinto' end as estado
from expected e full join keyed k on k.key = e.key
where k.key is null or (e.key is not null and k.hash <> e.hash)${strict ? ' or e.key is null' : ''}
order by 1, 2`;
}

function query(sql) {
  // The same search path as the test and as production's SQL editor: it decides which names are printed with their schema.
  const out = execFileSync('psql', [DATABASE_URL, '-qAt', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-c', `set search_path = public, extensions; ${sql}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\n').filter(Boolean).map(line => line.split('\t'));
}

function main() {
  const skip = kind => new Set(Object.keys(ACCEPTED[kind]));
  const expected = [
    ...query(TABLES).filter(([name]) => !skip('tables').has(name)).map(([name, hash]) => ({ kind: 'table', name, hash })),
    ...query(FUNCTIONS).filter(([name]) => !skip('functions').has(name)).map(([name, hash]) => ({ kind: 'function', name, hash })),
  ].sort((a, b) => (a.kind + a.name < b.kind + b.name ? -1 : 1));
  const find = process.argv.find(arg => arg.startsWith('--find='))?.slice(7);
  if (find) {
    const hit = expected.find(row => keyOf(row) === find);
    console.log(hit ? `${hit.kind} ${hit.name}` : `Ninguna tabla ni función de la base local tiene la clave ${find}.`);
    return;
  }
  const keys = new Set(expected.map(keyOf));
  if (keys.size !== expected.length) throw new Error('Dos objetos comparten clave: alarga la clave en keyOf.');
  const header = `-- Generated by \`npm run db:parity:update\` from a database built with supabase/migrations. Do not edit by hand.\n`;
  const reasons = [...Object.entries(ACCEPTED.tables), ...Object.entries(ACCEPTED.functions)].map(([name, why]) => `--   ${name}: ${why}`).join('\n');

  const test = `${header}-- The schema this repository builds, as a fingerprint. If this test fails after a migration: refresh it with
-- \`npm run db:parity:update\`, then run supabase/schema-parity/production-check.sql in production (read-only) once the
-- migration is applied there; it must return no rows.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(1);

select is_empty(
  $parity$
${differences(expected, true)}
  $parity$,
  'el esquema es el de la huella: ${expected.filter(row => row.kind === 'table').length} tablas y ${expected.filter(row => row.kind === 'function').length} funciones'
);

select * from finish();
rollback;
`;
  const check = `${header}-- Read-only. Run it in production after applying a migration there, and at each deploy: it returns one row per table or
-- function that differs from what this repository builds, and no rows when they are equal.
-- Run it with public and extensions in the search path, as the SQL editor and the Supabase connector do.
-- Not compared, with the reason:
${reasons}
${differences(expected, false)};
`;
  writeFileSync(path.join(ROOT, 'supabase/tests/database/production_schema_parity.test.sql'), test);
  mkdirSync(path.join(ROOT, 'supabase/schema-parity'), { recursive: true });
  writeFileSync(path.join(ROOT, 'supabase/schema-parity/production-check.sql'), check);
  console.log(`Huella: ${expected.length} objetos (${expected.filter(row => row.kind === 'table').length} tablas, ${expected.filter(row => row.kind === 'function').length} funciones).`);
}

main();
