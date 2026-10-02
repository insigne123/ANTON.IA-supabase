begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(24);

-- A team with collaboration on (owner, admin, Ana and Beto) and a control organization without it.
insert into auth.users (id, email)
values
  ('c9000000-0000-4000-8000-000000000001', 'lifecycle-owner@antonia.test'),
  ('c9000000-0000-4000-8000-000000000002', 'lifecycle-admin@antonia.test'),
  ('c9000000-0000-4000-8000-000000000003', 'lifecycle-ana@antonia.test'),
  ('c9000000-0000-4000-8000-000000000004', 'lifecycle-beto@antonia.test'),
  ('c9000000-0000-4000-8000-000000000005', 'lifecycle-control@antonia.test');

insert into public.organizations (id, name, collaboration_v1_enabled)
values ('c9100000-0000-4000-8000-000000000001', 'Lifecycle Team', true);
insert into public.organizations (id, name)
values ('c9100000-0000-4000-8000-000000000002', 'Lifecycle Control');

insert into public.organization_members (organization_id, user_id, role)
values
  ('c9100000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000001', 'owner'),
  ('c9100000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000002', 'admin'),
  ('c9100000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000003', 'member'),
  ('c9100000-0000-4000-8000-000000000001', 'c9000000-0000-4000-8000-000000000004', 'member'),
  ('c9100000-0000-4000-8000-000000000002', 'c9000000-0000-4000-8000-000000000005', 'owner');

-- Threads for the 30-day release: idle, replied, recent, a reply from a previous cycle, and the control organization.
insert into public.organization_contact_threads (
  id, organization_id, channel, recipient_key, recipient_email, status,
  opened_by_user_id, last_sent_by_user_id, first_contacted_at, last_contacted_at,
  reopened_at, reopened_by_user_id, reopen_reason
)
values
  ('c9400000-0000-4000-8000-000000000001', 'c9100000-0000-4000-8000-000000000001', 'email', 'idle@example.test', 'idle@example.test', 'active',
   'c9000000-0000-4000-8000-000000000003', 'c9000000-0000-4000-8000-000000000003', now() - interval '60 days', now() - interval '31 days',
   null, null, null),
  ('c9400000-0000-4000-8000-000000000002', 'c9100000-0000-4000-8000-000000000001', 'email', 'replied@example.test', 'replied@example.test', 'active',
   'c9000000-0000-4000-8000-000000000003', 'c9000000-0000-4000-8000-000000000003', now() - interval '60 days', now() - interval '40 days',
   null, null, null),
  ('c9400000-0000-4000-8000-000000000003', 'c9100000-0000-4000-8000-000000000001', 'email', 'recent@example.test', 'recent@example.test', 'active',
   'c9000000-0000-4000-8000-000000000004', 'c9000000-0000-4000-8000-000000000004', now() - interval '10 days', now() - interval '10 days',
   null, null, null),
  ('c9400000-0000-4000-8000-000000000004', 'c9100000-0000-4000-8000-000000000001', 'email', 'cycle@example.test', 'cycle@example.test', 'active',
   'c9000000-0000-4000-8000-000000000004', 'c9000000-0000-4000-8000-000000000004', now() - interval '200 days', now() - interval '31 days',
   now() - interval '50 days', 'c9000000-0000-4000-8000-000000000001', 'Reabierto para otra campaña'),
  ('c9400000-0000-4000-8000-000000000005', 'c9100000-0000-4000-8000-000000000002', 'email', 'control@example.test', 'control@example.test', 'active',
   'c9000000-0000-4000-8000-000000000005', 'c9000000-0000-4000-8000-000000000005', now() - interval '60 days', now() - interval '40 days',
   null, null, null);

-- Threads to close: three of Ana's, one of Beto's and one in the control organization.
insert into public.organization_contact_threads (
  id, organization_id, channel, recipient_key, recipient_email, status,
  opened_by_user_id, last_sent_by_user_id, first_contacted_at, last_contacted_at
)
values
  ('c9500000-0000-4000-8000-000000000001', 'c9100000-0000-4000-8000-000000000001', 'email', 'nodeal@example.test', 'nodeal@example.test', 'active',
   'c9000000-0000-4000-8000-000000000003', 'c9000000-0000-4000-8000-000000000003', now() - interval '5 days', now() - interval '2 days'),
  ('c9500000-0000-4000-8000-000000000002', 'c9100000-0000-4000-8000-000000000001', 'email', 'won@example.test', 'won@example.test', 'active',
   'c9000000-0000-4000-8000-000000000003', 'c9000000-0000-4000-8000-000000000003', now() - interval '5 days', now() - interval '2 days'),
  ('c9500000-0000-4000-8000-000000000003', 'c9100000-0000-4000-8000-000000000001', 'email', 'notinterested@example.test', 'notinterested@example.test', 'active',
   'c9000000-0000-4000-8000-000000000004', 'c9000000-0000-4000-8000-000000000004', now() - interval '5 days', now() - interval '2 days'),
  ('c9500000-0000-4000-8000-000000000004', 'c9100000-0000-4000-8000-000000000001', 'email', 'keep@example.test', 'keep@example.test', 'active',
   'c9000000-0000-4000-8000-000000000003', 'c9000000-0000-4000-8000-000000000003', now() - interval '5 days', now() - interval '2 days'),
  ('c9500000-0000-4000-8000-000000000005', 'c9100000-0000-4000-8000-000000000002', 'email', 'control-close@example.test', 'control-close@example.test', 'active',
   'c9000000-0000-4000-8000-000000000005', 'c9000000-0000-4000-8000-000000000005', now() - interval '5 days', now() - interval '2 days');

-- Replies: one in this cycle, one before the thread was reopened.
insert into public.contacted_leads (id, user_id, organization_id, status, email, replied_at, created_at)
values
  ('pgtap-lifecycle-replied', 'c9000000-0000-4000-8000-000000000003', 'c9100000-0000-4000-8000-000000000001',
   'replied', 'Replied@Example.test', now() - interval '35 days', now() - interval '60 days'),
  ('pgtap-lifecycle-cycle', 'c9000000-0000-4000-8000-000000000004', 'c9100000-0000-4000-8000-000000000001',
   'replied', 'cycle@example.test', now() - interval '150 days', now() - interval '200 days');

-- Release: only the service role runs it.
select set_config('request.jwt.claim.sub', 'c9000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select throws_ok(
  $$select public.release_idle_organization_contact_threads_v1()$$,
  '42501', null,
  'members cannot run the release'
);
reset role;

select throws_ok(
  $$select public.release_idle_organization_contact_threads_v1(now(), 0)$$,
  '22023', null,
  'the release refuses an empty batch'
);
select is(
  public.release_idle_organization_contact_threads_v1(),
  2,
  'releases the two threads with 30 days since the last send and no reply in this cycle'
);
select is(
  (select status from public.organization_contact_threads where id = 'c9400000-0000-4000-8000-000000000001'),
  'available',
  'an idle thread is free for the team again'
);
select is(
  (select opened_by_user_id from public.organization_contact_threads where id = 'c9400000-0000-4000-8000-000000000001'),
  null::uuid,
  'a released thread has no owner'
);
select ok(
  (select reopened_at is not null and reopened_by_user_id is null and reopen_reason like 'Libre para el equipo%'
   from public.organization_contact_threads where id = 'c9400000-0000-4000-8000-000000000001'),
  'the release marks where the next cycle starts'
);
select is(
  (select status from public.organization_contact_threads where id = 'c9400000-0000-4000-8000-000000000002'),
  'active',
  'a reply keeps the thread with its owner'
);
select is(
  (select status from public.organization_contact_threads where id = 'c9400000-0000-4000-8000-000000000003'),
  'active',
  'a send in the last 30 days keeps the thread'
);
select is(
  (select status from public.organization_contact_threads where id = 'c9400000-0000-4000-8000-000000000004'),
  'available',
  'a reply from before the last reopen does not hold the thread'
);
select is(
  (select status from public.organization_contact_threads where id = 'c9400000-0000-4000-8000-000000000005'),
  'active',
  'organizations without collaboration are untouched'
);
select is(
  (select count(*)::integer from public.organization_collaboration_events
   where event_type = 'contact.released' and metadata->>'reason' = 'no_reply_30_days'
     and contact_thread_id in ('c9400000-0000-4000-8000-000000000001', 'c9400000-0000-4000-8000-000000000004')),
  2,
  'each release is recorded'
);
select is(
  public.release_idle_organization_contact_threads_v1(),
  0,
  'running the release again changes nothing'
);

-- Close: Beto cannot close Ana's conversation.
select set_config('request.jwt.claim.sub', 'c9000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select throws_ok(
  $$select public.close_organization_contact_thread_v1('c9500000-0000-4000-8000-000000000001', 'no_deal')$$,
  '42501', null,
  'another member cannot close the owner''s conversation'
);
reset role;

select set_config('request.jwt.claim.sub', 'c9000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select throws_ok(
  $$select public.close_organization_contact_thread_v1('c9500000-0000-4000-8000-000000000001', 'maybe')$$,
  '22023', null,
  'an unknown outcome is refused'
);
select is(
  public.close_organization_contact_thread_v1('c9500000-0000-4000-8000-000000000001', 'no_deal')->>'status',
  'available',
  'no deal frees the contact for the team'
);
select is(
  public.close_organization_contact_thread_v1('c9500000-0000-4000-8000-000000000002', 'won')->>'status',
  'closed',
  'won closes the contact'
);
select is(
  public.close_organization_contact_thread_v1('c9500000-0000-4000-8000-000000000004', 'keep')->>'status',
  'active',
  'keep leaves the contact with its owner'
);
select throws_ok(
  $$select public.close_organization_contact_thread_v1('c9500000-0000-4000-8000-000000000002', 'no_deal')$$,
  '55000', null,
  'a conversation that is no longer active cannot be closed again'
);
select throws_ok(
  $$select public.close_organization_contact_thread_v1('c9500000-0000-4000-8000-000000000005', 'no_deal')$$,
  '55000', null,
  'organizations without collaboration have nothing to close'
);
reset role;

-- An admin closes Beto's conversation; nobody without a session can.
select set_config('request.jwt.claim.sub', 'c9000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is(
  public.close_organization_contact_thread_v1('c9500000-0000-4000-8000-000000000003', 'not_interested')->>'status',
  'suppressed',
  'an admin can close any conversation; not interested means nobody contacts them again'
);
reset role;

select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
select throws_ok(
  $$select public.close_organization_contact_thread_v1('c9500000-0000-4000-8000-000000000004', 'keep')$$,
  '42501', null,
  'closing needs a session'
);
reset role;

select is(
  (select count(*)::integer from public.organization_collaboration_events
   where event_type = 'contact.closed' and contact_thread_id::text like 'c9500000-%'),
  4,
  'each close is recorded'
);
select ok(
  (select metadata->>'outcome' = 'no_deal'
      and metadata->>'previousOwnerUserId' = 'c9000000-0000-4000-8000-000000000003'
      and actor_user_id = 'c9000000-0000-4000-8000-000000000003'
   from public.organization_collaboration_events
   where event_type = 'contact.closed' and contact_thread_id = 'c9500000-0000-4000-8000-000000000001'),
  'the close event keeps the outcome, who closed it and the previous owner'
);
select ok(
  (select opened_by_user_id is null and reopened_by_user_id = 'c9000000-0000-4000-8000-000000000003'
   from public.organization_contact_threads where id = 'c9500000-0000-4000-8000-000000000001'),
  'no deal clears the owner and records who freed it'
);

select * from finish();
rollback;
