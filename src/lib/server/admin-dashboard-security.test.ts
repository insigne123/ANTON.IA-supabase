import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const authSource = readFileSync('src/lib/server/admin-dashboard-auth.ts', 'utf8');
const overviewRoute = readFileSync('src/app/api/dashboard/admin/overview/route.ts', 'utf8');
const groupsRoute = readFileSync('src/app/api/dashboard/admin/groups/route.ts', 'utf8');
const creditsRoute = readFileSync('src/app/api/dashboard/admin/credits/route.ts', 'utf8');
const userProfileRoute = readFileSync('src/app/api/dashboard/admin/users/[userId]/route.ts', 'utf8');
const userProfileData = readFileSync('src/lib/server/admin-user-profile-data.ts', 'utf8');
const valueRoute = readFileSync('src/app/api/dashboard/admin/value/route.ts', 'utf8');
const dashboardData = readFileSync('src/lib/server/admin-dashboard-data.ts', 'utf8');
const creditData = readFileSync('src/lib/server/admin-credit-data.ts', 'utf8');
const valueData = readFileSync('src/lib/server/admin-value-data.ts', 'utf8');
const sidebarSource = readFileSync('src/components/app-sidebar.tsx', 'utf8');
const hostingConfig = readFileSync('apphosting.yaml', 'utf8');
const peoplePage = readFileSync('src/app/(app)/dashboard/admin/users/page.tsx', 'utf8');
const teamsPage = readFileSync('src/app/(app)/dashboard/admin/teams/page.tsx', 'utf8');

test('admin dashboard opens for owners and admins of the active organization only, checked again on the server', () => {
  assert.match(authSource, /resolveActiveOrganization\(sessionClient, user\.id\)/);
  assert.match(authSource, /\.eq\('organization_id', activeOrganizationId\)/);
  assert.match(authSource, /\.in\('role', \['owner', 'admin'\]\)/);
  assert.match(authSource, /Necesitas un rol de owner o admin para abrir este panel/);
  assert.doesNotMatch(authSource, /ADMIN_DASHBOARD_ORGANIZATION_ID/, 'no single hard-coded organization any more');
});

test('credit limits cost the platform money: only the ANTON.IA operators change them', () => {
  assert.match(authSource, /process\.env\.ADMIN_DASHBOARD_ALLOWED_EMAILS/);
  assert.match(authSource, /options\.manageCredits && !canManageCredits/);
  assert.equal((creditsRoute.match(/requireAdminDashboardAccess\(\{ manageCredits: true \}\)/g) || []).length, 2, 'PUT and DELETE');
  assert.match(creditsRoute, /canManage: auth\.canManageCredits/);
});

test('the value summary reads only the authorized organization and never lists every platform account', () => {
  assert.match(valueRoute, /requireAdminDashboardAccess\(\)/);
  assert.match(valueRoute, /loadAdminValue\(auth\.supabase, auth\.organizationId/);
  assert.match(valueRoute, /groupId && !UUID_RE\.test\(groupId\)/);
  for (const source of [dashboardData, creditData, valueData]) assert.doesNotMatch(source, /listUsers/);
  assert.match(valueData, /\.from\('organization_members'\)[\s\S]*?\.eq\('organization_id', organizationId\)/);
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

test('admin navigation shows the panel to owners and admins, and hosting keeps only the credit operators', () => {
  assert.match(sidebarSource, /href: '\/dashboard\/admin'.*label: 'Administración'/);
  assert.match(sidebarSource, /organizationRole === 'owner' \|\| organizationRole === 'admin'/);
  assert.doesNotMatch(sidebarSource, /NEXT_PUBLIC_ADMIN_DASHBOARD/);
  assert.doesNotMatch(hostingConfig, /ADMIN_DASHBOARD_ORGANIZATION_ID/);
  assert.match(hostingConfig, /- variable: ADMIN_DASHBOARD_ALLOWED_EMAILS/);
  assert.doesNotMatch(hostingConfig, /NEXT_PUBLIC_ADMIN_DASHBOARD_ALLOWED_EMAILS/);
});

test('people management derives the actor role from the dashboard organization roster', () => {
  assert.doesNotMatch(peoplePage, /organizationRole/);
  assert.match(peoplePage, /overview\?\.users\.find\(\(person\) => person\.id === currentUser\?\.id\)\?\.role/);
  assert.match(peoplePage, /updateMemberRole\(overview\.organization\.id/);
  assert.match(peoplePage, /removeMember\(overview\.organization\.id/);
  assert.match(peoplePage, /InviteMemberDialog organizationId=\{overview\.organization\.id\}/);
});

test('management pages discard failed roster loads and teams guard all mutations', () => {
  assert.match(peoplePage, /catch \(loadError\)[\s\S]*setOverview\(null\)/);
  assert.match(teamsPage, /catch \(error\)[\s\S]*setOverview\(null\)/);
  assert.match(teamsPage, /const managementDisabled = !overview \|\| loading \|\| refreshing \|\| Boolean\(loadError\) \|\| Boolean\(mutationKey\)/);
  for (const handler of ['createTeam', 'assignPerson', 'removeAssignment']) {
    assert.match(teamsPage, new RegExp(`async function ${handler}\\([^]*?if \\(managementDisabled\\) return;`));
  }
  assert.match(teamsPage, /overview\.coverage\.note/);
});
