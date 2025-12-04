import { activityLogService } from './src/lib/services/activity-log-service';
import { supabase } from './src/lib/supabase';

async function verifyActivityFilters() {
    console.log('Verifying Activity Filters...');

    // 1. Get all activities to find a user and action to filter by
    const allActivities = await activityLogService.getActivities(5);
    if (allActivities.length === 0) {
        console.log('No activities found to test filters.');
        return;
    }

    const testUser = allActivities[0].user_id;
    const testAction = allActivities[0].action;

    console.log(`Testing filters with User: ${testUser} and Action: ${testAction}`);

    // 2. Filter by User
    const userActivities = await activityLogService.getActivities(5, { userId: testUser });
    console.log(`Found ${userActivities.length} activities for user ${testUser}`);
    const userMismatch = userActivities.find(a => a.user_id !== testUser);
    if (userMismatch) {
        console.error('User filter failed!', userMismatch);
    } else {
        console.log('User filter passed.');
    }

    // 3. Filter by Action
    const actionActivities = await activityLogService.getActivities(5, { action: testAction });
    console.log(`Found ${actionActivities.length} activities for action ${testAction}`);
    const actionMismatch = actionActivities.find(a => a.action !== testAction);
    if (actionMismatch) {
        console.error('Action filter failed!', actionMismatch);
    } else {
        console.log('Action filter passed.');
    }
}

verifyActivityFilters();
