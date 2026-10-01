import assert from 'node:assert/strict';
import test from 'node:test';
import { coworkCampaignProvider, mailProviderNamedIn, resolveMailProvider } from './mail-sender';

const both = { google: true, outlook: true };
const onlyOutlook = { google: false, outlook: true };

test('the mailbox that sends: the chosen one while connected, else the only connected one', () => {
  assert.equal(resolveMailProvider(both, 'outlook'), 'outlook');
  assert.equal(resolveMailProvider(onlyOutlook, null), 'outlook');
  assert.equal(resolveMailProvider({ google: true, outlook: false }, 'outlook'), 'google', 'a chosen mailbox that was disconnected does not send');
  assert.equal(resolveMailProvider(both, null), null, 'two connected and none chosen: nobody guesses');
  assert.equal(resolveMailProvider({ google: false, outlook: false }, 'google'), null);
  assert.equal(resolveMailProvider(both, 'yahoo'), null);
});

test('a mailbox named in the request wins when connected; Cowork never needs to ask', () => {
  assert.equal(mailProviderNamedIn('Créala y envíala desde Outlook'), 'outlook');
  assert.equal(mailProviderNamedIn('por gmail, porfa'), 'google');
  assert.equal(mailProviderNamedIn('crea la campaña'), null);
  assert.equal(mailProviderNamedIn('mi correo es ana@googlemail.cl'), null, 'part of another word is not a mailbox');
  const base = { connected: both, preferred: 'google', proposed: 'google' as const };
  assert.equal(coworkCampaignProvider({ ...base, message: 'créala desde Outlook' }), 'outlook');
  assert.equal(coworkCampaignProvider({ ...base, message: 'créala' }), 'google');
  assert.equal(coworkCampaignProvider({ ...base, preferred: 'outlook', message: 'créala' }), 'outlook', 'the default wins over the model');
  assert.equal(coworkCampaignProvider({ ...base, connected: onlyOutlook, preferred: null, message: 'desde Gmail' }), 'outlook', 'a mailbox that is not connected cannot send');
  assert.equal(coworkCampaignProvider({ ...base, preferred: null, proposed: 'outlook', message: 'créala' }), 'outlook', 'two connected and none chosen: the model\'s choice stays');
});
