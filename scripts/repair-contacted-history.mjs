import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const shouldWrite = process.argv.includes('--write')
const pageSize = 500

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function getExpectedStatus(row) {
  const deliveryStatus = String(row.delivery_status || '').trim()
  const replyIntent = String(row.reply_intent || '').trim()

  if (row.replied_at) return 'replied'
  if (replyIntent === 'delivery_failure') return 'failed'
  if (['bounced', 'soft_bounced'].includes(deliveryStatus)) return 'failed'
  return null
}

async function main() {
  console.log('--- Repair Contacted History ---')
  console.log(`Mode: ${shouldWrite ? 'WRITE' : 'DRY RUN'}`)

  let from = 0
  let scanned = 0
  const updates = []

  while (true) {
    const to = from + pageSize - 1
    const { data, error } = await supabase
      .from('contacted_leads')
      .select('id, status, replied_at, delivery_status, reply_intent, last_update_at')
      .range(from, to)
      .order('sent_at', { ascending: false })

    if (error) throw error
    if (!data || data.length === 0) break

    scanned += data.length

    for (const row of data) {
      const expectedStatus = getExpectedStatus(row)
      if (!expectedStatus) continue
      if (row.status === expectedStatus) continue

      updates.push({
        id: row.id,
        fromStatus: row.status,
        toStatus: expectedStatus,
      })
    }

    if (data.length < pageSize) break
    from += pageSize
  }

  console.log(`Scanned: ${scanned}`)
  console.log(`Mismatches found: ${updates.length}`)

  if (updates.length > 0) {
    const grouped = updates.reduce((acc, item) => {
      const key = `${item.fromStatus || 'null'} -> ${item.toStatus}`
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
    console.log('Breakdown:', grouped)
    console.log('Sample:', updates.slice(0, 10))
  }

  if (!shouldWrite || updates.length === 0) {
    console.log(shouldWrite ? 'No changes needed.' : 'Dry run only. Re-run with --write to persist changes.')
    return
  }

  const now = new Date().toISOString()
  for (const item of updates) {
    const { error } = await supabase
      .from('contacted_leads')
      .update({
        status: item.toStatus,
        last_update_at: now,
      })
      .eq('id', item.id)

    if (error) throw error
  }

  console.log(`Updated rows: ${updates.length}`)
}

main().catch((error) => {
  console.error('Repair failed:', error)
  process.exit(1)
})
