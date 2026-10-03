import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

import { isPrivacyAdminEmail } from '@/lib/server/privacy-admin';

/**
 * The privacy requests and incidents pages are for the PRIVACY_ADMIN_EMAILS only, the same list their APIs check.
 * Anyone else gets the 404 before the page loads, instead of an empty screen and 403s from the API.
 */
export async function requirePrivacyAdminPage() {
  const supabase = createServerComponentClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isPrivacyAdminEmail(user.email)) notFound();
  return user;
}
