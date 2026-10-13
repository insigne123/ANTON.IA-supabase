'use client';
import {useState} from 'react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
export function OpportunityReconsiderDialog({open,onOpenChange,onConfirm,busy}:{open:boolean;onOpenChange:(value:boolean)=>void;onConfirm:(reason:string)=>Promise<boolean>;busy:boolean}){
 const [reason,setReason]=useState('');
 return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Analizar de todos modos</DialogTitle><DialogDescription>Conservaremos la evaluación inicial y registraremos por qué quieres investigar esta oportunidad.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={e=>{e.preventDefault();void onConfirm(reason).then(done=>{if(done){setReason('');onOpenChange(false);}});}}><Label htmlFor="op-reconsider-reason">Motivo para reconsiderar</Label><Textarea id="op-reconsider-reason" value={reason} onChange={e=>setReason(e.target.value)} minLength={3} maxLength={2000} required/><div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={()=>onOpenChange(false)}>Cancelar</Button><Button disabled={busy||reason.trim().length<3}>Registrar y analizar</Button></div></form></DialogContent></Dialog>;
}
