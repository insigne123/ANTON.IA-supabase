
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, Wand2, Save, Bot, User, Sparkles, Trash2, Copy, RefreshCw } from 'lucide-react';
import type { ChatMessage, StyleProfile } from '@/lib/types';
import { styleProfilesStorage, defaultStyle } from '@/lib/style-profiles-storage';
import { KNOWN_TOKENS, highlightTokens } from '@/lib/tokens';
import { useToast } from '@/hooks/use-toast';
import { generateMailFromStyle } from '@/lib/ai/style-mail';
import { getEnrichedLeads } from '@/lib/saved-enriched-leads-storage';
import { findReportForLead } from '@/lib/lead-research-storage';

type Mode = 'leads' | 'opportunities';

export default function ConversationalDesigner({ mode = 'leads' as Mode }) {
  const { toast } = useToast();

  // ======= Estado de estilo y lista =======
  const [styles, setStyles] = useState<StyleProfile[]>([]);
  const [style, setStyle] = useState<StyleProfile>({ ...defaultStyle, scope: mode });
  const [selectedStyleName, setSelectedStyleName] = useState<string>('');

  // ======= Chat =======
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant' as const, content: '¡Hola! Dime el tono, longitud y estructura que quieres. Puedes usar tokens como {{lead.firstName}}.', id: 'w1' }
  ]);
  const [input, setInput] = useState('');

  // ======= Preview =======
  const [subjectPreview, setSubjectPreview] = useState('');
  const [bodyPreview, setBodyPreview] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);

  // Lead de ejemplo (de tus guardados con reporte)
  const [sampleLeadId, setSampleLeadId] = useState<string>('');
  const sampleLeads = useMemo(() => {
    if (!mounted) return [];
    const all = getEnrichedLeads();
    return all.filter(l => !!findReportForLead({ leadId: l.id, companyDomain: l.companyDomain || null, companyName: l.companyName || null })?.cross);
  }, [mounted]);

  // Set mounted state
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !sampleLeadId && sampleLeads.length) {
      setSampleLeadId(sampleLeads[0].id);
    }
  }, [sampleLeads, sampleLeadId, mounted]);


  // ======= Init lista de estilos =======
  useEffect(() => {
    if (!mounted) return;
    const list = styleProfilesStorage.list();
    setStyles(list);
    if (!selectedStyleName && list.length) {
      setSelectedStyleName(list[0].name);
      setStyle(list[0]);
    }
  }, [mounted]);

  // ======= Render preview (local, sin depender del endpoint) =======
  function recomputePreview(s: StyleProfile) {
    // lead + reporte real si existe (si no, contexto vacío)
    const lead = sampleLeads.find(l => l.id === sampleLeadId) || null;
    const rep = lead
      ? findReportForLead({ leadId: lead.id, companyDomain: lead.companyDomain || null, companyName: lead.companyName || null })?.cross || null
      : null;

    const gen = generateMailFromStyle(
      s,
      rep,
      {
        id: lead?.id,
        fullName: lead?.fullName,
        email: lead?.email,
        title: lead?.title,
        companyName: lead?.companyName,
        companyDomain: lead?.companyDomain,
        linkedinUrl: lead?.linkedinUrl,
      }
    );
    setSubjectPreview(gen.subject);
    setBodyPreview(gen.body);
    // Checklist básica (puedes mejorarla)
    const ws: string[] = [];
    if (!/\n\n/.test(gen.body)) ws.push('El cuerpo no tiene separación de párrafos (usa una línea en blanco).');
    if (!/{{|}}|\[\[|\]\]/.test(s.bodyTemplate || '')) {
      ws.push('Sugerencia: usa tokens como {{lead.firstName}} o [[company.name]].');
    }
    setWarnings(ws);
  }

  // Recalcula preview cuando cambie estilo o lead de ejemplo
  useEffect(() => {
    if (!mounted) return;
    recomputePreview(style);
  }, [style, sampleLeadId, mounted]);

  // ======= Chat turn (si tu endpoint no cambia nada, al menos guardamos las plantillas) =======
  async function runChatTurn(userText: string) {
    const next = [...messages, { role: 'user' as const, content: userText, id: crypto.randomUUID() }];
    setMessages(next);

    try {
      const res = await fetch('/api/email/style/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next,
          styleProfile: style,
          mode,
          sampleData: { leadId: sampleLeadId }
        })
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'No se pudo actualizar el estilo');

      const updated: StyleProfile = {
        ...style,
        ...j.styleProfile,
        // si la IA devuelve preview, úsalo como nuevas plantillas
        subjectTemplate: j.preview?.subject || style.subjectTemplate,
        bodyTemplate: j.preview?.body || style.bodyTemplate,
        updatedAt: new Date().toISOString(),
      };
      setStyle(updated);
      recomputePreview(updated);
      setMessages(prev => [...prev, { role: 'assistant' as const, content: 'Listo. Ajusté el estilo y la plantilla.', id: crypto.randomUUID() }]);
    } catch (e: any) {
      // fallback mínimo: si el usuario escribe "hazlo breve", toquetea length, etc.
      const txt = userText.toLowerCase();
      const updated = { ...style };
      if (/(breve|corto|short)/.test(txt)) updated.length = 'short';
      if (/(cálid|calid|warm)/.test(txt)) updated.tone = 'warm';
      if (!updated.bodyTemplate?.includes('{{lead.firstName}}')) {
        updated.bodyTemplate = (updated.bodyTemplate || defaultStyle.bodyTemplate)?.replace(/^Hola.*?\n/i, 'Hola {{lead.firstName}},\n');
      }
      setStyle(updated);
      recomputePreview(updated);
      setMessages(prev => [...prev, { role: 'assistant' as const, content: 'He aplicado ajustes básicos al estilo.', id: crypto.randomUUID() }]);
      toast({ variant: 'destructive', title: 'Aviso', description: 'El endpoint de chat no respondió. Apliqué ajustes locales.' });
    }
  }

  const chatRef = useRef<HTMLDivElement>(null);
  useEffect(() => { chatRef.current?.scrollTo({ top: 1e9 }); }, [messages]);

  function send() {
    const text = input.trim();
    if (!text) return;
    setInput('');
    runChatTurn(text);
  }

  // ======= Guardar / Cargar / Borrar / Duplicar =======
  function saveProfile() {
    const name = prompt('Nombre para este estilo', style.name) || style.name;
    const saved = styleProfilesStorage.upsert({ ...style, name });
    setStyle(saved);
    setStyles(styleProfilesStorage.list());
    setSelectedStyleName(saved.name);
    toast({ title: 'Estilo guardado', description: `${saved.name}` });
  }
  function loadProfile(name: string) {
    const s = styleProfilesStorage.getByName(name);
    if (!s) return;
    setSelectedStyleName(name);
    setStyle(s);
    recomputePreview(s);
  }
  function deleteProfile(name: string) {
    if (!confirm(`¿Eliminar el estilo "${name}"?`)) return;
    styleProfilesStorage.remove(name);
    const list = styleProfilesStorage.list();
    setStyles(list);
    const s = list[0] || { ...defaultStyle, scope: mode };
    setSelectedStyleName(s.name);
    setStyle(s);
    recomputePreview(s);
  }
  function duplicateProfile(name: string) {
    const newName = prompt('Nombre del duplicado', `${name} (copia)`);
    if (!newName) return;
    const base = styleProfilesStorage.getByName(name);
    if (!base) return;
    const copy = { ...base, name: newName, updatedAt: new Date().toISOString() };
    styleProfilesStorage.upsert(copy);
    setStyles(styleProfilesStorage.list());
    setSelectedStyleName(copy.name);
    setStyle(copy);
    recomputePreview(copy);
  }

  // ======= tokens shortcuts =======
  const tokensHelp = useMemo(() => (
    <div className="flex flex-wrap gap-2">
      {KNOWN_TOKENS.map(t => (
        <Badge key={t.key} variant="secondary" className="cursor-pointer" onClick={() => {
          // inserta token en bodyTemplate
          setStyle(s => ({ ...s, bodyTemplate: (s.bodyTemplate || '') + (s.bodyTemplate ? '\n' : '') + t.key }));
        }}>
          {t.label}
        </Badge>
      ))}
      <Badge variant="outline" className="cursor-pointer" onClick={() => setStyle(s => ({ ...s, cta: { ...(s.cta || {}), duration: '15', label: '¿Agendamos 15 min?' } }))}>CTA 15 min</Badge>
    </div>
  ), []);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      {/* Columna izquierda: Chat + Gestor de estilos */}
      <div className="xl:col-span-1 space-y-6">
        <Card className="h-[70vh] flex flex-col">
          <CardHeader>
            <CardTitle>Diseñador conversacional</CardTitle>
            <CardDescription>Habla con la IA y ve el resultado al instante.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 h-full">
            <div className="text-xs text-muted-foreground">Atajos de tokens:</div>
            {tokensHelp}
            <ScrollArea ref={chatRef} className="flex-1 border rounded p-3 bg-muted/30">
              <div className="space-y-3">
                {messages.map(m => (
                  <div key={m.id} className={`flex gap-2 items-start ${m.role === 'user' ? 'justify-end' : ''}`}>
                    {m.role === 'assistant' ? <Bot className="h-4 w-4 mt-1 opacity-70" /> : <User className="h-4 w-4 mt-1 opacity-70" />}
                    <div className={`max-w-[85%] rounded-md px-3 py-2 text-sm leading-relaxed
                      ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-background border'}`}>
                      {m.content}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <div className="flex gap-2">
              <Input placeholder="Ej: hazlo más directo y breve, con CTA de 15 min" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} />
              <Button onClick={send}><Send className="h-4 w-4 mr-1" />Enviar</Button>
              <Button variant="secondary" onClick={() => runChatTurn('Genera 2 variantes')}><Wand2 className="h-4 w-4 mr-1" />Variantes</Button>
            </div>
          </CardContent>
        </Card>

        {/* Mis estilos */}
        <Card>
          <CardHeader>
            <CardTitle>Mis estilos</CardTitle>
            <CardDescription>Lista, carga, duplica o elimina estilos guardados.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {styles.map(s => (
              <div key={s.name} className="flex items-center justify-between border rounded px-2 py-1">
                <button className="text-left text-sm" onClick={() => loadProfile(s.name)}>
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-muted-foreground">{s.tone} · {s.length}</div>
                </button>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" title="Duplicar" onClick={() => duplicateProfile(s.name)}><Copy className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" title="Eliminar" onClick={() => deleteProfile(s.name)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
            <div className="pt-2 flex gap-2">
              <Button onClick={saveProfile}><Save className="h-4 w-4 mr-1" />Guardar estilo</Button>
              <Button variant="outline" onClick={() => { setStyle({ ...defaultStyle, scope: mode }); setSelectedStyleName(''); recomputePreview({ ...defaultStyle, scope: mode }); }}>
                <RefreshCw className="h-4 w-4 mr-1" />Nuevo desde base
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Columna derecha: Plantillas + Preview */}
      <div className="xl:col-span-2 space-y-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Plantillas del estilo</CardTitle>
              <CardDescription>Estas plantillas se usan en compose/bulk.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary"><Sparkles className="h-3 w-3 mr-1" />{style.tone}</Badge>
              <Badge variant="outline">{style.length}</Badge>
              {mounted && sampleLeads.length > 0 ? (
                <select
                  className="ml-2 h-8 rounded border bg-background px-2 text-sm"
                  value={sampleLeadId}
                  onChange={e => setSampleLeadId(e.target.value)}
                >
                  {sampleLeads.map(l => <option key={l.id} value={l.id}>{l.fullName} · {l.companyName}</option>)}
                </select>
              ) : <span className="text-xs text-muted-foreground ml-2">No hay leads investigados para vista previa</span>}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Asunto (plantilla)</div>
              <Input
                value={style.subjectTemplate || ''}
                onChange={e => setStyle(s => ({ ...s, subjectTemplate: e.target.value }))}
                onBlur={() => recomputePreview({ ...style })}
                placeholder="Ej: {{lead.firstName}}, idea rápida para {{company.name}}"
              />
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Cuerpo (plantilla)</div>
              <Textarea
                value={style.bodyTemplate || ''}
                onChange={e => setStyle(s => ({ ...s, bodyTemplate: e.target.value }))}
                onBlur={() => recomputePreview({ ...style })}
                rows={12}
                className="font-mono text-sm"
                placeholder={`Saludo\n\nHook\n\nContexto\n\nValor + CTA\n\nFirma`}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="h-[50vh] flex flex-col">
          <CardHeader>
            <CardTitle>Previsualización</CardTitle>
            <CardDescription>Renderizada con un lead real (si hay).</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-auto">
            <Tabs defaultValue="a">
              <TabsList>
                <TabsTrigger value="a">Variante A</TabsTrigger>
                <TabsTrigger value="b">Variante B</TabsTrigger>
                <TabsTrigger value="c">Variante C</TabsTrigger>
              </TabsList>
              {['a', 'b', 'c'].map(k => (
                <TabsContent key={k} value={k} className="mt-3">
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Asunto</div>
                      <div className="border rounded p-2 text-sm bg-background">
                        {highlightTokens(subjectPreview || '(sin asunto)')}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Cuerpo</div>
                      <pre className="border rounded p-3 text-sm whitespace-pre-wrap bg-background">
                        {highlightTokens(bodyPreview || '(sin contenido)')}
                      </pre>
                    </div>
                    {warnings?.length ? (
                      <div className="rounded border p-2 text-xs">
                        <div className="font-medium mb-1">Checklist</div>
                        <ul className="list-disc pl-5 space-y-1">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                      </div>
                    ) : null}
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
