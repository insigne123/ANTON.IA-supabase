import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adminLayout = readFileSync('src/app/(app)/dashboard/admin/layout.tsx', 'utf8');
const privacyGuard = readFileSync('src/lib/server/privacy-admin-page.ts', 'utf8');
const privacyAccess = readFileSync('src/app/api/privacy/access/route.ts', 'utf8');
const privacyPage = readFileSync('src/app/(app)/settings/privacy/page.tsx', 'utf8');
const invitePage = readFileSync('src/app/invite/[token]/page.tsx', 'utf8');
const invitePreview = readFileSync('src/app/api/organizations/invites/preview/route.ts', 'utf8');

test('the admin panel is checked on the server before any of it renders', () => {
  assert.match(adminLayout, /export default async function AdminDashboardLayout/);
  assert.match(adminLayout, /await requireAdminDashboardAccess\(\)/);
  assert.match(adminLayout, /error\.status === 401\) redirect\('\/login\?next=\/dashboard\/admin'\)/);
  assert.match(adminLayout, /await requireAdminUsageAccess\(\)/);
  assert.match(adminLayout, /if\(!access\.platform\)notFound\(\)/, 'only explicit platform analytics can open the read-only frame without an organization-admin role');
  assert.match(adminLayout, /usageError\.status===403\)notFound\(\)/);
  assert.match(adminLayout, /throw usageError/, 'a failed global lookup is not presented as a false 404');
  assert.match(adminLayout, /throw error;/, 'a failed lookup reaches the panel error page, not a false 404');
});

test('privacy requests and incidents answer 404 to anyone off PRIVACY_ADMIN_EMAILS, the list their APIs check', () => {
  assert.match(privacyGuard, /createServerComponentClient\(\{ cookies \}\)/);
  assert.match(privacyGuard, /if \(!user \|\| !isPrivacyAdminEmail\(user\.email\)\) notFound\(\)/);
  for (const page of ['privacy-requests', 'privacy-incidents']) {
    const layout = readFileSync(`src/app/(app)/settings/${page}/layout.tsx`, 'utf8');
    assert.match(layout, /await requirePrivacyAdminPage\(\)/, page);
  }
  assert.match(privacyAccess, /admin: isPrivacyAdminEmail\(user\.email\)/);
  assert.match(privacyPage, /fetch\('\/api\/privacy\/access'/);
  assert.doesNotMatch(privacyPage, /legalConfig/, 'no fixed address decides who sees the entries');
});

test('an invitation waits for «Aceptar» and the preview never exposes the token or the whole address', () => {
  assert.doesNotMatch(invitePage.split('const accept = async')[0], /acceptInvite\(/, 'nothing accepts on load');
  assert.match(invitePage, /onClick=\{\(\) => void accept\(\)\}/);
  assert.match(invitePage, /Aceptar invitación/);
  assert.match(invitePage, /headers: \{ 'x-invite-token': token \}/, 'the token goes in a header, not the URL');
  assert.match(invitePage, /\/login\?next=\$\{encodeURIComponent\(`\/invite\/\$\{token\}`\)\}/);
  assert.match(invitePreview, /createHash\('sha256'\)\.update\(token, 'utf8'\)\.digest\('hex'\)/);
  assert.match(invitePreview, /\.eq\('token_hash', tokenHash\)/);
  assert.doesNotMatch(invitePreview, /select\([^)]*token_hash|select\([^)]*\btoken\b/, 'the token columns are never read back');
  assert.match(invitePreview, /describeInvitePreview\(/, 'only the masked preview leaves the server');
});
