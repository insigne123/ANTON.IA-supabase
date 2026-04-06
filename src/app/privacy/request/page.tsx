'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { legalConfig } from '@/lib/legal-config';
import { privacyRequestRelations, privacyRequestTypes, type PrivacyRequestRelation, type PrivacyRequestType } from '@/lib/privacy-request';

const defaultType: PrivacyRequestType = 'access';
const defaultRelation: PrivacyRequestRelation = 'self';

export default function PrivacyRequestPage() {
  const [requestType, setRequestType] = useState<PrivacyRequestType>(defaultType);
  const [relationToData, setRelationToData] = useState<PrivacyRequestRelation>(defaultRelation);
  const [requesterName, setRequesterName] = useState('');
  const [requesterEmail, setRequesterEmail] = useState('');
  const [requesterCompany, setRequesterCompany] = useState('');
  const [targetEmail, setTargetEmail] = useState('');
  const [details, setDetails] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('submitting');
    setMessage('');

    try {
      const response = await fetch('/api/privacy/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestType,
          relationToData,
          requesterName,
          requesterEmail,
          requesterCompany,
          targetEmail,
          details,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'No se pudo registrar la solicitud.');
      }

      setStatus('success');
      setRequestId(data?.requestId || null);
      setMessage('Tu solicitud fue registrada correctamente.');
      setRequesterName('');
      setRequesterEmail('');
      setRequesterCompany('');
      setTargetEmail('');
      setDetails('');
      setRequestType(defaultType);
      setRelationToData(defaultRelation);
    } catch (error: any) {
      setStatus('error');
      setMessage(error?.message || 'No se pudo registrar la solicitud.');
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 py-10 md:px-10">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/privacy">
            <Button variant="ghost" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Volver a privacidad
            </Button>
          </Link>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 text-primary">
              <ShieldCheck className="h-5 w-5" />
              <span className="text-sm font-medium">Canal formal de privacidad</span>
            </div>
            <CardTitle>Solicitud de derechos sobre datos personales</CardTitle>
            <CardDescription>
              Usa este formulario para pedir acceso, rectificacion, supresion, oposicion, portabilidad, bloqueo u otra gestion relacionada con tus datos.
              Si prefieres, tambien puedes escribir a <a className="underline" href={`mailto:${legalConfig.privacyContactEmail}`}>{legalConfig.privacyContactEmail}</a>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {status === 'success' ? (
              <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                <p className="font-medium">{message}</p>
                {requestId ? <p>ID de solicitud: <code>{requestId}</code></p> : null}
                <p>Guardamos este identificador para ayudarte a hacer seguimiento interno de la solicitud.</p>
                <Button variant="outline" onClick={() => { setStatus('idle'); setMessage(''); setRequestId(null); }}>
                  Registrar otra solicitud
                </Button>
              </div>
            ) : (
              <form className="space-y-5" onSubmit={handleSubmit}>
                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="privacy-request-type">Tipo de solicitud</Label>
                    <Select value={requestType} onValueChange={(value) => setRequestType(value as PrivacyRequestType)}>
                      <SelectTrigger id="privacy-request-type">
                        <SelectValue placeholder="Selecciona una opcion" />
                      </SelectTrigger>
                      <SelectContent>
                        {privacyRequestTypes.map((item) => (
                          <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="privacy-request-relation">Relacion con los datos</Label>
                    <Select value={relationToData} onValueChange={(value) => setRelationToData(value as PrivacyRequestRelation)}>
                      <SelectTrigger id="privacy-request-relation">
                        <SelectValue placeholder="Selecciona una opcion" />
                      </SelectTrigger>
                      <SelectContent>
                        {privacyRequestRelations.map((item) => (
                          <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="privacy-request-name">Nombre completo</Label>
                    <Input id="privacy-request-name" value={requesterName} onChange={(event) => setRequesterName(event.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="privacy-request-email">Correo de contacto</Label>
                    <Input id="privacy-request-email" type="email" value={requesterEmail} onChange={(event) => setRequesterEmail(event.target.value)} required />
                  </div>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="privacy-request-company">Empresa u organizacion</Label>
                    <Input id="privacy-request-company" value={requesterCompany} onChange={(event) => setRequesterCompany(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="privacy-request-target-email">Correo del dato consultado</Label>
                    <Input
                      id="privacy-request-target-email"
                      type="email"
                      placeholder="Si aplica, puedes indicar otro correo"
                      value={targetEmail}
                      onChange={(event) => setTargetEmail(event.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="privacy-request-details">Detalle de la solicitud</Label>
                  <Textarea
                    id="privacy-request-details"
                    value={details}
                    onChange={(event) => setDetails(event.target.value)}
                    required
                    minLength={20}
                    placeholder="Explica que datos quieres consultar, corregir, eliminar o bloquear, y cualquier contexto que nos ayude a revisar tu caso."
                  />
                </div>

                {status === 'error' && message ? (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {message}
                  </div>
                ) : null}

                <div className="flex items-center justify-between gap-3 pt-2">
                  <p className="text-sm text-muted-foreground">
                    Este formulario registra la solicitud para revision interna de {legalConfig.legalEntityName}.
                  </p>
                  <Button type="submit" disabled={status === 'submitting'}>
                    {status === 'submitting' ? 'Enviando...' : 'Enviar solicitud'}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
