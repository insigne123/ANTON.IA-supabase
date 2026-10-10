'use client';
import {useAuth} from '@/context/AuthContext';
import {useCallback,useEffect,useRef,useState} from 'react';
import {dayInZone} from '@/lib/admin/chile-time';
import {authenticatedApiFetch} from '@/lib/authenticated-api-fetch';
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
  return state.key===key&&key?{data:state.data,loading:state.loading,error:state.error,load}:{data:null,loading:true,error:false,load};
}
