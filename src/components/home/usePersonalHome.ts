'use client';
import {useAuth} from '@/context/AuthContext';
import {useCallback,useEffect,useRef,useState} from 'react';
import {dayInZone} from '@/lib/admin/chile-time';
import {authenticatedApiFetch} from '@/lib/authenticated-api-fetch';
import {useSlow} from '@/hooks/use-slow';
import type {HomeScope} from '@/lib/home/scope';
export function usePersonalHome<T>(url:string){
  const {user,organizationId,loading:authLoading}=useAuth();
  const [day,setDay]=useState(()=>dayInZone(new Date()));
  const key=!authLoading&&user?.id&&organizationId?`${user.id}:${organizationId}:${day}`:'';
  const [state,setState]=useState<{key:string;data:T|null;loading:boolean;error:boolean}>({key:'',data:null,loading:true,error:false});
  const active=useRef<AbortController|null>(null),current=useRef(key);current.current=key;
  const load=useCallback(async()=>{
    active.current?.abort();if(!key)return;const controller=new AbortController();active.current=controller;
    setState(previous=>({key,data:previous.key===key?previous.data:null,loading:true,error:false}));
    try{const response=await authenticatedApiFetch(url,{cache:'no-store',headers:{'x-organization-id':organizationId!},signal:controller.signal});
      const body=await response.json() as T&{scope:HomeScope};
      if(controller.signal.aborted||current.current!==key)return;
      if(!response.ok||body.scope?.userId!==user?.id||body.scope?.organizationId!==organizationId||body.scope?.dayKey!==day)throw Error('Scope changed');
      setState({key,data:body,loading:false,error:false});
    }catch{if(!controller.signal.aborted&&current.current===key)setState({key,data:null,loading:false,error:true});}
  },[key,url,organizationId,user?.id,day]);
  useEffect(()=>{void load();return()=>active.current?.abort();},[load]);
  useEffect(()=>{const refresh=()=>setDay(dayInZone(new Date()));const timer=setInterval(refresh,30000);window.addEventListener('focus',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};},[]);
  // A read that hangs, or one that cannot start because the organization never arrived, says so after a while (APP-02);
  // retrying without an organization reloads the page, which reads it again.
  // Signed in but without an organization (its read failed): nothing can load, and that is said at once.
  const ready=state.key===key&&!!key,noOrganization=!authLoading&&!!user?.id&&!organizationId;
  const slow=useSlow(!ready||(state.loading&&!state.data));
  const retry=useCallback(()=>{if(key)return load();window.location.reload();},[key,load]);
  if(noOrganization)return{data:null,loading:false,error:true,slow:false,load:retry};
  return ready?{data:state.data,loading:state.loading,error:state.error,slow,load:retry}:{data:null,loading:true,error:false,slow,load:retry};
}
