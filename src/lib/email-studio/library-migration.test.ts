import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sql = await readFile(new URL('../../../supabase/migrations/20260909120000_email_template_library.sql', import.meta.url), 'utf8');

test('migration preserves legacy profiles as personal and makes active names owner-scoped', () => {
  assert.match(sql, /library_scope text not null default 'personal'/);
  assert.match(sql, /drop constraint email_style_profiles_organization_id_name_key/);
  assert.match(sql, /organization_id, user_id, lower\(btrim\(name\)\)/);
  assert.match(sql, /where library_scope = 'team' and archived_at is null/);
  assert.doesNotMatch(sql, /insert into public\.(organizations|organization_members)|update public\.profiles|delete from/i);
});

test('RLS denies personal reads to colleagues and team writes to non-admins', () => {
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public.email_style_profiles from anon/);
  assert.match(sql, /library_scope = 'team' or user_id = \(select auth.uid\(\)\)/);
  assert.match(sql, /create policy email_template_insert[\s\S]*array\['owner', 'admin'\]/);
  assert.match(sql, /create policy email_template_update[\s\S]*with check[\s\S]*array\['owner', 'admin'\]/);
  assert.match(sql, /revoke delete on public.email_style_profiles from authenticated/);
  assert.match(sql, /new.organization_id, new.user_id, new.library_scope, new.source_collection/);
});

test('RPC uses invoker RLS, checked revisions and transactional unique defaults', () => {
  assert.match(sql, /security invoker/);
  assert.doesNotMatch(sql, /security definer/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /p_expected_revision is null or p_expected_revision <> v_source.revision/);
  assert.match(sql, /new.revision <> old.revision \+ 1/);
  assert.match(sql, /create unique index email_style_personal_default_uq/);
  assert.match(sql, /create unique index email_style_team_default_uq/);
  assert.match(sql, /p_publish_confirmed is distinct from true/);
  assert.match(sql, /from public, anon/);
  assert.match(sql, /archived_at = now\(\), is_default = false, revision = revision \+ 1/);
});

test('members can duplicate shared templates without acquiring UPDATE rights on source', () => {
  const branch = sql.split("if p_action = 'duplicate' then")[1].split('else')[0];
  assert.match(branch, /select \* into v_source/);
  assert.doesNotMatch(branch, /for update/);
  assert.match(sql, /case when p_action = 'duplicate' then v_source.profile else p_profile end/);
});
