'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { companySearchHref } from '@/lib/search/company-prefill';

const fold = (value: unknown) => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
/** A saved contact belongs to the opportunity's company when either name contains the other (e.g. «Securitas» and «Securitas Chile»). */
const sameCompany = (a: unknown, b: unknown) => { const x = fold(a), y = fold(b); return Boolean(x && y && (x.includes(y) || y.includes(x))); };
export function OpportunityContacts({ id, company, domain, titles }: { id: string; company: string; domain?: string | null; titles: string[] }) {
  const [query, setQuery] = useState(''); const [choices, setChoices] = useState<any[]>([]); const [links, setLinks] = useState<any[]>([]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const responses = await Promise.all([fetch(`/api/commercial-opportunities/${id}/contacts?query=${encodeURIComponent(query)}`, { signal: controller.signal, cache: 'no-store' }), fetch(`/api/commercial-opportunities/${id}/contacts?history=true`, { signal: controller.signal, cache: 'no-store' })]);
        const [available, history] = await Promise.all(responses.map(async r => { const body = await r.json(); if (!r.ok) throw Error(body.error); return body; }));
        if (!controller.signal.aborted) { setChoices(available.contacts); setLinks(history.contacts); setError(''); }
      } catch (e) { if (!controller.signal.aborted) { setChoices([]); setLinks([]); setError(e instanceof Error ? e.message : 'No se pudieron consultar los contactos.'); } }
    }, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [id, query, revision]);
  // Without a search, only the people of this company: a list of every saved contact did not help to choose.
  const shown = query.trim() ? choices : choices.filter(c => sameCompany(c.company, company));
  return <section className="space-y-4"><h3 className="font-semibold">Contactos y gestiones</h3>
    <div className="rounded-2xl border p-4"><p className="text-sm">Encuentra a quienes deciden en <span className="font-medium">{company}</span>{titles.length ? <>: {titles.slice(0, 3).join(', ')}</> : null}.</p>
      <Button className="mt-3" asChild><Link href={companySearchHref({ company, domain, titles, opportunityId: id })}>Buscar decisores en {company.length > 40 ? 'esta empresa' : company}</Link></Button>
      <p className="mt-2 text-xs text-muted-foreground">Los contactos que guardes desde esa búsqueda quedan vinculados a esta oportunidad.</p></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Label htmlFor="op-contact-query">Vincular un contacto que ya tienes guardado</Label><Input id="op-contact-query" placeholder="Buscar por nombre o empresa" value={query} onChange={e => setQuery(e.target.value)} />
    {!shown.length && <p className="text-sm text-muted-foreground">{query.trim() ? 'No hay contactos guardados con ese nombre o empresa.' : `No tienes contactos guardados de ${company}. Busca decisores con el botón de arriba o escribe un nombre.`}</p>}
    {shown.length > 0 && <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border p-3">{shown.map(c => <div key={`${c.table}:${c.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"><div><p className="text-sm font-medium">{c.name}</p><p className="text-xs text-muted-foreground">{c.title} · {c.company}</p></div><Button size="sm" variant="outline" disabled={busy || links.some(l => l.contact_id === c.id)} onClick={async () => { setBusy(true); try { const response = await fetch(`/api/commercial-opportunities/${id}/contacts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contactId: c.id, table: c.table }) }); const body = await response.json(); if (!response.ok) throw Error(body.error); setRevision(r => r + 1); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo vincular.'); } finally { setBusy(false); } }}>Vincular</Button></div>)}{!choices.length && <p className="p-3 text-sm text-muted-foreground">No hay contactos con ese nombre. Puedes buscar decisores y guardarlos.</p>}</div>}
    <h4 className="font-semibold">Contactos vinculados</h4>{links.map(c => <article key={c.contact_id} className="rounded-xl border p-4"><h5 className="font-medium">{c.name}</h5><p className="text-xs text-muted-foreground">{c.title} · {c.company}</p><p className="mt-3 text-sm">{c.confirmedSends.length} envíos confirmados en el historial consultado · {c.replies.length} respuestas registradas</p><p className="mt-1 text-xs text-muted-foreground">Este historial pertenece al contacto; puede incluir gestiones anteriores a esta oportunidad.</p>{c.confirmedSends.slice(0, 3).map((s: any) => <p key={s.id} className="mt-2 text-xs">{s.channel} confirmado · {new Date(s.completed_at).toLocaleString('es-CL')}</p>)}</article>)}
  </section>;
}
