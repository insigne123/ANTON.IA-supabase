'use client';
import {useEffect,useState} from 'react';

/** A server permission for menu visibility, never an authorization substitute. */
export function useAdminUsageAccess(userId?:string|null,organizationId?:string|null){
  const scope=userId?`${userId}:${organizationId||''}`:'';
  const [answer,setAnswer]=useState({scope:'',allowed:false});
  useEffect(()=>{
    if(!scope)return;const controller=new AbortController();
    void fetch('/api/dashboard/admin/usage/access',{cache:'no-store',signal:controller.signal}).then(async response=>{
      const body=response.ok?await response.json():null;
      if(!controller.signal.aborted)setAnswer({scope,allowed:body?.canView===true});
    }).catch(()=>{if(!controller.signal.aborted)setAnswer({scope,allowed:false});});
    return()=>controller.abort();
  },[scope]);
  return Boolean(scope&&answer.scope===scope&&answer.allowed);
}
