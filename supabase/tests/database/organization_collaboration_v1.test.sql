begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(44);

insert into auth.users (id, email)
values
  ('b0000000-0000-4000-8000-000000000001', 'collab-owner@antonia.test'),
  ('b0000000-0000-4000-8000-000000000002', 'collab-admin@antonia.test'),
  ('b0000000-0000-4000-8000-000000000003', 'collab-member-one@antonia.test'),
  ('b0000000-0000-4000-8000-000000000004', 'collab-member-two@antonia.test'),
  ('b0000000-0000-4000-8000-000000000005', 'collab-outsider@antonia.test'),
  ('b0000000-0000-4000-8000-000000000006', 'collab-invited@antonia.test'),
  ('b0000000-0000-4000-8000-000000000007', 'collab-revoked@antonia.test'),
  ('b0000000-0000-4000-8000-000000000008', 'collab-expired@antonia.test');

insert into public.organizations (id, name, collaboration_v1_enabled)
values ('b1000000-0000-4000-8000-000000000001', 'Collaboration Primary', true);
insert into public.organizations (id, name)
values ('b1000000-0000-4000-8000-000000000002', 'Collaboration Control');

insert into public.organization_members (organization_id, user_id, role)
values
  ('b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'owner'),
  ('b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'admin'),
  ('b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003', 'member'),
  ('b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000004', 'member'),
  ('b1000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000005', 'owner');

insert into public.leads (id, user_id, organization_id, name, title, company, email, status)
values (
  'b2000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000003',
  'b1000000-0000-4000-8000-000000000001',
  'Collaboration Lead', 'VP Sales', 'Thread Company', 'shared-recipient@example.test', 'saved'
);

insert into public.organization_contact_threads (
  id, organization_id, channel, recipient_key, recipient_email, status,
  active_lead_id, opened_by_user_id, last_sent_by_user_id,
  first_contacted_at, last_contacted_at
) values (
  'b4000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'email', 'old-thread@example.test', 'old-thread@example.test', 'active',
  null, 'b0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000003',
  now() - interval '120 days', now() - interval '100 days'
);

insert into public.organization_contact_threads (
  id, organization_id, channel, recipient_key, recipient_email, status,
  opened_by_user_id, last_sent_by_user_id, first_contacted_at, last_contacted_at
) values (
  'b4000000-0000-4000-8000-000000000002',
  'b1000000-0000-4000-8000-000000000002',
  'email', 'shared-recipient@example.test', 'shared-recipient@example.test', 'active',
  'b0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000005',
  now() - interval '2 days', now() - interval '2 days'
);

insert into public.organization_contact_threads (
  id, organization_id, channel, recipient_key, recipient_email, status,
  opened_by_user_id, last_sent_by_user_id, first_contacted_at, last_contacted_at
) values (
  'b4000000-0000-4000-8000-000000000003',
  'b1000000-0000-4000-8000-000000000001',
  'email', 'fresh-thread@example.test', 'fresh-thread@example.test', 'active',
  'b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
  now() - interval '2 days', now() - interval '2 days'
);

insert into public.organization_invites (
  organization_id, email, role, token, token_hash, invited_by, expires_at
) values (
  'b1000000-0000-4000-8000-000000000001',
  'collab-expired@antonia.test',
  'member',
  null,
  repeat('d', 64),
  'b0000000-0000-4000-8000-000000000001',
  now() - interval '1 hour'
);

-- Two personal drafts target the same recipient and exercise the canonical
-- database boundary without any external provider.
insert into public.messaging_drafts (id, organization_id, user_id, channel)
values
  ('b3000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'email'),
  ('b3000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003', 'email');

insert into public.messaging_draft_versions (
  id, draft_id, organization_id, user_id, revision, lifecycle, channel,
  recipient, content, approval, preflight, payload, content_hash, created_at
)
select
  source.version_id, source.draft_id, 'b1000000-0000-4000-8000-000000000001', source.user_id,
  1, 'ready', 'email',
  jsonb_build_object(
    'leadRef', 'b2000000-0000-4000-8000-000000000001',
    'displayName', 'Collaboration Lead',
    'email', 'shared-recipient@example.test',
    'linkedinUrl', null
  ),
  jsonb_build_object('subject', 'Hello', 'text', 'Test message', 'html', null),
  jsonb_build_object(
    'status', 'approved', 'decidedBy', source.user_id,
    'decidedAt', '2026-08-26T12:00:00Z', 'reason', null
  ),
  jsonb_build_object(
    'status', 'passed', 'checkedAt', '2026-08-26T12:00:00Z',
    'errors', '[]'::jsonb, 'warnings', '[]'::jsonb
  ),
  jsonb_build_object(
    'schemaVersion', 1,
    'draftId', source.draft_id,
    'versionId', source.version_id,
    'organizationId', 'b1000000-0000-4000-8000-000000000001',
    'userId', source.user_id,
    'researchSnapshotId', null,
    'revision', 1,
    'parentVersionId', null,
    'lifecycle', 'ready',
    'channel', 'email',
    'recipient', jsonb_build_object(
      'leadRef', 'b2000000-0000-4000-8000-000000000001',
      'displayName', 'Collaboration Lead',
      'email', 'shared-recipient@example.test',
      'linkedinUrl', null
    ),
    'content', jsonb_build_object('subject', 'Hello', 'text', 'Test message', 'html', null),
    'approval', jsonb_build_object(
      'status', 'approved', 'decidedBy', source.user_id,
      'decidedAt', '2026-08-26T12:00:00Z', 'reason', null
    ),
    'preflight', jsonb_build_object(
      'status', 'passed', 'checkedAt', '2026-08-26T12:00:00Z',
      'errors', '[]'::jsonb, 'warnings', '[]'::jsonb
    ),
    'createdAt', '2026-08-26T12:00:00Z'
  ),
  repeat(source.hash_character, 64),
  '2026-08-26T12:00:00Z'::timestamptz
from (values
  ('b3010000-0000-4000-8000-000000000001'::uuid, 'b3000000-0000-4000-8000-000000000001'::uuid, 'b0000000-0000-4000-8000-000000000001'::uuid, '1'),
  ('b3010000-0000-4000-8000-000000000002'::uuid, 'b3000000-0000-4000-8000-000000000002'::uuid, 'b0000000-0000-4000-8000-000000000003'::uuid, '2')
) as source(version_id, draft_id, user_id, hash_character);

update public.messaging_drafts
set lifecycle = 'ready',
    current_version_id = case user_id
      when 'b0000000-0000-4000-8000-000000000001' then 'b3010000-0000-4000-8000-000000000001'::uuid
      else 'b3010000-0000-4000-8000-000000000002'::uuid
    end
where id in (
  'b3000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000002'
);

insert into public.outbound_dispatches (
  id, organization_id, user_id, draft_id, version_id, idempotency_key,
  content_hash, channel, provider, metadata, requested_at
)
select
  source.dispatch_id, 'b1000000-0000-4000-8000-000000000001', source.user_id,
  source.draft_id, source.version_id, source.idempotency_key,
  repeat(source.hash_character, 64), 'email', 'test-provider',
  jsonb_build_object(
    'schemaVersion', 1,
    'organizationId', 'b1000000-0000-4000-8000-000000000001',
    'userId', source.user_id,
    'draftId', source.draft_id,
    'versionId', source.version_id,
    'revision', 1,
    'channel', 'email',
    'recipient', jsonb_build_object(
      'leadRef', 'b2000000-0000-4000-8000-000000000001',
      'displayName', 'Collaboration Lead',
      'email', 'shared-recipient@example.test',
      'linkedinUrl', null
    ),
    'contentHash', repeat(source.hash_character, 64),
    'idempotencyKey', source.idempotency_key,
    'provider', 'test-provider',
    'requestedAt', '2026-08-26T12:00:00Z'
  ),
  '2026-08-26T12:00:00Z'::timestamptz
from (values
  ('b3020000-0000-4000-8000-000000000001'::uuid, 'b0000000-0000-4000-8000-000000000001'::uuid, 'b3000000-0000-4000-8000-000000000001'::uuid, 'b3010000-0000-4000-8000-000000000001'::uuid, 'collaboration:first', '1'),
  ('b3020000-0000-4000-8000-000000000002'::uuid, 'b0000000-0000-4000-8000-000000000003'::uuid, 'b3000000-0000-4000-8000-000000000002'::uuid, 'b3010000-0000-4000-8000-000000000002'::uuid, 'collaboration:second', '2'),
  ('b3020000-0000-4000-8000-000000000003'::uuid, 'b0000000-0000-4000-8000-000000000001'::uuid, 'b3000000-0000-4000-8000-000000000001'::uuid, 'b3010000-0000-4000-8000-000000000001'::uuid, 'campaign:parallel-campaign:recipient:initial', '1'),
  ('b3020000-0000-4000-8000-000000000004'::uuid, 'b0000000-0000-4000-8000-000000000001'::uuid, 'b3000000-0000-4000-8000-000000000001'::uuid, 'b3010000-0000-4000-8000-000000000001'::uuid, 'collaboration:followup', '1')
) as source(dispatch_id, user_id, draft_id, version_id, idempotency_key, hash_character);

select is(
  (select collaboration_v1_enabled from public.organizations where id = 'b1000000-0000-4000-8000-000000000002'),
  false,
  'collaboration enforcement is disabled by default'
);
select is(
  (select discovered_by_user_id from public.organization_lead_collaboration where lead_id = 'b2000000-0000-4000-8000-000000000001'),
  'b0000000-0000-4000-8000-000000000003'::uuid,
  'lead insert records immutable discovery provenance'
);

select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$select public.create_organization_invite_v1(
    'b1000000-0000-4000-8000-000000000001', 'pending-invite@antonia.test', 'member', repeat('a', 64)
  )$$,
  'owner can create a hashed invitation'
);
select throws_ok(
  $$update public.organizations set collaboration_v1_enabled = false
    where id = 'b1000000-0000-4000-8000-000000000001'$$,
  '42501',
  'Collaboration rollout is service-owned',
  'owner cannot bypass the service-owned rollout flag'
);
select lives_ok(
  $$select public.create_organization_invite_v1(
    'b1000000-0000-4000-8000-000000000001', 'collab-revoked@antonia.test', 'member', repeat('c', 64)
  )$$,
  'owner can create an invitation that will be revoked'
);
select is(
  public.revoke_organization_invite_v1((
    select id from public.organization_invites where token_hash = repeat('c', 64)
  )),
  true,
  'owner can revoke an unused invitation'
);
select results_eq(
  $$select (token is null), (token_hash = repeat('a', 64))
    from public.organization_invites where email = 'pending-invite@antonia.test'$$,
  $$values (true, true)$$,
  'invitation listings persist only the token hash'
);
select throws_ok(
  $$select public.reopen_organization_contact_thread_v1(
    'b4000000-0000-4000-8000-000000000003', 'Premature new cycle'
  )$$,
  '55000',
  'Contact thread cannot be reopened before 90 days',
  'owner cannot reopen a recent contact thread'
);

reset role;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000003', true);
set local role authenticated;

select lives_ok(
  $$select public.claim_organization_lead_v1('b2000000-0000-4000-8000-000000000001', 15)$$,
  'member can claim an unassigned lead for themselves'
);
select results_eq(
  $$select assigned_to_user_id, claimed_by_user_id
    from public.organization_lead_collaboration
    where lead_id = 'b2000000-0000-4000-8000-000000000001'$$,
  $$values (
    'b0000000-0000-4000-8000-000000000003'::uuid,
    'b0000000-0000-4000-8000-000000000003'::uuid
  )$$,
  'claim atomically assigns and reserves the lead'
);

reset role;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000004', true);
set local role authenticated;

select throws_ok(
  $$select public.claim_organization_lead_v1('b2000000-0000-4000-8000-000000000001', 15)$$,
  '55000',
  'Lead is already being prepared by another member',
  'another member cannot take an active lead claim'
);
select throws_ok(
  $$select public.assign_organization_lead_v1(
    'b2000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000004'
  )$$,
  '42501',
  'Members can only claim an unassigned lead for themselves',
  'member cannot replace another assignee'
);

reset role;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select throws_ok(
  $$select public.update_organization_member_role_v1(
    'b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'member'
  )$$,
  '42501',
  'Admins cannot manage owners',
  'admin cannot demote an owner'
);
select throws_ok(
  $$select public.remove_organization_member_v1(
    'b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'Admins cannot remove owners',
  'admin cannot remove an owner'
);

reset role;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000005', true);
set local role authenticated;

select is(
  (select count(*) from public.organization_lead_collaboration where organization_id = 'b1000000-0000-4000-8000-000000000001'),
  0::bigint,
  'outsider cannot read another organization collaboration state'
);
select throws_ok(
  $$select public.accept_organization_invite_v1(repeat('a', 64))$$,
  '42501',
  'Invitation belongs to another email address',
  'invitation cannot be accepted by a different account email'
);

reset role;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$select public.assign_organization_lead_v1(
    'b2000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000004'
  )$$,
  'owner can reassign a lead'
);
select results_eq(
  $$select assigned_to_user_id, claimed_by_user_id, claim_expires_at, contact_state
    from public.organization_lead_collaboration
    where lead_id = 'b2000000-0000-4000-8000-000000000001'$$,
  $$values (
    'b0000000-0000-4000-8000-000000000004'::uuid,
    null::uuid,
    null::timestamptz,
    'uncontacted'::text
  )$$,
  'reassignment clears another member active preparation claim'
);
select throws_ok(
  $$delete from public.organization_members
    where organization_id = 'b1000000-0000-4000-8000-000000000001'
      and user_id = 'b0000000-0000-4000-8000-000000000004'$$,
  '42501',
  'permission denied for table organization_members',
  'direct membership mutation is denied'
);
select lives_ok(
  $$select public.create_organization_invite_v1(
    'b1000000-0000-4000-8000-000000000001', 'collab-invited@antonia.test', 'member', repeat('b', 64)
  )$$,
  'owner can invite the matching account email'
);

reset role;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000006', true);
set local role authenticated;

select is(
  public.accept_organization_invite_v1(repeat('b', 64)),
  'b1000000-0000-4000-8000-000000000001'::uuid,
  'matching account accepts the invitation once'
);
select ok(
  exists (
    select 1 from public.organization_members
    where organization_id = 'b1000000-0000-4000-8000-000000000001'
      and user_id = 'b0000000-0000-4000-8000-000000000006'
  ),
  'accepted invitation creates the membership'
);
select throws_ok(
  $$select public.accept_organization_invite_v1(repeat('b', 64))$$,
  '55000',
  'Invitation is invalid or expired',
  'accepted invitation cannot be replayed'
);

reset role;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000007', true);
set local role authenticated;

select throws_ok(
  $$select public.accept_organization_invite_v1(repeat('c', 64))$$,
  '55000',
  'Invitation is invalid or expired',
  'revoked invitation fails closed'
);

reset role;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000008', true);
set local role authenticated;

select throws_ok(
  $$select public.accept_organization_invite_v1(repeat('d', 64))$$,
  '55000',
  'Invitation is invalid or expired',
  'expired invitation fails closed'
);

reset role;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is(
  public.remove_organization_member_v1(
    'b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000004'
  ),
  true,
  'owner can remove a member through the audited RPC'
);
select is(
  (select organization_id from public.leads where id = 'b2000000-0000-4000-8000-000000000001'),
  'b1000000-0000-4000-8000-000000000001'::uuid,
  'collaboration-enabled organization retains its lead after member removal'
);
select is(
  (select discovered_by_user_id from public.organization_lead_collaboration where lead_id = 'b2000000-0000-4000-8000-000000000001'),
  'b0000000-0000-4000-8000-000000000003'::uuid,
  'member removal preserves lead provenance'
);
select throws_ok(
  $$select public.update_organization_member_role_v1(
    'b1000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'member'
  )$$,
  '55000',
  'Organization must keep at least one owner',
  'the last owner cannot be demoted'
);

reset role;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000003', true);
set local role authenticated;

select throws_ok(
  $$select public.reopen_organization_contact_thread_v1(
    'b4000000-0000-4000-8000-000000000001', 'Member requested reopen'
  )$$,
  '42501',
  'not authorized',
  'member cannot reopen a contact thread'
);

reset role;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$select public.reopen_organization_contact_thread_v1(
    'b4000000-0000-4000-8000-000000000001', 'New commercial cycle approved'
  )$$,
  'owner can reopen after 90 days with a reason'
);
select results_eq(
  $$select status, reopen_reason from public.organization_contact_threads
    where id = 'b4000000-0000-4000-8000-000000000001'$$,
  $$values ('available'::text, 'New commercial cycle approved'::text)$$,
  'reopen resets availability and preserves its reason'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

select ok(
  public.organization_collaboration_rollout_report_v1('b1000000-0000-4000-8000-000000000001')
    ?& array['organizationId', 'confirmedRecipientCount', 'ambiguousRecipientCount', 'contactThreadCount', 'inFlightOrUnknownDispatchCount'],
  'service role can generate the pre-activation rollout report'
);

select is(
  (public.claim_outbound_dispatch_sending_v2(
    'b3020000-0000-4000-8000-000000000001', now(), 0
  ) ->> 'claimed')::boolean,
  true,
  'first outbound dispatch reserves the recipient before provider invocation'
);

update public.outbound_dispatches
set status = 'sent', completed_at = now(), provider_message_id = 'provider-first', updated_at = now()
where id = 'b3020000-0000-4000-8000-000000000001';

select is(
  (public.claim_outbound_dispatch_sending_v2(
    'b3020000-0000-4000-8000-000000000003', now(), 0
  ) ->> 'claimed')::boolean,
  false,
  'a new campaign cannot replace the original active thread'
);
select is(
  (public.claim_outbound_dispatch_sending_v2(
    'b3020000-0000-4000-8000-000000000004', now(), 0
  ) ->> 'claimed')::boolean,
  true,
  'the original sender can continue a manual follow-up for the same lead'
);

update public.outbound_dispatches
set status = 'unknown', completed_at = now(), error_code = 'provider_outcome_unknown',
    error_message = 'Provider outcome is unknown', updated_at = now()
where id = 'b3020000-0000-4000-8000-000000000004';

select is(
  (public.claim_outbound_dispatch_sending_v2(
    'b3020000-0000-4000-8000-000000000002', now(), 0
  ) ->> 'claimed')::boolean,
  false,
  'second outbound dispatch cannot claim the same recipient'
);
select results_eq(
  $$select status, error_code from public.outbound_dispatches
    where id = 'b3020000-0000-4000-8000-000000000002'$$,
  $$values ('failed'::text, 'pre_provider_rejected'::text)$$,
  'recipient conflict is a known terminal pre-provider rejection'
);
select is(
  (select reserved_dispatch_id from public.organization_contact_threads
    where organization_id = 'b1000000-0000-4000-8000-000000000001'
      and recipient_key = 'shared-recipient@example.test'),
  'b3020000-0000-4000-8000-000000000004'::uuid,
  'unknown provider outcome retains the original reservation'
);
select results_eq(
  $$select status, reserved_dispatch_id
    from public.organization_contact_threads
    where organization_id = 'b1000000-0000-4000-8000-000000000001'
      and recipient_key = 'shared-recipient@example.test'$$,
  $$values ('active'::text, 'b3020000-0000-4000-8000-000000000004'::uuid)$$,
  'contact thread remains reserved while delivery is ambiguous'
);
select is(
  (select count(*) from public.organization_contact_threads where recipient_key = 'shared-recipient@example.test'),
  2::bigint,
  'the same recipient can have an independent thread in another organization'
);
select is(
  (public.set_organization_collaboration_v1_enabled(
    'b1000000-0000-4000-8000-000000000001', false, 'Rollback gate verification'
  ) ->> 'enabled')::boolean,
  false,
  'service role can disable collaboration through the audited rollout RPC'
);

reset role;
select set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select throws_ok(
  $$select public.claim_organization_lead_v1('b2000000-0000-4000-8000-000000000001', 15)$$,
  '55000',
  'Organization collaboration is not enabled',
  'lead collaboration RPCs fail closed when rollout is disabled'
);

reset role;
select set_config('request.jwt.claim.role', '', true);

select throws_ok(
  $$update public.organization_collaboration_events
    set metadata = metadata || '{"tampered":true}'::jsonb
    where organization_id = 'b1000000-0000-4000-8000-000000000001'$$,
  '55000',
  'organization collaboration events are append-only',
  'collaboration audit events cannot be changed'
);

select * from finish();
rollback;
