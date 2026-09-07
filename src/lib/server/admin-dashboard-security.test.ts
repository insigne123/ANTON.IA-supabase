import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authSource = readFileSync('src/lib/server/admin-dashboard-auth.ts', 'utf8');
const overviewRoute = readFileSync('src/app/api/dashboard/admin/overview/route.ts', 'utf8');
const groupsRoute = readFileSync('src/app/api/dashboard/admin/groups/route.ts', 'utf8');
const creditsRoute = readFileSync('src/app/api/dashboard/admin/credits/route.ts', 'utf8');
const userProfileRoute = readFileSync('src/app/api/dashboard/admin/users/[userId]/route.ts', 'utf8');
const userProfileData = readFileSync('src/lib/server/admin-user-profile-data.ts', 'utf8');
const sidebarSource = readFileSync('src/components/app-sidebar.tsx', 'utf8');
const hostingConfig = readFileSync('apphosting.yaml', 'utf8');

test('admin dashboard authorization fails closed on the configured tenant and privileged roles', () => {
  assert.match(authSource, /process\.env\.ADMIN_DASHBOARD_ORGANIZATION_ID/);
  assert.match(authSource, /process\.env\.ADMIN_DASHBOARD_ALLOWED_EMAILS/);
  assert.match(authSource, /if \(!configuredId\)[\s\S]*El panel administrativo no está configurado/);
  assert.match(authSource, /Tu cuenta no está autorizada para abrir este panel/);
  assert.match(authSource, /\.eq\('organization_id', configuredOrganizationId\)/);
  assert.match(authSource, /\.in\('role', \['owner', 'admin'\]\)/);
  assert.doesNotMatch(authSource, /ADMIN_DASHBOARD_ORGANIZATION_NAME/);
});

test('credit and user profile routes keep service-role reads inside the authorized organization', () => {
  assert.match(creditsRoute, /requireAdminDashboardAccess\(\)/);
  assert.match(creditsRoute, /p_organization_id: auth\.organizationId/);
  assert.match(creditsRoute, /p_actor_user_id: auth\.user\.id/);
  assert.doesNotMatch(creditsRoute, /body\.organizationId/);
  assert.match(creditsRoute, /schedule_antonia_credit_policy_v1/);
  assert.match(creditsRoute, /clear_antonia_credit_policy_v1/);

  assert.match(userProfileRoute, /requireAdminDashboardAccess\(\)/);
  assert.match(userProfileRoute, /UUID_RE\.test\(normalizedUserId\)/);
  const membershipCheck = userProfileData.indexOf(".from('organization_members')");
  const identityRead = userProfileData.indexOf('supabase.auth.admin.getUserById');
  assert.ok(membershipCheck >= 0 && identityRead > membershipCheck);
  assert.match(userProfileData, /\.eq\('organization_id', organizationId\)[\s\S]*\.eq\('user_id', userId\)/);
});

test('admin routes derive tenant scope from authorization instead of request input', () => {
  assert.match(overviewRoute, /requireAdminDashboardAccess\(\)/);
  assert.match(overviewRoute, /loadAdminDashboardOverview\([\s\S]*auth\.organizationId/);
  assert.match(overviewRoute, /groupId && !UUID_RE\.test\(groupId\)/);
  assert.match(overviewRoute, /userId && !UUID_RE\.test\(userId\)/);

  assert.match(groupsRoute, /requireAdminDashboardAccess\(\)/);
  assert.match(groupsRoute, /manage_organization_reporting_group_member_v2/);
  assert.match(groupsRoute, /p_organization_id: auth\.organizationId/);
  assert.match(groupsRoute, /p_actor_user_id: auth\.user\.id/);
  assert.match(groupsRoute, /Grupo o usuario no pertenece a esta organización/);
});

test('admin navigation and hosting configuration use the same production organization', () => {
  const organizationId = 'e73dd11f-c8db-4ffc-9711-47dc74295064';
  assert.match(sidebarSource, /label: 'Administración'/);
  assert.match(sidebarSource, /href: '\/dashboard\/admin'.*label: 'Admin'/);
  assert.match(sidebarSource, /process\.env\.NEXT_PUBLIC_ADMIN_DASHBOARD_ORGANIZATION_ID/);
  assert.match(sidebarSource, /process\.env\.NEXT_PUBLIC_ADMIN_DASHBOARD_ALLOWED_EMAILS/);
  assert.match(sidebarSource, /organizationRole === 'owner' \|\| organizationRole === 'admin'/);
  assert.match(hostingConfig, new RegExp(`ADMIN_DASHBOARD_ORGANIZATION_ID[\\s\\S]*${organizationId}`));
  assert.match(hostingConfig, new RegExp(`NEXT_PUBLIC_ADMIN_DASHBOARD_ORGANIZATION_ID[\\s\\S]*${organizationId}`));
  assert.match(hostingConfig, /ADMIN_DASHBOARD_ALLOWED_EMAILS[\s\S]*gmeneses@grupoexpro\.com,nicolas\.yarur\.g@yago\.cl/);
  assert.match(hostingConfig, /NEXT_PUBLIC_ADMIN_DASHBOARD_ALLOWED_EMAILS[\s\S]*gmeneses@grupoexpro\.com,nicolas\.yarur\.g@yago\.cl/);
});
