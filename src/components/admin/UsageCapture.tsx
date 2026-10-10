'use client';
import {useEffect,useRef} from 'react';
import {usePathname} from 'next/navigation';
import {useAuth} from '@/context/AuthContext';
import {usageModuleForPath} from '@/lib/admin/usage';

/** One observation per real route transition. No content, query strings, idle timers or worker activity. */
export function UsageCapture(){
  const {user,organizationId,loading}=useAuth(),pathname=usePathname();
  const visit=useRef<{key:string;eventId:string;sessionId:string}|null>(null);
  useEffect(()=>{
    const feature=usageModuleForPath(pathname);if(loading||!user?.id||!organizationId||!feature)return;
    const key=`${user.id}:${organizationId}:${pathname}`;
    if(visit.current?.key===key)return;
    let sessionId:string;
    try{const storageKey=`antonia:usage-session:${user.id}`;sessionId=sessionStorage.getItem(storageKey)||crypto.randomUUID();sessionStorage.setItem(storageKey,sessionId);}
    catch{sessionId=crypto.randomUUID();}
    const eventId=crypto.randomUUID();visit.current={key,eventId,sessionId};
    void fetch('/api/usage/view',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({eventId,sessionId,organizationId,module:feature}),keepalive:true}).catch(()=>{});
  },[loading,user?.id,organizationId,pathname]);
  return null;
}
