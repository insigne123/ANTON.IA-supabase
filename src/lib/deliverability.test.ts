import assert from 'node:assert/strict';
import test from 'node:test';
import { contrastSender, diagnoseBounces, evaluateDkim, evaluateDmarc, evaluateMx, evaluateSpf, normalizeDomain, recipientDomain, summarizeDomain, topRecipientDomains } from './deliverability';

test('only bare domains reach DNS', () => {
  assert.equal(normalizeDomain('Yago.CL.'), 'yago.cl');
  assert.equal(normalizeDomain('https://yago.cl/envio'), null);
  assert.equal(normalizeDomain('yago.cl; rm -rf'), null);
  assert.equal(normalizeDomain(''), null);
  assert.equal(normalizeDomain('not a domain'), null);
});

test('spf grades strictness honestly', () => {
  assert.equal(evaluateSpf([['v=spf1 include:_spf.google.com -all']]).status, 'pass');
  assert.equal(evaluateSpf([['v=spf1 include:_spf.google.com ~all']]).status, 'warn');
  assert.equal(evaluateSpf([['v=spf1 +all']]).status, 'fail');
  assert.equal(evaluateSpf([]).status, 'fail');
  assert.equal(evaluateSpf([['v=spf1 -all'], ['v=spf1 -all']]).status, 'fail');
  assert.equal(evaluateSpf([['v=spf1 ' + Array.from({ length: 9 }, (_, i) => `include:d${i}.test`).join(' ') + ' -all']]).status, 'warn');
});

test('dmarc requires a real policy', () => {
  assert.equal(evaluateDmarc([['v=DMARC1; p=reject;']]).status, 'pass');
  assert.equal(evaluateDmarc([['v=DMARC1; p=none;']]).status, 'warn');
  assert.equal(evaluateDmarc([]).status, 'fail');
});

test('dkim absence stays unknown, never a pass', () => {
  assert.equal(evaluateDkim('google', 10).status, 'pass');
  assert.equal(evaluateDkim(null, 10).status, 'unknown');
  assert.equal(evaluateMx(2).status, 'pass');
  assert.equal(evaluateMx(0).status, 'warn');
});

test('overall is fail on any fail, warn on any warn', () => {
  const base = { domain: 'yago.cl', checkedAt: 'x', source: 'live' as const,
    mx: evaluateMx(1), spf: evaluateSpf([['v=spf1 -all']]), dmarc: evaluateDmarc([['v=DMARC1; p=reject']]), dkim: evaluateDkim('google', 10) };
  assert.equal(summarizeDomain(base).overall, 'pass');
  assert.equal(summarizeDomain({ ...base, dmarc: evaluateDmarc([]) }).overall, 'fail');
  assert.equal(summarizeDomain({ ...base, dmarc: evaluateDmarc([['v=DMARC1; p=none']]) }).overall, 'warn');
});

test('bounce causes carry actions and threshold verdict', () => {
  const result = diagnoseBounces({ categories: ['mailbox_not_found', 'mailbox_not_found', 'policy_block', null], sent: 40 });
  assert.equal(result.bounces, 4);
  assert.equal(result.rate, 0.1);
  assert.equal(result.verdict, 'above_threshold');
  assert.equal(result.causes[0].action, 'do_not_contact_fix_email');
  assert.deepEqual(diagnoseBounces({ categories: [], sent: 40 }).verdict, 'no_data');
  assert.equal(diagnoseBounces({ categories: [], sent: 0 }).rate, null);
});

test('recipient domains never leak local parts', () => {
  assert.equal(recipientDomain('Ana@X.Test '), 'x.test');
  assert.equal(recipientDomain('invalid'), null);
  const top = topRecipientDomains(['a@x.test', 'b@x.test', 'c@y.test', null]);
  assert.deepEqual(top[0], { domain: 'x.test', count: 2 });
  assert.ok(!JSON.stringify(top).includes('Ana'));
});

test('sender contrast distinguishes match, difference and unknown', () => {
  const match = contrastSender({ profileEmail: 'nico@yago.cl', from: 'Nico <nico@yago.cl>',
    authHeader: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass' });
  assert.equal(match.identity, 'matches_profile');
  assert.equal(match.auth.dkim, 'pass');
  const differs = contrastSender({ profileEmail: 'nico@yago.cl', profileDomain: 'yago.cl', from: 'nico@gmail.com' });
  assert.equal(differs.identity, 'differs_from_profile');
  assert.match(differs.note || '', /cuenta/);
  const unknown = contrastSender({ from: 'nico@yago.cl' });
  assert.equal(unknown.identity, 'unverified');
});
