import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const baseUrl = String(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:9003').replace(/\/$/, '')
const internalSecret = String(process.env.INTERNAL_API_SECRET || '').trim()
const userId = String(process.env.LINKEDIN_PROFILE_TEST_USER_ID || '').trim()
const linkedinUrl = String(process.env.LINKEDIN_PROFILE_TEST_URL || '').trim()

if (!internalSecret || !userId || !linkedinUrl) {
  console.error('Faltan variables requeridas: INTERNAL_API_SECRET, LINKEDIN_PROFILE_TEST_USER_ID, LINKEDIN_PROFILE_TEST_URL')
  process.exit(1)
}

async function main() {
  console.log('--- Verify LinkedIn Profile Search ---')
  console.log(`Base URL: ${baseUrl}`)

  const response = await fetch(`${baseUrl}/api/leads/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-api-secret': internalSecret,
      'x-user-id': userId,
    },
    body: JSON.stringify({
      search_mode: 'linkedin_profile',
      linkedin_url: linkedinUrl,
      reveal_email: true,
      reveal_phone: true,
    }),
  })

  const data = await response.json().catch(() => null)
  console.log(`Status: ${response.status}`)
  if (!response.ok) {
    console.error(JSON.stringify(data, null, 2))
    process.exit(1)
  }

  const lead = Array.isArray(data?.leads) ? data.leads[0] : null
  const phone = lead?.primary_phone || lead?.phone_numbers?.[0]?.sanitized_number || null

  console.log(JSON.stringify({
    provider: response.headers.get('x-provider-used'),
    count: data?.count,
    requested_reveal: data?.requested_reveal,
    effective_reveal: data?.effective_reveal,
    phone_enrichment: data?.phone_enrichment,
    lead: lead
      ? {
          id: lead.id,
          name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
          email: lead.email || null,
          phone,
          enrichment_status: lead.enrichment_status || null,
        }
      : null,
  }, null, 2))
}

main().catch((error) => {
  console.error('Verification failed:', error)
  process.exit(1)
})
