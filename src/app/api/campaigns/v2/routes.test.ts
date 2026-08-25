import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routes = [
  'src/app/api/campaigns/v2/first-contact-plans/route.ts',
  'src/app/api/campaigns/v2/inbox/route.ts',
  'src/app/api/campaigns/v2/recipient-steps/[stepId]/prepare-draft/route.ts',
  'src/app/api/campaigns/v2/recipient-steps/[stepId]/send-context/route.ts',
  'src/app/api/campaigns/v2/[campaignId]/enrollments/[enrollmentId]/stop/route.ts',
].map((path) => ({ path, source: readFileSync(path, 'utf8') }));

test('Campaign V2 user routes require application auth and preserve server ownership', () => {
  for (const route of routes) {
    assert.match(route.source, /requireAuth\(\)/, route.path);
    assert.match(route.source, /handleAuthError/, route.path);
  }
  assert.doesNotMatch(routes.map((route) => route.source).join('\n'), /sendGmail|sendOutlook|dispatchOutboundMessage/);
  const inbox = routes.find((route) => route.path.endsWith('/inbox/route.ts'))!;
  assert.match(inbox.source, /userId: auth\.user\.id/);
});

test('send context verifies creator organization scope before using the service role', () => {
  const route = routes.find((item) => item.path.endsWith('/send-context/route.ts'))!;
  const verifiedAuth = route.source.indexOf('await requireAuth()');
  const userScope = route.source.lastIndexOf(".eq('user_id', auth.user.id)");
  const organizationScope = route.source.indexOf(".in('organization_id', auth.organizationIds)");
  const serviceRole = route.source.indexOf('getSupabaseAdminClient()');

  assert.ok(verifiedAuth >= 0);
  assert.ok(organizationScope > verifiedAuth);
  assert.ok(userScope > organizationScope);
  assert.ok(serviceRole > userScope);
  assert.match(route.source, /\.from\('campaigns'\)[\s\S]+\.eq\('user_id', auth\.user\.id\)/);
});
