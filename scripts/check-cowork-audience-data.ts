// Explicit read-only diagnostic; no test data, writes or mailbox access.
import { createClient } from '@supabase/supabase-js';
import { readCoworkAudience } from '../src/lib/server/cowork/audience-read';
import { writeFileSync } from 'node:fs';

async function main() {
  if (!process.argv.includes('--live') || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://yfdelflsheurzaicwayi.supabase.co') throw new Error('Explicit production read configuration required');
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const organizationId = 'e73dd11f-c8db-4ffc-9711-47dc74295064';
  const member = await client.from('organization_members').select('user_id').eq('organization_id', organizationId)
    .eq('user_id', 'de3a3194-29b1-449a-828a-53608a7ebe47').maybeSingle();
  if (member.error || !member.data) throw new Error('Scope unavailable');
  const result = await readCoworkAudience(client, organizationId);
  const report = { queriedAt: result.queriedAt, coverage: result.coverage, verticalCount: result.verticals.length,
    companiesObservedAcrossVerticals: result.verticals.reduce((total, row) => total + row.companiesObserved, 0),
    withheldPercentages: result.verticals.filter(row => row.newCompanyPercent === null).length,
    missingCompany: result.missingCompany, contactsReturned: result.contacts.length, contactsTruncated: result.contactsTruncated,
    limitation: result.limitation, consistency: result.consistency };
  const text = JSON.stringify(report, null, 2);
  const output = process.argv.find(a => a.startsWith('--output='))?.slice(9);
  if (output) writeFileSync(output, text + '\n');
  console.log(text);
}
main().catch(() => { console.error('Audience read failed; no private details displayed.'); process.exitCode = 1; });
