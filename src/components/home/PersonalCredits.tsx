'use client';
import {usePersonalHome} from './usePersonalHome';
import {Card,CardContent} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
export function PersonalCredits(){
  const {data,loading,error,load}=usePersonalHome<{personal:{count:number;limit:number}|null;available:number|null;resetAtISO:string;legacy:boolean;mode:string}>('/api/home/credits');
  return <Card className="rounded-2xl"><CardContent className="p-4"><h2 className="text-sm font-semibold">Tu cupo disponible</h2>
    {error?<><p role="alert" className="mt-2 text-sm text-muted-foreground">No pudimos comprobar tu cupo.</p><Button variant="ghost" size="sm" onClick={()=>void load()}>Reintentar</Button></>:loading&&!data?<p role="status" className="mt-2 text-sm">Consultando tu cupo…</p>:data?.personal?<><p className="mt-3 text-2xl font-semibold tabular-nums">{data.available??Math.max(0,data.personal.limit-data.personal.count)} <span className="text-xs font-normal text-muted-foreground">disponibles para ti</span></p><p className="mt-2 text-xs text-muted-foreground">{data.personal.count} de {data.personal.limit} usados en el cupo UTC. {data.legacy?'Cupo de tu cuenta, compartido entre tus workspaces.':'Cupo individual en este workspace.'}{data.mode==='hybrid'?' El límite compartido también condiciona la disponibilidad.':''}</p></>:<p className="mt-2 text-sm text-muted-foreground">Usas el cupo compartido de tu equipo; no tienes un cupo individual activo.</p>}
    <p className="mt-2 text-xs text-muted-foreground">Disponibilidad, no estadística comercial · reinicio diario a medianoche UTC.</p></CardContent></Card>;
}
