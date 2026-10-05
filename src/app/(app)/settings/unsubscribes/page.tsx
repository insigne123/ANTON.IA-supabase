'use client';

// «Bajas y bloqueos» (Plan 9, PR-18): who must not receive emails, by address or by whole domain. Blocking a single address
// is new (before, only domains could be added); removing either asks first; «Probar bloqueo» says plainly whether an
// address can be written to, without treating a contactable address as an error.
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, RefreshCw, ShieldBan, ShieldCheck, Trash2 } from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { useConfirm } from '@/components/confirm-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { formatDate } from '@/lib/dates';
import { domainService, type ExcludedDomain } from '@/lib/services/domain-service';
import { organizationService } from '@/lib/services/organization-service';
import { unsubscribeService, type UnsubscribedEmail } from '@/lib/services/unsubscribe-service';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
type TestResult = { tone: 'blocked' | 'review' | 'clear' | 'error'; message: string };

const TEST_ALERT: Record<TestResult['tone'], 'success' | 'warning' | 'info' | 'destructive'> = {
  blocked: 'success', review: 'warning', clear: 'info', error: 'destructive',
};

export default function UnsubscribesPage() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  // A failed read is said on the page: «Correos (0)» would read as «nobody is blocked».
  const [loadError, setLoadError] = useState(false);
  const [emailList, setEmailList] = useState<UnsubscribedEmail[]>([]);
  const [domainList, setDomainList] = useState<ExcludedDomain[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [emailOpen, setEmailOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [addingEmail, setAddingEmail] = useState(false);
  const [domainOpen, setDomainOpen] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [addingDomain, setAddingDomain] = useState(false);

  const [testOpen, setTestOpen] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [emails, domains] = await Promise.all([
        unsubscribeService.getBlacklist({ strict: true }), domainService.getExcludedDomains({ strict: true }),
      ]);
      setEmailList(emails);
      setDomainList(domains);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const cleanEmail = newEmail.trim().toLowerCase();
  const cleanDomain = newDomain.trim().toLowerCase().replace(/^@/, '');

  async function addEmail() {
    if (!EMAIL_PATTERN.test(cleanEmail) || !user) return;
    setAddingEmail(true);
    try {
      const organizationId = await organizationService.getCurrentOrganizationId();
      await unsubscribeService.addToBlacklist(cleanEmail, user.id, organizationId, 'Bloqueado a mano');
      toast({ title: 'Correo bloqueado', description: `${cleanEmail} no recibirá más correos.` });
      setEmailOpen(false);
      setNewEmail('');
      setEmailList(await unsubscribeService.getBlacklist());
    } catch {
      toast({ variant: 'destructive', title: 'No se pudo bloquear el correo', description: 'Revisa la dirección e intenta de nuevo.' });
    } finally {
      setAddingEmail(false);
    }
  }

  async function addDomain() {
    if (!DOMAIN_PATTERN.test(cleanDomain)) return;
    setAddingDomain(true);
    try {
      await domainService.addDomain(cleanDomain);
      toast({ title: 'Dominio bloqueado', description: `Ningún correo de @${cleanDomain} será contactado.` });
      setDomainOpen(false);
      setNewDomain('');
      setDomainList(await domainService.getExcludedDomains());
    } catch {
      toast({ variant: 'destructive', title: 'No se pudo bloquear el dominio', description: 'Intenta de nuevo en unos minutos.' });
    } finally {
      setAddingDomain(false);
    }
  }

  async function removeEmail(item: UnsubscribedEmail) {
    const ok = await confirm({
      title: `¿Desbloquear ${item.email}?`,
      description: 'Se le podrá volver a escribir. Si se dio de baja, respeta su decisión antes de hacerlo.',
      confirmLabel: 'Desbloquear',
      tone: 'danger',
    });
    if (!ok) return;
    setRemovingId(item.id);
    try {
      await unsubscribeService.removeFromBlacklist(item.id);
      setEmailList((current) => current.filter((value) => value.id !== item.id));
      toast({ title: 'Correo desbloqueado' });
    } catch {
      toast({ variant: 'destructive', title: 'No se pudo desbloquear', description: 'Intenta de nuevo en unos minutos.' });
    } finally {
      setRemovingId(null);
    }
  }

  async function removeDomain(item: ExcludedDomain) {
    const ok = await confirm({
      title: `¿Desbloquear @${item.domain}?`,
      description: 'Se podrá volver a escribir a los correos de ese dominio.',
      confirmLabel: 'Desbloquear',
      tone: 'danger',
    });
    if (!ok) return;
    setRemovingId(item.id);
    try {
      await domainService.removeDomain(item.id);
      setDomainList((current) => current.filter((value) => value.id !== item.id));
      toast({ title: 'Dominio desbloqueado' });
    } catch {
      toast({ variant: 'destructive', title: 'No se pudo desbloquear', description: 'Intenta de nuevo en unos minutos.' });
    } finally {
      setRemovingId(null);
    }
  }

  async function runTest() {
    const email = testEmail.trim();
    if (!email) return;
    setTesting(true);
    setTestResult(null);
    try {
      const response = await fetch(`/api/privacy/contactability?email=${encodeURIComponent(email)}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'No pudimos comprobar este correo.');
      if (data?.status === 'blocked') setTestResult({ tone: 'blocked', message: data?.description || 'Bloqueado: este correo no recibirá envíos.' });
      else if (data?.status === 'warning') setTestResult({ tone: 'review', message: data?.description || 'Requiere revisión antes de escribirle.' });
      else setTestResult({ tone: 'clear', message: 'Sin bloqueos: se le puede escribir. No se envió ningún mensaje.' });
    } catch (error) {
      setTestResult({ tone: 'error', message: error instanceof Error && error.message ? error.message : 'No pudimos comprobar este correo.' });
    } finally {
      setTesting(false);
    }
  }

  const removeButton = (label: string, busy: boolean, onClick: () => void) => (
    <Button size="icon" variant="ghost" className="text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={busy} onClick={onClick} aria-label={label}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
    </Button>
  );
  const loadingRow = (columns: number) => (
    <TableRow><TableCell colSpan={columns} className="py-8 text-center text-foreground/70" role="status">Cargando…</TableCell></TableRow>
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader
        title="Bajas y bloqueos"
        back={{ href: '/settings/privacy', label: 'Privacidad' }}
        description="Quién no debe recibir correos, por dirección o por dominio completo."
        actions={
          <Dialog open={testOpen} onOpenChange={(open) => { setTestOpen(open); if (!open) setTestResult(null); }}>
            <DialogTrigger asChild>
              <Button variant="outline"><ShieldCheck className="h-4 w-4" aria-hidden="true" /> Probar bloqueo</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Probar bloqueo</DialogTitle>
                <DialogDescription>Escribe un correo para saber si se le puede escribir. No se envía nada.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-2">
                  <Label htmlFor="test-email">Correo</Label>
                  <Input id="test-email" type="email" placeholder="persona@empresa.com" value={testEmail} onChange={(event) => setTestEmail(event.target.value)} />
                </div>
                {testResult ? (
                  <Alert variant={TEST_ALERT[testResult.tone]} role="status">
                    <AlertDescription>{testResult.message}</AlertDescription>
                  </Alert>
                ) : null}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setTestOpen(false)}>Cerrar</Button>
                <Button onClick={() => void runTest()} disabled={testing || !testEmail.trim()}>
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null} Comprobar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {loadError ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>No pudimos cargar los bloqueos. Revisa tu conexión y vuelve a intentarlo.</span>
            <Button variant="outline" size="sm" onClick={() => void loadData()} disabled={loading}>Reintentar</Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs defaultValue="emails" className="w-full">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="emails">Correos{loadError ? '' : ` (${emailList.length})`}</TabsTrigger>
            <TabsTrigger value="domains">Dominios{loadError ? '' : ` (${domainList.length})`}</TabsTrigger>
          </TabsList>
          <Button variant="ghost" size="sm" onClick={() => void loadData()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" /> Actualizar
          </Button>
        </div>

        <TabsContent value="emails">
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-base">Correos bloqueados</CardTitle>
                <CardDescription>Quienes se dieron de baja o pidieron no ser contactados, y los que bloqueas a mano.</CardDescription>
              </div>
              <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
                <DialogTrigger asChild>
                  <Button size="sm"><Plus className="h-4 w-4" aria-hidden="true" /> Bloquear correo</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Bloquear un correo</DialogTitle>
                    <DialogDescription>Esa dirección no recibirá más correos de tu organización.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2 py-2">
                    <Label htmlFor="block-email">Correo</Label>
                    <Input id="block-email" type="email" placeholder="persona@empresa.com" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} aria-invalid={Boolean(cleanEmail) && !EMAIL_PATTERN.test(cleanEmail)} />
                    {cleanEmail && !EMAIL_PATTERN.test(cleanEmail) ? <p className="text-xs text-destructive">Escribe un correo completo, como persona@empresa.com.</p> : null}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setEmailOpen(false)}>Cancelar</Button>
                    <Button onClick={() => void addEmail()} disabled={addingEmail || !EMAIL_PATTERN.test(cleanEmail)}>
                      {addingEmail ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null} Bloquear
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-foreground/70">Correo</TableHead>
                      <TableHead className="hidden text-foreground/70 sm:table-cell">Motivo</TableHead>
                      <TableHead className="text-foreground/70">Fecha</TableHead>
                      <TableHead className="text-right text-foreground/70"><span className="sr-only">Acciones</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading && emailList.length === 0 ? loadingRow(4) : emailList.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="py-8 text-center text-foreground/70">{loadError ? 'No se pudieron leer los correos bloqueados.' : 'No hay correos bloqueados.'}</TableCell></TableRow>
                    ) : emailList.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="break-all font-medium">{item.email}</TableCell>
                        <TableCell className="hidden text-sm text-foreground/70 sm:table-cell">{item.reason || 'Sin motivo'}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-foreground/70">{formatDate(item.created_at, { year: true })}</TableCell>
                        <TableCell className="text-right">{removeButton(`Desbloquear ${item.email}`, removingId === item.id, () => void removeEmail(item))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="domains">
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-base">Dominios bloqueados</CardTitle>
                <CardDescription>Si bloqueas un dominio, no se contacta a ningún correo de ese dominio.</CardDescription>
              </div>
              <Dialog open={domainOpen} onOpenChange={setDomainOpen}>
                <DialogTrigger asChild>
                  <Button size="sm"><ShieldBan className="h-4 w-4" aria-hidden="true" /> Bloquear dominio</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Bloquear un dominio</DialogTitle>
                    <DialogDescription>Escribe el dominio sin @, por ejemplo competencia.cl.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2 py-2">
                    <Label htmlFor="block-domain">Dominio</Label>
                    <Input id="block-domain" placeholder="competencia.cl" value={newDomain} onChange={(event) => setNewDomain(event.target.value)} aria-invalid={Boolean(cleanDomain) && !DOMAIN_PATTERN.test(cleanDomain)} />
                    {cleanDomain && !DOMAIN_PATTERN.test(cleanDomain) ? <p className="text-xs text-destructive">Escribe un dominio, como empresa.cl.</p> : null}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDomainOpen(false)}>Cancelar</Button>
                    <Button onClick={() => void addDomain()} disabled={addingDomain || !DOMAIN_PATTERN.test(cleanDomain)}>
                      {addingDomain ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null} Bloquear
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-foreground/70">Dominio</TableHead>
                      <TableHead className="text-foreground/70">Fecha</TableHead>
                      <TableHead className="text-right text-foreground/70"><span className="sr-only">Acciones</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading && domainList.length === 0 ? loadingRow(3) : domainList.length === 0 ? (
                      <TableRow><TableCell colSpan={3} className="py-8 text-center text-foreground/70">{loadError ? 'No se pudieron leer los dominios bloqueados.' : 'No hay dominios bloqueados.'}</TableCell></TableRow>
                    ) : domainList.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="break-all font-medium">@{item.domain}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-foreground/70">{formatDate(item.created_at, { year: true })}</TableCell>
                        <TableCell className="text-right">{removeButton(`Desbloquear @${item.domain}`, removingId === item.id, () => void removeDomain(item))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
