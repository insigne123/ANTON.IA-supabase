import test from 'node:test';
import assert from 'node:assert/strict';
import { assessListCandidate, equivalentJobTitles, verifiedEmailEvidence } from './list-quality';
const base = { history: [], historyComplete: true, duplicates: [], duplicatesComplete: true,
  emailEvidence: [], blocked: false, blockReasons: [], stages: [] };
const lead = { id: 'one', email: 'ana@example.com', company: 'Besalco Construcciones', linkedin_url: 'https://www.linkedin.com/in/ana' };
test('verified-only email policy never equates an address or likely status with verification', () => {
  assert.equal(verifiedEmailEvidence('a@example.com', 'verified'), true);
  for (const status of ['likely to engage', 'unknown', null, 'unverified']) assert.equal(verifiedEmailEvidence('a@example.com', status), false);
  assert.equal(verifiedEmailEvidence('not-email', 'verified'), false);
});
test('exact company matching avoids substring duplicates and keeps distinct emails distinct', () => {
  const result = assessListCandidate(lead, { ...base,
    history: [{ id: 'h', company: 'UCC', email: 'other@example.com', sent_at: '2026-01-01' }],
    duplicates: [{ id: 'two', email: ' ANa@example.com ' }, { id: 'three', email: 'ana+other@example.com' }] });
  assert.deepEqual(result.duplicates.leadIds, ['two']);
  assert.equal(result.history.accountMatches, 0);
  assert.equal(result.sendAuthorized, false);
});
test('newer invalid provider record supersedes older verified evidence', () => {
  const result = assessListCandidate(lead, { ...base, emailEvidence: [
    { email: lead.email, source_provider: 'apollo', email_status: 'verified', observedAt: '2026-01-01' },
    { email: lead.email, source_provider: 'apollo', email_status: 'invalid', observedAt: '2026-02-01' },
  ] });
  assert.equal(result.emailQuality.status, 'unverified');
});
test('suppression wins over priority, unknown coverage stays unknown and profile URL is not verification', () => {
  const result = assessListCandidate(lead, { ...base, blocked: true, blockReasons: ['blocked_domain'], historyComplete: false, stages: ['negotiation'], now: '2026-09-22T00:00:00Z' });
  assert.equal(result.disposition, 'blocked');
  assert.equal(result.priority.rank, 1);
  assert.ok(result.reasons.includes('history_incomplete'));
  assert.equal(result.profileCheck.status, 'needs_current_source');
});
test('recent extension capture corroborates or exposes profile mismatch', () => {
  const now = '2026-09-22T00:00:00Z';
  const titled = { ...lead, title: 'Gerenta de Logística' };
  const ok = assessListCandidate(titled, { ...base, now, profileEvidence: { title: 'Gerenta de Logística', company: 'Besalco Construcciones', capturedAt: '2026-09-01T00:00:00Z', source: 'linkedin_extension' } });
  assert.equal(ok.profileCheck.status, 'corroborated');
  assert.ok(!ok.reasons.includes('current_profile_not_verified'));
  const stale = assessListCandidate(titled, { ...base, now, profileEvidence: { title: 'Gerenta de Logística', company: 'Besalco Construcciones', capturedAt: '2026-01-01T00:00:00Z', source: 'linkedin_extension' } });
  assert.equal(stale.profileCheck.status, 'needs_current_source');
  const moved = assessListCandidate(titled, { ...base, now, profileEvidence: { title: 'Estudiante', company: 'Otra Empresa', capturedAt: '2026-09-01T00:00:00Z', source: 'linkedin_extension' } });
  assert.equal(moved.profileCheck.status, 'mismatch');
  assert.ok(moved.reasons.includes('profile_mismatch'));
});
test('conflicting CRM stages never manufacture an opportunity', () => {
  const result = assessListCandidate(lead, { ...base, stages: ['negotiation', 'closed_lost'] });
  assert.equal(result.priority.stage, null);
  assert.equal(result.priority.conflict, true);
});
test('strict title equality rejects partial overlaps', () => {
  assert.equal(equivalentJobTitles('Gerenta de Logística', 'gerenta  de logística'), true);
  assert.equal(equivalentJobTitles('Gerente', 'Asistente de gerente'), false);
  assert.equal(equivalentJobTitles('Gerente', 'Gerente de Operaciones'), false);
  assert.equal(equivalentJobTitles(null, 'Gerente'), false);
});
test('listReady requires every control and never implies send approval', () => {
  const now = '2026-09-22T00:00:00Z';
  const ready = assessListCandidate({ ...lead, title: 'Gerenta' }, { ...base, now,
    emailEvidence: [{ email: lead.email, source_provider: 'apollo', email_status: 'verified', observedAt: '2026-09-01' }],
    profileEvidence: { title: 'Gerenta', company: 'Besalco Construcciones', capturedAt: '2026-09-01T00:00:00Z', source: 'linkedin_extension' },
    stages: ['qualified'] });
  assert.equal(ready.listReady, true);
  assert.equal(ready.sendAuthorized, false);
  assert.equal(ready.disposition, 'needs_review');
  const incomplete = assessListCandidate({ ...lead, title: 'Gerenta' }, { ...base, now,
    emailEvidence: [{ email: lead.email, source_provider: 'apollo', email_status: 'verified', observedAt: '2026-09-01' }],
    stages: ['qualified'] });
  assert.equal(incomplete.listReady, false);
  assert.ok(incomplete.reasons.includes('current_profile_not_verified'));
});
