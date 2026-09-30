import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkSpecialistFor } from './agents';

test('each read has the agent that does it, and plain lookups stay with Cowork', () => {
  const name = (action: string | null) => coworkSpecialistFor(action)?.name ?? null;
  assert.equal(name('metrics.rates'), 'Analista');
  assert.equal(name('campaigns.batch_report'), 'Analista');
  assert.equal(name('files.read'), 'Analista');
  assert.equal(name('deliverability.check'), 'Analista');
  assert.equal(name('audience.analyze'), 'Estratega');
  assert.equal(name('saved_searches.list'), 'Estratega');
  assert.equal(name('campaigns.company_plan'), 'Estratega');
  assert.equal(name('research.get_existing'), 'Investigadora');
  assert.equal(name('contacted.timeline'), 'Investigadora');
  assert.equal(name('crm.get_lead'), 'Investigadora');
  assert.equal(name('linkedin.quota'), 'LinkedIn');
  for (const plain of ['leads.search', 'leads.get', 'app.context', 'profile.get', 'message.context', 'campaigns.inbox', 'draft.get', null, '']) {
    assert.equal(name(plain), null, `${plain} stays with Cowork`);
  }
});
