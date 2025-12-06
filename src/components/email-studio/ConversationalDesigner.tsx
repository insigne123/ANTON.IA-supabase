
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
// Iconos
import { Send, Wand2, Save, Bot, User, Sparkles, Trash2, Copy, RefreshCw, Zap, AlignLeft, ShieldCheck, Languages } from 'lucide-react';

import type { ChatMessage, StyleProfile } from '@/lib/types';
import { styleProfilesStorage, defaultStyle } from '@/lib/style-profiles-storage';
import { KNOWN_TOKENS, highlightTokens } from '@/lib/tokens';
import { useToast } from '@/hooks/use-toast';
import { generateMailFromStyle } from '@/lib/ai/style-mail';
import { getEnrichedLeads } from '@/lib/saved-enriched-leads-storage';
import { findReportForLead } from '@/lib/lead-research-storage';

type Mode = 'leads' | 'opportunities';

/**
 * Acciones rápidas para el usuario (se envían como mensajes al chat)
 */
const QUICK_ACTIONS = [
  { label: 'Hacer más breve', icon: AlignLeft, prompt: 'Haz el correo más corto y conciso.' },
  { label: 'Más persuasivo', icon: Zap, prompt: 'Haz el tono más persuasivo y enfocado en el dolor del cliente.' },
  { label: 'Más formal', icon: ShieldCheck, prompt: 'Cambia el tono a uno más profesional y corporativo.' },
  { label: 'Traducir al inglés', icon: Languages, prompt: 'Traduce los templates al inglés manteniendo el formato.' },
];

export default function ConversationalDesigner({ mode = 'leads' as Mode }) {
  const { toast } = useToast();

  // ======= Estado de estilo y lista =======
  const [styles, setStyles] = useState<StyleProfile[]>([]);
  const [style, setStyle] = useState<StyleProfile>({ ...defaultStyle, scope: mode });
  const [selectedStyleName, setSelectedStyleName] = useState<string>('');

  // ======= Chat =======
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant' as const, content: '¡Hola! Soy tu asistente de estilo. Dime cómo quieres que sean tus correos o usa los botones rápidos.', id: 'w1' }
  ]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

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

  // ======= Chat turn =======
  async function runChatTurn(userText: string) {
    if (!userText.trim()) return;
    setIsProcessing(true);

    // Add user message immediately
    const next = [...messages, { role: 'user' as const, content: userText, id: crypto.randomUUID() }];
    setMessages(next);
    setInput('');

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
        // si la IA devuelve preview, úsalo como nuevas plantillas (aunque ya vienen en styleProfile usualmente)
        subjectTemplate: j.styleProfile?.subjectTemplate || style.subjectTemplate,
        bodyTemplate: j.styleProfile?.bodyTemplate || style.bodyTemplate,
        updatedAt: new Date().toISOString(),
      };

      setStyle(updated);
      recomputePreview(updated);

      // Add AI response
      const assistantMsg = j.explanation
        ? `Hecho: ${j.explanation}`
        : 'Estilo actualizado.';

      setMessages(prev => [...prev, { role: 'assistant' as const, content: assistantMsg, id: crypto.randomUUID() }]);

    } catch (e: any) {
      console.error(e);
      setMessages(prev => [...prev, { role: 'assistant' as const, content: 'Lo siento, hubo un error al procesar tu solicitud. Intenta de nuevo.', id: crypto.randomUUID() }]);
      toast({ variant: 'destructive', title: 'Error', description: 'No se pudo conectar con la IA.' });
    } finally {
      setIsProcessing(false);
    }
  }

  const chatRef = useRef<HTMLDivElement>(null);
  useEffect(() => { chatRef.current?.scrollTo({ top: 1e9, behavior: 'smooth' }); }, [messages]);

  function send() {
    runChatTurn(input);
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
        <Badge key={t.key} variant="secondary" className="cursor-pointer hover:bg-secondary/80" onClick={() => {
          // inserta token en bodyTemplate
          setStyle(s => ({ ...s, bodyTemplate: (s.bodyTemplate || '') + (s.bodyTemplate ? '\n' : '') + t.key }));
        }}>
          {t.label}
        </Badge>
      ))}
      <Badge variant="outline" className="cursor-pointer hover:bg-muted" onClick={() => setStyle(s => ({ ...s, cta: { ...(s.cta || {}), duration: '15', label: '¿Agendamos 15 min?' } }))}>CTA 15 min</Badge>
    </div>
  ), []);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 h-[calc(100vh-140px)] min-h-[600px]">
      {/* Columna Izquierda: Chat IA (4 cols) */}
      <div className="xl:col-span-4 flex flex-col gap-4 h-full">
        <Card className="flex-1 flex flex-col shadow-md overflow-hidden border-2 border-primary/5">
          <CardHeader className="py-4 bg-muted/20 border-b">
            <CardTitle className="text-lg flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-indigo-500" />
              Asistente de Estilo
            </CardTitle>
            <CardDescription>Pide cambios a la IA para afinar tus plantillas.</CardDescription>
          </CardHeader>

          <CardContent className="flex-1 flex flex-col p-0 overflow-hidden bg-background">
            <ScrollArea ref={chatRef} className="flex-1 p-4">
              <div className="space-y-4">
                {messages.map(m => (
                  <div key={m.id} className={`flex gap-3 items-start ${m.role === 'user' ? 'justify-end' : ''}`}>
                    {m.role === 'assistant' && (
                      <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center border border-indigo-200 shrink-0">
                        <Bot className="h-4 w-4 text-indigo-600" />
                      </div>
                    )}
                    <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm
                      ${m.role === 'user'
                        ? 'bg-primary text-primary-foreground rounded-tr-sm'
                        : 'bg-muted/50 border rounded-tl-sm'}`}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {isProcessing && (
                  <div className="flex gap-3 items-start animate-pulse">
                    <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center border border-indigo-200 shrink-0">
                      <Bot className="h-4 w-4 text-indigo-600" />
                    </div>
                    <div className="bg-muted/50 border rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-muted-foreground">
                      Pensando cambios...
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Acciones Rápidas */}
            <div className="p-3 bg-muted/10 border-t">
              <div className="text-xs font-medium text-muted-foreground mb-2 px-1">Acciones rápidas:</div>
              <div className="grid grid-cols-2 gap-2">
                {QUICK_ACTIONS.map((action, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs justify-start bg-background hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 transition-colors"
                    onClick={() => runChatTurn(action.prompt)}
                    disabled={isProcessing}
                  >
                    <action.icon className="h-3 w-3 mr-2 opacity-70" />
                    {action.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Input */}
            <div className="p-3 border-t bg-background">
              <div className="relative">
                <Textarea
                  placeholder="Ej: hazlo más directo, menciona clientes previos..."
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  className="min-h-[50px] pr-12 resize-none"
                  disabled={isProcessing}
                />
                <Button
                  size="icon"
                  className="absolute right-2 bottom-2 h-7 w-7"
                  onClick={send}
                  disabled={!input.trim() || isProcessing}
                >
                  <Send className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Gestor rápido de estilos */}
        <Card className="shrink-0">
          <CardHeader className="py-3 px-4 pb-2">
            <CardTitle className="text-base text-muted-foreground font-normal">Estilo Actual</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="font-medium text-lg truncate flex-1" title={style.name}>{style.name}</div>
              <Badge variant="outline" className="capitalize">{style.tone}</Badge>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={saveProfile} className="flex-1"><Save className="h-3.5 w-3.5 mr-2" />Guardar</Button>
              <Button size="sm" variant="outline" onClick={() => setSelectedStyleName('')} title="Ver lista"><RefreshCw className="h-3.5 w-3.5" /></Button>
            </div>

            {/* Lista desplegable simple si se quiere cambiar */}
            <div className="mt-4 pt-4 border-t space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Otros estilos guardados:</div>
              <div className="max-h-[100px] overflow-y-auto space-y-1 pr-1">
                {styles.map(s => (
                  <button
                    key={s.name}
                    onClick={() => loadProfile(s.name)}
                    className={`w-full text-left text-xs px-2 py-1.5 rounded flex justify-between group ${s.name === style.name ? 'bg-indigo-50 text-indigo-700 font-medium' : 'hover:bg-muted'}`}
                  >
                    <span className="truncate">{s.name}</span>
                    <div className="hidden group-hover:flex gap-1">
                      <Trash2 className="h-3 w-3 text-red-400 hover:text-red-600" onClick={(e) => { e.stopPropagation(); deleteProfile(s.name); }} />
                    </div>
                  </button>
                ))}
                {styles.length === 0 && <div className="text-xs text-muted-foreground italic">No hay estilos guardados.</div>}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Columna Derecha: Editor y Preview (8 cols) */}
      <div className="xl:col-span-8 grid grid-rows-[auto_1fr] gap-6 h-full">

        {/* Editor de Plantillas */}
        <Card className="flex flex-col shadow-sm">
          <CardHeader className="py-3 px-5 border-b bg-muted/10 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Plantillas</CardTitle>
              <Badge variant="secondary" className="font-normal text-xs text-muted-foreground">
                Edita manualmente o usa el chat
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              {mounted && sampleLeads.length > 0 ? (
                <select
                  className="h-8 max-w-[200px] rounded border bg-background px-2 text-xs"
                  value={sampleLeadId}
                  onChange={e => setSampleLeadId(e.target.value)}
                >
                  {sampleLeads.map(l => <option key={l.id} value={l.id}>{l.fullName} · {l.companyName}</option>)}
                </select>
              ) : <span className="text-xs text-muted-foreground">Sin leads para previsualizar</span>}
            </div>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            {/* Subject */}
            <div className="grid gap-1.5">
              <div className="flex justify-between items-end">
                <label className="text-xs font-medium uppercase text-muted-foreground tracking-wider">Asunto</label>
                <div className="text-[10px] text-muted-foreground">{style.subjectTemplate?.length || 0} caracteres</div>
              </div>
              <Input
                value={style.subjectTemplate || ''}
                onChange={e => setStyle(s => ({ ...s, subjectTemplate: e.target.value }))}
                onBlur={() => recomputePreview({ ...style })}
                placeholder="Ej: {{lead.firstName}}, idea rápida para {{company.name}}"
                className="font-mono text-sm border-muted-foreground/30 focus-visible:border-indigo-500"
              />
            </div>

            {/* Body */}
            <div className="grid gap-1.5 flex-1">
              <div className="flex justify-between items-end mb-1">
                <label className="text-xs font-medium uppercase text-muted-foreground tracking-wider">Cuerpo</label>
                <div className="text-xs text-muted-foreground">Tokens disponibles: {KNOWN_TOKENS.length}</div>
              </div>
              {/* Tokens Helper */}
              <div className="mb-2">{tokensHelp}</div>

              <Textarea
                value={style.bodyTemplate || ''}
                onChange={e => setStyle(s => ({ ...s, bodyTemplate: e.target.value }))}
                onBlur={() => recomputePreview({ ...style })}
                rows={12}
                className="font-mono text-sm leading-6 border-muted-foreground/30 focus-visible:border-indigo-500 min-h-[280px]"
                placeholder={`Saludo\n\nHook\n\nContexto\n\nValor + CTA\n\nFirma`}
              />
            </div>
          </CardContent>
        </Card>

        {/* Preview Result */}
        <Card className="flex flex-col shadow-sm border-dashed border-2 relative overflow-hidden bg-slate-50">
          <div className="absolute top-0 right-0 p-2 opacity-5 pointer-events-none">
            <Wand2 className="h-32 w-32" />
          </div>
          <CardHeader className="py-2 px-5 border-b bg-white">
            <CardTitle className="text-sm font-medium text-slate-500">Vista Previa (Lead Real)</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-auto p-5">
            <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-sm border p-6 min-h-[300px]">
              <div className="border-b pb-4 mb-4 space-y-1">
                <div className="text-sm text-gray-500"><span className="font-medium text-gray-700">Asunto:</span> {highlightTokens(subjectPreview || '...')}</div>
              </div>
              <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                {highlightTokens(bodyPreview || '...')}
              </div>

              {warnings?.length > 0 && (
                <div className="mt-8 p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-800">
                  <div className="font-bold flex items-center gap-1 mb-1"><ShieldCheck className="h-3 w-3" /> Sugerencias de calidad:</div>
                  <ul className="list-disc pl-4 space-y-0.5">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
