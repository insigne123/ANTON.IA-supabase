import test from 'node:test';
import assert from 'node:assert/strict';

import { hasPriorReplyHistory, shouldPermanentlySuppressContact } from './contact-history-guard';

test('unsubscribe is permanent suppression', () => {
    assert.equal(shouldPermanentlySuppressContact({ reply_intent: 'unsubscribe' }), true);
    assert.equal(shouldPermanentlySuppressContact({
        reply_intent: 'negative',
        last_reply_text: 'Please do not contact me again.',
    }), true);
});

test('mailbox full and temporary failures are history but not permanent suppression', () => {
    const mailboxFull = {
        reply_intent: 'delivery_failure',
        delivery_status: 'soft_bounced',
        bounce_category: 'mailbox_full',
        evaluation_status: 'action_required',
    };
    const temporaryFailure = {
        reply_intent: 'delivery_failure',
        delivery_status: 'soft_bounced',
        bounce_category: 'temporary_failure',
        evaluation_status: 'action_required',
    };

    assert.equal(hasPriorReplyHistory(mailboxFull), true);
    assert.equal(shouldPermanentlySuppressContact(mailboxFull), false);
    assert.equal(shouldPermanentlySuppressContact(temporaryFailure), false);
});

test('auto replies and neutral replies are not permanent suppression', () => {
    assert.equal(shouldPermanentlySuppressContact({ reply_intent: 'auto_reply' }), false);
    assert.equal(shouldPermanentlySuppressContact({ reply_intent: 'neutral' }), false);
    assert.equal(shouldPermanentlySuppressContact({ reply_intent: 'negative', last_reply_text: 'No me interesa.' }), false);
});

test('hard delivery-failure metadata is permanent suppression', () => {
    assert.equal(shouldPermanentlySuppressContact({
        reply_intent: 'delivery_failure',
        delivery_status: 'bounced',
        bounce_category: 'mailbox_not_found',
        evaluation_status: 'do_not_contact',
    }), true);
    assert.equal(shouldPermanentlySuppressContact({
        delivery_status: 'bounced',
        bounce_category: 'mailbox_not_found',
        evaluation_status: 'do_not_contact',
    }), true);
});
