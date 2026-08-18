import assert from 'node:assert/strict';
import test from 'node:test';

import {
    classifyContactSendFailure,
    isReplayedContactSend,
    isSuccessfulContactSend,
    parseContactSendResponseBody,
    shouldAppendContactedLead,
} from './contact-send-response';

test('parses JSON contact responses without treating invalid bodies as structured errors', () => {
    assert.deepEqual(parseContactSendResponseBody('{"code":"OUTBOUND_UNKNOWN"}'), { code: 'OUTBOUND_UNKNOWN' });
    assert.deepEqual(parseContactSendResponseBody('Recipient unsubscribed'), {});
    assert.deepEqual(parseContactSendResponseBody('[]'), {});
});

test('marks do_not_contact only for exact unsubscribe and domain block codes', () => {
    const unsubscribed = classifyContactSendFailure(409, { code: 'RECIPIENT_UNSUBSCRIBED' });
    const blockedDomain = classifyContactSendFailure(403, { code: 'DOMAIN_BLOCKED' });
    const conflict = classifyContactSendFailure(409, { code: 'OUTBOUND_CONFLICT', error: 'Recipient unsubscribed' });
    const statusOnly = classifyContactSendFailure(403, { error: 'Domain blocked' });
    const wrongCase = classifyContactSendFailure(409, { code: 'recipient_unsubscribed' });
    const paddedCode = classifyContactSendFailure(409, { code: ' RECIPIENT_UNSUBSCRIBED ' });

    assert.equal(unsubscribed.shouldMarkDoNotContact, true);
    assert.equal(unsubscribed.complianceReason, 'unsubscribed');
    assert.equal(blockedDomain.shouldMarkDoNotContact, true);
    assert.equal(blockedDomain.complianceReason, 'domain_blocked');
    assert.equal(conflict.shouldMarkDoNotContact, false);
    assert.equal(statusOnly.shouldMarkDoNotContact, false);
    assert.equal(wrongCase.shouldMarkDoNotContact, false);
    assert.equal(paddedCode.shouldMarkDoNotContact, false);
});

test('preserves conflict, unknown, and daily quota retry semantics without suppressing leads', () => {
    const conflict = classifyContactSendFailure(409, { code: 'OUTBOUND_CONFLICT', status: 'conflict' });
    const unknown = classifyContactSendFailure(503, { code: 'OUTBOUND_UNKNOWN', status: 'unknown' });
    const quota = classifyContactSendFailure(429, { code: 'daily_quota_exceeded', status: 'failed' });

    assert.deepEqual(
        { retryable: conflict.retryable, unknown: conflict.outcomeUnknown, suppress: conflict.shouldMarkDoNotContact },
        { retryable: false, unknown: false, suppress: false }
    );
    assert.deepEqual(
        { retryable: unknown.retryable, unknown: unknown.outcomeUnknown, suppress: unknown.shouldMarkDoNotContact },
        { retryable: true, unknown: true, suppress: false }
    );
    assert.deepEqual(
        { retryable: quota.retryable, quota: quota.dailyQuotaExceeded, suppress: quota.shouldMarkDoNotContact },
        { retryable: true, quota: true, suppress: false }
    );
});

test('recognizes only an explicit replay flag', () => {
    assert.equal(isReplayedContactSend({ replayed: true }), true);
    assert.equal(isReplayedContactSend({ replayed: 'true' }), false);
    assert.equal(isReplayedContactSend({}), false);
});

test('requires an explicit success result instead of treating an unconfirmed 202 as sent', () => {
    assert.equal(isSuccessfulContactSend(200, { success: true }), true);
    assert.equal(isSuccessfulContactSend(202, { code: 'OUTBOUND_UNKNOWN', status: 'pending' }), false);
    assert.equal(isSuccessfulContactSend(200, {}), false);
    assert.equal(isSuccessfulContactSend(500, { success: true }), false);
});

test('appends contacted history only for a new successful dispatch', () => {
    assert.equal(shouldAppendContactedLead(200, { success: true, replayed: false }), true);
    assert.equal(shouldAppendContactedLead(200, { success: true, replayed: true }), false);
    assert.equal(shouldAppendContactedLead(202, { code: 'OUTBOUND_UNKNOWN', status: 'pending' }), false);
});
