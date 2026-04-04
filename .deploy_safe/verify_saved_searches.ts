import { savedSearchesService } from './src/lib/services/saved-searches-service';
import { supabase } from './src/lib/supabase';

async function verifySavedSearches() {
    console.log('Verifying Saved Searches Service...');

    // 1. Check if table exists
    const { error: tableError } = await supabase.from('saved_searches').select('count').limit(1);
    if (tableError) {
        console.error('Error accessing saved_searches table:', tableError);
        return;
    }
    console.log('Saved searches table exists.');

    console.log('Verification script created. To fully verify, run this in the app context or check the UI.');
}

verifySavedSearches();
