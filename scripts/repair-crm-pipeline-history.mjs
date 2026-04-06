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

function compact(items) {
  return items.filter(Boolean)
}

function derivePipelineUpdate(row) {
  const replyIntent = String(row.reply_intent || '').trim()
  const hasReply = Boolean(row.replied_at)
  const deliveryStatus = String(row.delivery_status || '').trim()

  if (replyIntent === 'meeting_request') {
    return {
      stage: 'meeting',
      autopilot_status: 'meeting_requested',
      last_autopilot_event: 'meeting_request',
      next_action_type: 'book_meeting',
    }
  }

  if (replyIntent === 'positive' || (hasReply && !['negative', 'unsubscribe', 'delivery_failure', 'auto_reply'].includes(replyIntent))) {
    return {
      stage: 'engaged',
      autopilot_status: 'positive_reply',
      last_autopilot_event: replyIntent || 'reply',
      next_action_type: 'reply_followup',
    }
  }

  if (replyIntent === 'negative' || replyIntent === 'unsubscribe' || replyIntent === 'delivery_failure' || ['bounced', 'soft_bounced'].includes(deliveryStatus)) {
    return {
      stage: 'closed_lost',
      autopilot_status: replyIntent === 'unsubscribe' ? 'unsubscribed' : (replyIntent || 'delivery_failure'),
      last_autopilot_event: replyIntent || deliveryStatus || 'delivery_failure',
      next_action_type: 'do_not_contact',
    }
  }

  if (String(row.status || '').trim() === 'sent') {
    return {
      stage: 'contacted',
      autopilot_status: 'contacted',
      last_autopilot_event: 'contact_sent',
      next_action_type: 'wait_for_reply',
    }
  }

  return null
}

async function main() {
  console.log('--- Repair CRM Pipeline History ---')
  console.log(`Mode: ${shouldWrite ? 'WRITE' : 'DRY RUN'}`)

  let from = 0
  let scanned = 0
  const updates = []

  while (true) {
    const to = from + pageSize - 1
    const { data, error } = await supabase
      .from('contacted_leads')
      .select('id, lead_id, organization_id, status, replied_at, reply_intent, delivery_status')
      .not('lead_id', 'is', null)
      .range(from, to)
      .order('sent_at', { ascending: false })

    if (error) throw error
    if (!data || data.length === 0) break
    scanned += data.length

    for (const row of data) {
      const next = derivePipelineUpdate(row)
      if (!next) continue

      const ids = compact([
        `lead_saved|${String(row.lead_id).trim()}`,
        `lead_enriched|${String(row.lead_id).trim()}`,
      ])

      const { data: currentRows, error: currentError } = await supabase
        .from('unified_crm_data')
        .select('id, stage, autopilot_status, last_autopilot_event, next_action_type')
        .in('id', ids)

      if (currentError) throw currentError

      for (const current of currentRows || []) {
        if (
          current.stage === next.stage &&
          current.autopilot_status === next.autopilot_status &&
          current.last_autopilot_event === next.last_autopilot_event &&
          current.next_action_type === next.next_action_type
        ) {
          continue
        }

        updates.push({
          id: current.id,
          from: {
            stage: current.stage,
            autopilot_status: current.autopilot_status,
            last_autopilot_event: current.last_autopilot_event,
            next_action_type: current.next_action_type,
          },
          to: next,
        })
      }
    }

    if (data.length < pageSize) break
    from += pageSize
  }

  console.log(`Scanned contacted rows: ${scanned}`)
  console.log(`CRM rows needing update: ${updates.length}`)
  if (updates.length > 0) {
    console.log('Sample:', updates.slice(0, 10))
  }

  if (!shouldWrite || updates.length === 0) {
    console.log(shouldWrite ? 'No changes needed.' : 'Dry run only. Re-run with --write to persist changes.')
    return
  }

  const now = new Date().toISOString()
  for (const item of updates) {
    const { error } = await supabase
      .from('unified_crm_data')
      .update({
        stage: item.to.stage,
        autopilot_status: item.to.autopilot_status,
        last_autopilot_event: item.to.last_autopilot_event,
        next_action_type: item.to.next_action_type,
        updated_at: now,
      })
      .eq('id', item.id)

    if (error) throw error
  }

  console.log(`Updated CRM rows: ${updates.length}`)
}

main().catch((error) => {
  console.error('Repair failed:', error)
  process.exit(1)
})
