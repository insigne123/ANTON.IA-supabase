'use client';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {Input} from '@/components/ui/input';
export function OpportunityTicketConnection(){
 const [ticket,setTicket]=useState(''),[busy,setBusy]=useState(false),[feedback,setFeedback]=useState(''),[connected,setConnected]=useState(false);
 useEffect(()=>{const controller=new AbortController();fetch('/api/commercial-opportunities/ticket',{cache:'no-store',signal:controller.signal}).then(async r=>{if(!r.ok)return;const body=await r.json();if(!controller.signal.aborted)setConnected(Boolean(body.ticket?.connected||body.ticket?.shared));}).catch(()=>undefined);return()=>controller.abort();},[]);
 return <section className="space-y-3 rounded-xl border p-4"><h3 className="font-medium">Mercado Público</h3><p className="text-sm text-muted-foreground">{connected?'Ticket disponible para la búsqueda del workspace.':'Conecta el ticket una vez desde tu cuenta administradora para consultar licitaciones y Compra Ágil.'}</p><Label htmlFor="op-ticket-value">Ticket de Mercado Público</Label><Input id="op-ticket-value" type="password" autoComplete="off" value={ticket} onChange={e=>setTicket(e.target.value)} placeholder="Pegar ticket"/><Button type="button" variant="outline" disabled={busy||!ticket.trim()} onClick={async()=>{setBusy(true);try{const response=await fetch('/api/commercial-opportunities/ticket',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket})});const body=await response.json();if(!response.ok)throw Error(body.error);setTicket('');setConnected(true);setFeedback('Ticket comprobado y conectado.');}catch(e){setFeedback(e instanceof Error?e.message:'No se pudo conectar.');}finally{setBusy(false);}}}>Comprobar y conectar</Button>{feedback&&<p role="status" className="text-sm">{feedback}</p>}</section>;
}
