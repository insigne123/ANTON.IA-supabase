import { createHash } from 'node:crypto'

import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const shouldWrite = process.argv.includes('--write')
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const schemaVersion = 'research-report-document/v1'
const promptVersion = 'native-research-report-synthesis/v8'

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function fallbackProfileHash(document) {
  const stored = String(document?.synthesis?.sellerProfileHash || '').trim()
  if (/^[a-f0-9]{64}$/.test(stored)) return stored
  return createHash('sha256').update(JSON.stringify(document?.sellerContext || {})).digest('hex')
}

async function main() {
  const { data, error } = await supabase
    .from('research_report_documents')
    .select('id,research_snapshot_id,organization_id,user_id,document,delivery_state')
    .eq('schema_version', schemaVersion)
    .eq('generation_method', 'fallback')
    .neq('delivery_state', 'suppressed')
    .order('created_at', { ascending: true })

  if (error) throw error
  const rows = data || []
  console.log('--- Fallback research report backfill ---')
  console.log(`Mode: ${shouldWrite ? 'WRITE' : 'DRY RUN'}`)
  console.log(`Affected reports: ${rows.length}`)
  console.log('Sample IDs:', rows.slice(0, 10).map((row) => row.id))

  if (!shouldWrite || rows.length === 0) {
    console.log(shouldWrite ? 'No changes needed.' : 'Dry run only. Re-run with --write to suppress and enqueue.')
    return
  }

  const now = new Date().toISOString()
  for (const row of rows) {
    const { error: suppressError } = await supabase
      .from('research_report_documents')
      .update({ delivery_state: 'suppressed', updated_at: now })
      .eq('id', row.id)
      .eq('generation_method', 'fallback')
      .neq('delivery_state', 'suppressed')
    if (suppressError) throw suppressError

    const { error: queueError } = await supabase
      .from('research_report_synthesis_states')
      .upsert({
        research_snapshot_id: row.research_snapshot_id,
        organization_id: row.organization_id,
        user_id: row.user_id,
        schema_version: schemaVersion,
        status: 'queued',
        prompt_version: promptVersion,
        seller_profile_hash: fallbackProfileHash(row.document),
        attempt_count: 0,
        retryable: true,
        error_code: null,
        error_message: null,
        claim_token: null,
        claimed_at: null,
        next_retry_at: now,
        report_document_id: null,
        completed_at: null,
        updated_at: now,
      }, { onConflict: 'research_snapshot_id,schema_version' })
    if (queueError) throw queueError
  }

  console.log(`Suppressed and queued: ${rows.length}`)
}

main().catch((error) => {
  console.error('Backfill failed:', error)
  process.exit(1)
})
