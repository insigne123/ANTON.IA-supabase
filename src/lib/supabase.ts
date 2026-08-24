import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getBrowserStorage } from './browser-storage';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Missing Supabase environment variables');
}

type BrowserSupabaseClient = SupabaseClient<any, 'public', any>;

let browserClient: BrowserSupabaseClient | null = null;

function getSupabaseBrowserClient() {
  const storage = getBrowserStorage();
  if (!storage) return null;

  if (!browserClient) {
    browserClient = createClientComponentClient({
      supabaseUrl,
      supabaseKey: supabaseAnonKey,
    });
  }

  return browserClient;
}

export const supabase = new Proxy({}, {
  get(_target, prop) {
    const client = getSupabaseBrowserClient();
    if (!client) {
      return undefined;
    }

    const value = (client as any)[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
}) as BrowserSupabaseClient;
