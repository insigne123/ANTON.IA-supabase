import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateUnsubscribeLink,
  generateUnsubscribeSignature,
  generateUnsubscribeToken,
  parseUnsubscribeToken,
  resolveUnsubscribeRequest,
  verifyUnsubscribeSignature,
} from './unsubscribe-helpers';

const SECRET_NAMES = [
  'UNSUBSCRIBE_TOKEN_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY',
  'INTERNAL_API_SECRET',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;

function withSecrets(values: Partial<Record<(typeof SECRET_NAMES)[number], string>>, run: () => void) {
  const previous = Object.fromEntries(SECRET_NAMES.map((name) => [name, process.env[name]]));
  for (const name of SECRET_NAMES) delete process.env[name];
  Object.assign(process.env, values);
  try {
    run();
  } finally {
    for (const name of SECRET_NAMES) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('unsubscribe crypto rejects public-only configuration', () => {
  withSecrets({ NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-anon-key' }, () => {
    assert.throws(
      () => generateUnsubscribeSignature('lead@example.com', 'user-1', 'org-1'),
      /unsubscribe token secret is not configured/i,
    );
  });
});

test('unsubscribe links contain only an encrypted token and normalize email', () => {
  withSecrets({ UNSUBSCRIBE_TOKEN_SECRET: 'server-secret-for-tests' }, () => {
    const link = new URL(generateUnsubscribeLink('  Lead@Example.COM ', 'user-1', 'org-1'));
    assert.ok(link.searchParams.get('t'));
    assert.equal(link.searchParams.has('email'), false);
    assert.equal(link.searchParams.has('sig'), false);
    assert.deepEqual(resolveUnsubscribeRequest({ t: link.searchParams.get('t') }), {
      email: 'lead@example.com',
      userId: 'user-1',
      orgId: 'org-1',
    });
  });
});

test('legacy signatures use normalized email and secure server candidates only', () => {
  withSecrets({ INTERNAL_API_SECRET: 'internal-server-secret', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-anon-key' }, () => {
    const signature = generateUnsubscribeSignature('Lead@Example.COM', 'user-1', 'org-1');
    assert.equal(verifyUnsubscribeSignature(' lead@example.com ', 'user-1', 'org-1', signature), true);
    assert.equal(verifyUnsubscribeSignature('other@example.com', 'user-1', 'org-1', signature), false);
  });
});

test('configured secure fallback candidates verify links created before secret priority changes', () => {
  withSecrets({ INTERNAL_API_SECRET: 'previous-server-secret' }, () => {
    const token = generateUnsubscribeToken('lead@example.com', 'user-1', 'org-1');
    const signature = generateUnsubscribeSignature('lead@example.com', 'user-1', 'org-1');

    process.env.UNSUBSCRIBE_TOKEN_SECRET = 'new-primary-server-secret';
    assert.deepEqual(parseUnsubscribeToken(token), {
      email: 'lead@example.com',
      userId: 'user-1',
      orgId: 'org-1',
    });
    assert.equal(verifyUnsubscribeSignature('lead@example.com', 'user-1', 'org-1', signature), true);
  });
});
