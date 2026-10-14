import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
type Db={from(table:string):any};

export type MirrorUsage = {
  period: string;
  /** Runs started on Apify and what they cost. */
  runs: number; spentUsd: number; leadsBought: number;
  /** Contacts that took their email or mobile from the cache instead of an Apollo reveal. */
  contactsFromCache: number; withPhoneFromCache: number;
  /** What each contact served from the cache cost on Apify; null before the first one. */
  usdPerCachedContact: number | null;
};
const round=(value:number,digits=4)=>Math.round(value*10**digits)/10**digits;

/** Whether the mirror pays off in a month (`YYYY-MM`, UTC): Apify spent against Apollo reveals avoided, across organizations. */
export async function mirrorUsage(period=new Date().toISOString().slice(0,7),db:Db=getSupabaseAdminClient() as any):Promise<MirrorUsage> {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))throw Error('MIRROR_USAGE_PERIOD');
  const start=`${period}-01`,next=new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5)),1)).toISOString();
  const [jobs,items]=await Promise.all([
    db.from('microworlds_search_jobs').select('billed_micro_usd,fetched,provider_run_id').eq('period',start).not('provider_run_id','is',null).limit(5000),
    db.from('hybrid_enrichment_items').select('requested_phone').eq('cache_processed',true).gte('created_at',`${start}T00:00:00Z`).lt('created_at',next).limit(20000),
  ]);
  if(jobs.error||items.error)throw Error('MIRROR_USAGE_UNAVAILABLE');
  const runs=jobs.data||[],served=items.data||[];
  const spentUsd=runs.reduce((sum:number,job:any)=>sum+Number(job.billed_micro_usd||0),0)/1e6;
  return {period,runs:runs.length,spentUsd:round(spentUsd),leadsBought:runs.reduce((sum:number,job:any)=>sum+Number(job.fetched||0),0),
    contactsFromCache:served.length,withPhoneFromCache:served.filter((item:any)=>item.requested_phone).length,
    usdPerCachedContact:served.length?round(spentUsd/served.length):null};
}
