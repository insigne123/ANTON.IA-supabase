import assert from 'node:assert/strict';
import test from 'node:test';

import { notificationService } from './notification-service';

test('notification emails require review without making outbound requests', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    (globalThis as any).fetch = async () => {
        fetchCalled = true;
        throw new Error('Notification delivery must not make network requests.');
    };

    try {
        const alertResult = await notificationService.sendAlert('org-1', 'Alert title', 'Alert message');
        const reportResult = await notificationService.sendReportEmail('org-1', 'Report subject', '<p>Report</p>');

        assert.deepEqual(alertResult, { sent: false, status: 'review_required' });
        assert.deepEqual(reportResult, { sent: false, status: 'review_required', recipients: [] });
        assert.equal(fetchCalled, false);
    } finally {
        (globalThis as any).fetch = originalFetch;
    }
});
