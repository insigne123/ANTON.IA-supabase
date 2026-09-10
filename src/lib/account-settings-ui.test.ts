import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('organization entry is removed while profile and admin invitation access remain', () => {
  const sidebar = readFileSync('src/components/app-sidebar.tsx', 'utf8');
  const oldRoute = readFileSync('src/app/(app)/settings/organization/page.tsx', 'utf8');
  const people = readFileSync('src/app/(app)/dashboard/admin/users/page.tsx', 'utf8');
  assert.doesNotMatch(sidebar, /settings\/organization/);
  assert.match(sidebar, /href: '\/profile'.*label: 'Perfil'/);
  assert.match(oldRoute, /await requireAdminDashboardAccess\(\)/);
  assert.match(oldRoute, /redirect\('\/profile'\)/);
  assert.match(oldRoute, /redirect\('\/dashboard\/admin\/users'\)/);
  assert.match(people, /InviteMemberDialog organizationId=\{overview.organization.id\}/);
  assert.match(people, /currentRole === 'owner' \|\| currentRole === 'admin'[\s\S]*PendingInvitations/);
  const invites = readFileSync('src/components/admin/pending-invitations.tsx', 'utf8');
  assert.match(invites, /revokeInvite\(invite.id, organizationId\)/);
  assert.match(invites, /getOrganizationDetails\(organizationId\)/);
});

test('mail connection pages use server-owned OAuth and distinguish load failure from disconnected', () => {
  for (const page of ['gmail', 'outlook']) {
    const source = readFileSync(`src/app/(app)/${page}/page.tsx`, 'utf8');
    assert.match(source, /\/api\/auth\/connect\//);
    assert.doesNotMatch(source, /response_type: 'code'|accounts.google.com/);
    assert.match(source, /No pudimos consultar la conexion/);
    assert.match(source, /credenciales guardadas/);
  }
});
