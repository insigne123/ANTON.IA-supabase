import { supabase } from './src/lib/supabase';

async function verifyComments() {
    console.log('Verifying Comments Table...');

    // 1. Check if table exists (by trying to select count)
    const { count, error: countError } = await supabase.from('comments').select('*', { count: 'exact', head: true });

    if (countError) {
        console.error('Error accessing comments table:', countError);
        if (countError.code === 'PGRST205') {
            console.error('This confirms the schema cache issue. Please run the migration "20251204013000_fix_schema_cache.sql".');
        }
        return;
    }
    console.log('Comments table accessible. Count:', count);

    // 2. Try to insert a comment (requires being logged in, which this script might not be fully, 
    // but we can check if we get a permission error vs a "table not found" error)

    // We can't easily simulate a full user login here without credentials, 
    // but we can check if the table metadata is available.

    console.log('Verification script finished. If you see "Comments table accessible", the schema cache issue is likely resolved.');
}

verifyComments();
