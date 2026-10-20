'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Loader2, Mail, RefreshCw, Users } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { authenticatedApiFetch } from '@/lib/authenticated-api-fetch';
import { cn } from '@/lib/utils';
import { REPORT_ROLES, deltaText, nextActions, personalHeadline, rate, teamActivity, teamHeadline, type ReportRole, type TeamMember, type WeeklyReport as Report } from '@/lib/weekly-report';

type Response = { report: Report; email: boolean; mailbox: 'google' | 'outlook' | null; managers?: string[]; members?: Array<{ userId: string; name: string; email: string | null }> };

const MAILBOX: Record<string, string> = { google: 'Gmail', outlook: 'Outlook' };
const dateLabel = (at: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-CL', { ...options, timeZone: 'America/Santiago' }).format(new Date(at)).replace(/\./g, '');
const money = (amount: number | null, currency: string | null) => amount ? `${currency === 'USD' ? 'US$' : '$'}${Math.round(amount).toLocaleString('es-CL')}` : null;

function Stat({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return <div className="min-w-0 rounded-2xl bg-muted/40 p-4">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
    {note ? <p className="mt-0.5 text-xs text-muted-foreground">{note}</p> : null}
  </div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-3"><h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>{children}</section>;
}

/**
 * «Informe semanal» (propuesta 2): the person's week, their team's when they run it and Oportunidades' when they manage
 * it, with what to do next. Monday's email carries the same, from the person's own mailbox, when they turn it on.
 * `embedded`: inside «Hoy» («Tu semana»), whose header names the page; here only the week and its range.
 */
export function WeeklyReport({ embedded = false }: { embedded?: boolean } = {}) {
  const { organizationId } = useAuth();
  const [week, setWeek] = useState<'current' | 'previous'>('current');
  const [role, setRole] = useState<ReportRole>('personal');
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [managersOpen, setManagersOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [idleShown, setIdleShown] = useState(false);
  const idleId = useId();

  const call = useCallback((url: string, init?: RequestInit) => authenticatedApiFetch(url, {
    cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(organizationId ? { 'x-organization-id': organizationId } : {}) },
  }), [organizationId]);
  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true); setError('');
    try {
      const response = await call(`/api/weekly-report?week=${week}`);
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'No pudimos preparar tu informe.');
      setData(body);
    } catch (e) { setError(e instanceof Error ? e.message : 'No pudimos preparar tu informe.'); }
    finally { setLoading(false); }
  }, [call, organizationId, week]);
  useEffect(() => { void load(); }, [load]);

  const post = async (key: string, body: Record<string, unknown>) => {
    setSaving(key); setNotice(null);
    try {
      const response = await call('/api/weekly-report', { method: 'POST', body: JSON.stringify(body) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || 'No pudimos guardar.');
      return result;
    } catch (e) { setNotice({ ok: false, text: e instanceof Error ? e.message : 'No pudimos guardar.' }); return null; }
    finally { setSaving(null); }
  };

  const report = data?.report;
  const roles = report?.roles ?? ['personal'];
  const shown: ReportRole = roles.includes(role) ? role : 'personal';
  const team = report?.team ? teamActivity(report.team) : null;
  const weekWord = report?.week.which === 'current' ? 'esta semana' : 'la semana pasada';
  const memberRow = (member: TeamMember, idle = false) => <tr key={member.userId} className={cn('border-b last:border-0', idle && 'text-muted-foreground')}>
    <th scope="row" className="max-w-[14rem] px-4 py-2.5 text-left font-normal"><span className="block truncate">{member.name}</span>{member.detail ? <span className="block truncate text-xs text-muted-foreground">{member.detail}</span> : null}</th>
    <td className={cn('px-3 py-2.5 text-right tabular-nums', !member.sent && 'text-muted-foreground')}>{member.sent}</td>
    <td className="px-3 py-2.5 text-right tabular-nums">{member.replies}</td>
    <td className="px-3 py-2.5 text-right tabular-nums">{member.meetings}</td>
    <td className={cn('px-4 py-2.5 text-right tabular-nums', member.pending ? 'font-medium' : 'text-muted-foreground')}>{member.pending}</td>
  </tr>;

  return <div className={embedded ? 'w-full max-w-3xl space-y-6' : 'mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6'}>
    <header className={cn('flex flex-col gap-4 sm:flex-row sm:justify-between', embedded ? 'sm:items-center' : 'sm:items-end')}>
      <div className="min-w-0">
        {embedded ? null : <h1 className="text-2xl font-semibold tracking-tight">Informe semanal</h1>}
        <p className={cn('text-sm text-muted-foreground', !embedded && 'mt-1')}>{report ? `${report.week.which === 'current' ? 'Esta semana' : 'La semana pasada'} · ${report.week.label}` : 'Tu semana en un vistazo.'}</p>
      </div>
      <div role="group" aria-label="Semana" className="flex self-start rounded-full border p-0.5">
        {(['current', 'previous'] as const).map(value => <Button key={value} size="sm" variant={week === value ? 'secondary' : 'ghost'} className="rounded-full" aria-pressed={week === value} onClick={() => setWeek(value)}>
          {value === 'current' ? 'Esta semana' : 'Semana pasada'}</Button>)}
      </div>
    </header>

    {roles.length > 1 ? <div role="group" aria-label="Informe" className="flex flex-wrap gap-2">
      {REPORT_ROLES.filter(item => roles.includes(item.id)).map(item => <button key={item.id} type="button" aria-pressed={shown === item.id} onClick={() => setRole(item.id)}
        className={cn('rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', shown === item.id ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}>{item.label}</button>)}
    </div> : null}

    {loading && !report ? <p role="status" className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Preparando tu informe…</p> : null}
    {error ? <Card className="rounded-2xl"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
      <p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" />Reintentar</Button>
    </CardContent></Card> : null}

    {report && shown === 'personal' ? <div className={cn('space-y-8 transition-opacity', loading && 'opacity-60')}>
      <p className="text-lg leading-7">{personalHeadline(report.personal, report.week.which)}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Correos enviados" value={report.personal.sent.now.toLocaleString('es-CL')} note={deltaText(report.personal.sent)} />
        <Stat label="Personas contactadas" value={report.personal.contacted.now.toLocaleString('es-CL')} note={deltaText(report.personal.contacted)} />
        <Stat label="Respuestas" value={report.personal.replies.now.toLocaleString('es-CL')} note={rate(report.personal.replies.now, report.personal.contacted.now) !== null ? `${rate(report.personal.replies.now, report.personal.contacted.now)} % de quienes escribiste` : deltaText(report.personal.replies)} />
        <Stat label="Reuniones pedidas" value={report.personal.meetings.toLocaleString('es-CL')} />
      </div>
      {nextActions(report).length ? <Section title="Para esta semana">
        <ul className="divide-y rounded-2xl border">{nextActions(report).map(action => <li key={action.text}>
          <Link href={action.href} className="flex items-center justify-between gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <span>{action.text}</span><ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /></Link>
        </li>)}</ul>
      </Section> : null}
      {report.personal.pending.length ? <Section title="Te esperan">
        <ul className="space-y-1">{report.personal.pending.map(item => <li key={item.id}>
          <Link href={`/contacted?c=${encodeURIComponent(item.id)}`} className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="min-w-0 truncate"><span className="font-medium">{item.name}</span>{item.company ? <span className="text-muted-foreground"> · {item.company}</span> : null}</span>
            <span className="shrink-0 text-xs text-muted-foreground">te escribió el {dateLabel(item.repliedAt, { weekday: 'short', day: 'numeric' })}</span></Link>
        </li>)}</ul>
      </Section> : null}
      {report.personal.commitments.length ? <Section title="Compromisos">
        <ul className="space-y-1">{report.personal.commitments.map(item => <li key={item.id}>
          <Link href={`/contacted?c=${encodeURIComponent(item.id)}`} className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="min-w-0 truncate">{item.title} · <span className="text-muted-foreground">{item.name}</span></span>
            <span className={cn('shrink-0 text-xs', Date.parse(item.dueAt) < Date.now() ? 'text-destructive' : 'text-muted-foreground')}>{dateLabel(item.dueAt, { weekday: 'short', day: 'numeric', month: 'short' })}</span></Link>
        </li>)}</ul>
      </Section> : null}
      {report.personal.touches && (report.personal.touches.calls || report.personal.touches.linkedin) ? <p className="text-sm text-muted-foreground">
        Además hiciste {report.personal.touches.calls} {report.personal.touches.calls === 1 ? 'llamada' : 'llamadas'} y {report.personal.touches.linkedin} {report.personal.touches.linkedin === 1 ? 'contacto' : 'contactos'} por LinkedIn.</p> : null}
    </div> : null}

    {report?.team && team && shown === 'team' ? <div className={cn('space-y-6 transition-opacity', loading && 'opacity-60')}>
      <p className="text-lg leading-7">{teamHeadline(report.team, report.week.which)}</p>
      {/* Nobody wrote: one sentence instead of three zeros and a row of zeros per person. */}
      {!team.active.length ? <div className="space-y-3">
        <p className="text-sm leading-6 text-muted-foreground">Cuando escriban desde ANTON.IA, aquí verás quién envió, a quién le respondieron y quién tiene respuestas por contestar.</p>
        {roles.includes('opportunities') ? <Button variant="outline" size="sm" onClick={() => setRole('opportunities')}>Ver Oportunidades<ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" /></Button> : null}
      </div> : <>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Correos enviados" value={report.team.totals.sent.now.toLocaleString('es-CL')} note={deltaText(report.team.totals.sent)} />
          <Stat label="Respuestas" value={report.team.totals.replies.now.toLocaleString('es-CL')} note={deltaText(report.team.totals.replies)} />
          <Stat label="Reuniones pedidas" value={report.team.totals.meetings.toLocaleString('es-CL')} />
        </div>
        <Section title="Por persona">
          <div className="overflow-x-auto rounded-2xl border">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <th scope="col" className="px-4 py-2 text-left font-medium">Persona</th><th scope="col" className="px-3 py-2 text-right font-medium">Enviados</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Respuestas</th><th scope="col" className="px-3 py-2 text-right font-medium">Reuniones</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Por responder</th></tr></thead>
              <tbody>{team.active.map(member => memberRow(member))}</tbody>
              {idleShown ? <tbody id={idleId} className="border-t">{team.idle.map(member => memberRow(member, true))}</tbody> : null}
            </table>
          </div>
          {/* Who did nothing this week is counted in one line; their rows open on demand. */}
          {team.idle.length ? <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <span>{team.idle.length === 1 ? `1 persona sin actividad ${weekWord}.` : `${team.idle.length} personas sin actividad ${weekWord}.`}</span>
            <Button variant="link" size="sm" className="h-auto p-0" aria-expanded={idleShown} aria-controls={idleShown ? idleId : undefined} onClick={() => setIdleShown(value => !value)}>
              {idleShown ? 'Ocultar' : 'Ver'}</Button>
          </div> : null}
          <p className="text-xs text-muted-foreground">El detalle por persona y por módulo está en <Link href="/dashboard/admin/usage" className="underline underline-offset-2">Administración</Link>.</p>
        </Section>
      </>}
    </div> : null}

    {report?.opportunities && shown === 'opportunities' ? <div className={cn('space-y-6 transition-opacity', loading && 'opacity-60')}>
      <p className="text-lg leading-7">
        {report.opportunities.found.total ? `Llegaron ${report.opportunities.found.total} oportunidades nuevas${report.opportunities.found.recommended ? `, ${report.opportunities.found.recommended} recomendadas` : ''}.` : 'No llegaron oportunidades nuevas.'}
        {report.opportunities.closing.length ? ` ${report.opportunities.closing.length === 1 ? 'Una cierra' : `${report.opportunities.closing.length} cierran`} en los próximos 7 días${report.opportunities.unassignedClosing ? `, ${report.opportunities.unassignedClosing} sin asignar` : ''}.` : ''}
      </p>
      {report.opportunities.found.byKind.length ? <div className="flex flex-wrap gap-2">{report.opportunities.found.byKind.map(item => <span key={item.kind} className="rounded-full bg-muted px-3 py-1 text-sm">{item.label} · {item.count}</span>)}</div> : null}
      <Section title="Cierran en los próximos 7 días">
        {report.opportunities.closing.length ? <ul className="divide-y rounded-2xl border">{report.opportunities.closing.map(item => <li key={item.id}>
          <Link href={`/opportunities?op=${encodeURIComponent(item.id)}`} className="flex items-start justify-between gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <span className="min-w-0"><span className="block font-medium">{item.title}</span>
              <span className="block text-xs text-muted-foreground">{[item.buyer, money(item.amount, item.currency)].filter(Boolean).join(' · ')}</span></span>
            <span className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">{dateLabel(item.deadlineAt, { weekday: 'short', day: 'numeric', month: 'short' })}
              {item.assigned ? null : <span className="rounded-full border border-dashed px-2 py-0.5">Sin asignar</span>}</span></Link>
        </li>)}</ul> : <p className="text-sm text-muted-foreground">Nada cierra esta semana.</p>}
      </Section>
      {report.opportunities.won || report.opportunities.lost ? <p className="text-sm text-muted-foreground">Esta semana se marcaron {report.opportunities.won} como ganadas y {report.opportunities.lost} como perdidas.</p> : null}
    </div> : null}

    {data ? <Card className="rounded-2xl">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <Label htmlFor="weekly-email" className="text-sm font-medium">Recibirlo por correo cada lunes</Label>
            <p className="text-xs leading-5 text-muted-foreground">{data.mailbox
              ? `A las 8:00, con la semana anterior. Te lo envías tú mismo desde tu ${MAILBOX[data.mailbox]} conectado, a tu propio correo.`
              : 'Conecta Gmail u Outlook en «Conexiones» para recibirlo por correo: sale desde tu cuenta, hacia ti.'}</p>
          </div>
          <Switch id="weekly-email" checked={data.email} disabled={!data.mailbox || saving === 'email'}
            onCheckedChange={on => { void post('email', { action: 'email', on }).then(result => { if (result) setData(current => current && { ...current, email: result.email }); }); }} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={!data.mailbox || saving === 'send'}
            onClick={() => { void post('send', { action: 'send', week }).then(result => { if (result) setNotice({ ok: true, text: `Te lo enviamos a ${result.to}.` }); }); }}>
            {saving === 'send' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Mail className="mr-1.5 h-4 w-4" aria-hidden="true" />}Enviármelo ahora</Button>
          {data.members ? <Button variant="ghost" size="sm" onClick={() => { setChosen(data.managers || []); setManagersOpen(true); }}>
            <Users className="mr-1.5 h-4 w-4" aria-hidden="true" />Gestores de oportunidades{data.managers?.length ? ` · ${data.managers.length}` : ''}</Button> : null}
        </div>
        {notice ? <p role={notice.ok ? 'status' : 'alert'} className={cn('text-sm', notice.ok ? 'text-muted-foreground' : 'text-destructive')}>{notice.text}</p> : null}
      </CardContent>
    </Card> : null}

    <Sheet open={managersOpen} onOpenChange={value => { if (!saving) setManagersOpen(value); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader><SheetTitle>Gestores de oportunidades</SheetTitle>
          <SheetDescription>Reciben cada semana lo que llegó a «Oportunidades», lo que cierra pronto y lo que nadie tiene asignado. Mientras no elijas a nadie, lo reciben los administradores.</SheetDescription></SheetHeader>
        <ul className="mt-6 space-y-1">{(data?.members || []).map(member => <li key={member.userId}>
          <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-sm hover:bg-muted/40">
            <Checkbox checked={chosen.includes(member.userId)} onCheckedChange={value => setChosen(current => value ? [...current, member.userId] : current.filter(id => id !== member.userId))} />
            <span className="min-w-0"><span className="block truncate">{member.name}</span>{member.email ? <span className="block truncate text-xs text-muted-foreground">{member.email}</span> : null}</span></label>
        </li>)}</ul>
        <SheetFooter className="mt-6"><Button disabled={saving === 'managers'} onClick={() => { void post('managers', { action: 'managers', userIds: chosen }).then(result => {
          if (result) { setManagersOpen(false); setData(current => current && { ...current, managers: result.managers }); void load(); }
        }); }}>{saving === 'managers' ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}Guardar</Button></SheetFooter>
      </SheetContent>
    </Sheet>
  </div>;
}
