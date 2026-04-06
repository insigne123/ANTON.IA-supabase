
'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
// Iconos
import { Send, Wand2, Save, Bot, Trash2, RefreshCw, Zap, AlignLeft, ShieldCheck, Languages, Mail, Clock3, SlidersHorizontal, ChevronsUpDown, FileText, ScanSearch } from 'lucide-react';

import type { ChatMessage, EnrichedLead, StyleProfile } from '@/lib/types';
import { styleProfilesStorage, defaultStyle } from '@/lib/style-profiles-storage';
import { KNOWN_TOKENS, highlightTokens } from '@/lib/tokens';
import { useToast } from '@/hooks/use-toast';
import { generateMailFromStyle } from '@/lib/ai/style-mail';
import { getEnrichedLeads } from '@/lib/services/enriched-leads-service';
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

function summarizeStyleChanges(prev: StyleProfile, next: StyleProfile) {
  const changes: string[] = [];
  if ((prev.tone || '') !== (next.tone || '')) changes.push(`tono ${prev.tone || 'base'} -> ${next.tone || 'base'}`);
  if ((prev.length || '') !== (next.length || '')) changes.push(`longitud ${prev.length || 'base'} -> ${next.length || 'base'}`);
  if ((prev.language || '') !== (next.language || '')) changes.push(`idioma ${prev.language || 'base'} -> ${next.language || 'base'}`);
  if ((prev.subjectTemplate || '') !== (next.subjectTemplate || '')) changes.push('asunto retocado');
  if ((prev.bodyTemplate || '') !== (next.bodyTemplate || '')) changes.push('cuerpo retocado');
  if ((prev.cta?.label || '') !== (next.cta?.label || '') || (prev.cta?.duration || '') !== (next.cta?.duration || '')) {
    changes.push('CTA ajustado');
  }
  return changes;
}

function formatAssistantReply(explanation: string, changes: string[]) {
  const intro = explanation?.trim() || 'Ajuste aplicado al estilo.';
  if (changes.length === 0) return `Listo. ${intro}`;
  return `Listo. ${intro}\n\nCambios clave:\n- ${changes.join('\n- ')}\n\nSi quieres, puedo refinarlo una vuelta más hacia objeciones, claridad o cierre.`;
}

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
  const [sampleLeads, setSampleLeads] = useState<EnrichedLead[]>([]);

  // Lead de ejemplo (de tus guardados con reporte)
  const [sampleLeadId, setSampleLeadId] = useState<string>('');

  // Set mounted state
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    let active = true;

    async function loadSampleLeads() {
      try {
        const all = await getEnrichedLeads();
        if (!active) return;

        setSampleLeads(
          (all || []).filter(l => !!findReportForLead({ leadId: l.id, companyDomain: l.companyDomain || null, companyName: l.companyName || null })?.cross)
        );
      } catch (error) {
        if (!active) return;
        console.error('No se pudieron cargar leads de ejemplo para Email Studio', error);
        setSampleLeads([]);
      }
    }

    loadSampleLeads();
    return () => {
      active = false;
    };
  }, [mounted]);

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
    if (list.length) {
      setSelectedStyleName(prev => {
        if (prev) return prev;
        setStyle(list[0]);
        return list[0].name;
      });
    }
  }, [mounted]);

  const selectedSampleLead = useMemo(
    () => sampleLeads.find((lead) => lead.id === sampleLeadId) || null,
    [sampleLeads, sampleLeadId]
  );

  const selectedSampleReport = useMemo(() => {
    if (!selectedSampleLead) return null;
    return findReportForLead({
      leadId: selectedSampleLead.id,
      companyDomain: selectedSampleLead.companyDomain || null,
      companyName: selectedSampleLead.companyName || null,
    })?.cross || null;
  }, [selectedSampleLead]);

  const sampleInsight = useMemo(() => {
    const report = selectedSampleReport as any;
    const firstPain = report?.pains?.[0];
    const firstValue = report?.valueProps?.[0];
    return {
      pain: firstPain || 'sin pain principal detectado aun',
      value: firstValue || 'sin propuesta de valor concreta aun',
    };
  }, [selectedSampleReport]);

  // ======= Render preview (local, sin depender del endpoint) =======
  const recomputePreview = useCallback((s: StyleProfile) => {
    const lead = selectedSampleLead;
    const rep = selectedSampleReport;

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
    if (!lead?.fullName || !lead?.companyName) {
      ws.push('La vista previa usa datos parciales; el mail se verá mejor con un lead de ejemplo más completo.');
    }
    setWarnings(ws);
  }, [selectedSampleLead, selectedSampleReport]);

  // Recalcula preview cuando cambie estilo o lead de ejemplo
  useEffect(() => {
    if (!mounted) return;
    recomputePreview(style);
  }, [style, mounted, recomputePreview]);

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
          sampleData: {
            lead: selectedSampleLead,
            report: selectedSampleReport,
            companyProfile: selectedSampleReport?.company || null,
            leadId: sampleLeadId,
          }
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
      const assistantMsg = formatAssistantReply(j.explanation, summarizeStyleChanges(style, updated));

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
  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' }); }, [messages]);

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
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 xl:h-[calc(100vh-140px)] min-h-[600px]">
      {/* Columna Izquierda: Chat IA (4 cols) */}
      <div className="xl:col-span-4 flex flex-col gap-4 xl:h-full">
        <Card className="flex flex-col overflow-hidden border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] shadow-[0_20px_70px_-50px_rgba(15,23,42,0.35)] h-[min(68vh,680px)] xl:h-full dark:border-slate-800 dark:bg-[linear-gradient(180deg,#020617_0%,#111827_100%)] dark:shadow-[0_20px_70px_-50px_rgba(2,6,23,0.95)]">
          <CardHeader className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.12),_transparent_35%),linear-gradient(180deg,_rgba(248,250,252,0.95)_0%,_rgba(255,255,255,0.96)_100%)] py-4 dark:border-slate-800 dark:bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.16),_transparent_30%),linear-gradient(180deg,_rgba(15,23,42,0.96)_0%,_rgba(2,6,23,0.98)_100%)]">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-lg">Asistente de estilo</CardTitle>
                <Badge variant="outline" className="rounded-full border-slate-200 bg-white/80 text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                  chat
                </Badge>
              </div>
              <CardDescription className="dark:text-slate-300">Describe el cambio que quieres y revisa el resultado sin salir del editor.</CardDescription>
              <div className="rounded-2xl border border-slate-200 bg-white/85 px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                  <ScanSearch className="h-3.5 w-3.5 text-sky-500 dark:text-sky-300" />
                  Contexto del lead
                </div>
                <div className="space-y-1 text-sm text-slate-700 dark:text-slate-200">
                  <p><span className="font-medium text-slate-900 dark:text-white">Pain:</span> {sampleInsight.pain}</p>
                  <p><span className="font-medium text-slate-900 dark:text-white">Valor:</span> {sampleInsight.value}</p>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="flex-1 flex flex-col p-0 overflow-hidden bg-transparent">
            <div ref={chatRef} className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,rgba(248,250,252,0.45)_0%,rgba(255,255,255,0.82)_100%)] p-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.55)_0%,rgba(2,6,23,0.86)_100%)]">
              <div className="space-y-4 pr-1">
                {messages.map(m => (
                  <div key={m.id} className={`flex gap-3 items-start ${m.role === 'user' ? 'justify-end' : ''}`}>
                    {m.role === 'assistant' && (
                      <div className="h-8 w-8 rounded-full bg-indigo-100/90 flex items-center justify-center border border-indigo-200 shrink-0 shadow-sm dark:border-indigo-500/30 dark:bg-indigo-500/15">
                        <Bot className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />
                      </div>
                    )}
                    <div className={`max-w-[88%] whitespace-pre-line rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm
                      ${m.role === 'user'
                        ? 'bg-[linear-gradient(180deg,#0f172a_0%,#1e293b_100%)] text-white rounded-tr-sm dark:bg-[linear-gradient(180deg,#1e293b_0%,#334155_100%)] dark:text-white'
                        : 'border border-slate-200 bg-white/90 rounded-tl-sm dark:border-slate-800 dark:bg-slate-950/85 dark:text-slate-100'}`}>
                      {m.content}
                      <div className={`mt-2 text-[10px] uppercase tracking-[0.16em] ${m.role === 'user' ? 'text-white/60 dark:text-white/65' : 'text-muted-foreground dark:text-slate-400'}`}>
                        {m.role === 'user' ? 'tu instruccion' : 'agente'}
                      </div>
                    </div>
                  </div>
                ))}
                {isProcessing && (
                  <div className="flex gap-3 items-start animate-pulse">
                    <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center border border-indigo-200 shrink-0 dark:border-indigo-500/30 dark:bg-indigo-500/15">
                      <Bot className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />
                    </div>
                    <div className="bg-muted/50 border rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-muted-foreground dark:border-slate-800 dark:bg-slate-950/75 dark:text-slate-300">
                      Pensando cambios...
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Acciones Rápidas */}
            <div className="border-t border-slate-200 bg-white/80 p-3 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-2 flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground dark:text-slate-300"><SlidersHorizontal className="h-3.5 w-3.5" /> Atajos</div>
              <div className="grid grid-cols-2 gap-2">
                {QUICK_ACTIONS.map((action, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    size="sm"
                    className="h-9 justify-start rounded-xl border-slate-200 bg-white text-xs text-slate-700 shadow-sm transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-indigo-500/40 dark:hover:bg-slate-700 dark:hover:text-white dark:disabled:bg-slate-800 dark:disabled:text-slate-400"
                    onClick={() => runChatTurn(action.prompt)}
                    disabled={isProcessing}
                  >
                    <action.icon className="h-3 w-3 mr-2 opacity-70 dark:opacity-90" />
                    {action.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Input */}
            <div className="border-t border-slate-200 bg-white/90 p-3 dark:border-slate-800 dark:bg-slate-950/90">
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
                  className="min-h-[58px] rounded-2xl border-slate-200 bg-slate-50 pr-12 resize-none shadow-inner dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                  disabled={isProcessing}
                />
                <Button
                  size="icon"
                  className="absolute right-2 bottom-2 h-8 w-8 rounded-xl bg-slate-950 shadow-sm hover:bg-slate-800 dark:bg-slate-200 dark:text-slate-950 dark:hover:bg-white"
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
        <Card className="shrink-0 overflow-hidden border border-slate-200 bg-white shadow-[0_18px_55px_-45px_rgba(15,23,42,0.35)] dark:border-slate-800 dark:bg-slate-950 dark:shadow-[0_18px_55px_-45px_rgba(2,6,23,0.95)]">
          <CardHeader className="border-b border-slate-200 bg-slate-50/80 px-4 py-3 pb-2 dark:border-slate-800 dark:bg-slate-900/80">
            <CardTitle className="text-base text-muted-foreground font-normal">Estilo actual</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="font-medium text-lg truncate flex-1" title={style.name}>{style.name}</div>
              <Badge variant="outline" className="capitalize">{style.tone}</Badge>
            </div>
            <div className="mb-4 grid grid-cols-[1fr_auto] gap-2">
              <Button size="sm" onClick={saveProfile} className="h-10 rounded-xl bg-slate-950 shadow-sm hover:bg-slate-800 dark:bg-slate-200 dark:text-slate-950 dark:hover:bg-white"><Save className="h-3.5 w-3.5 mr-2" />Guardar</Button>
              <Button size="sm" variant="outline" onClick={() => setSelectedStyleName('')} title="Ver lista" className="h-10 rounded-xl border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"><RefreshCw className="h-3.5 w-3.5" /></Button>
            </div>
            <div className="mb-4 text-sm text-slate-600 dark:text-slate-300">
              <span className="font-medium text-slate-900 dark:text-slate-100">{style.tone || 'professional'}</span>
              <span> · </span>
              <span>{style.length || 'medium'}</span>
              <span> · </span>
              <span>{style.language || 'es'}</span>
            </div>

            {/* Lista desplegable simple si se quiere cambiar */}
            <div className="mt-4 pt-4 border-t space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                <span>Estilos guardados</span>
                <span className="flex items-center gap-1 text-[10px] uppercase tracking-[0.15em]"><ChevronsUpDown className="h-3 w-3" /> presets</span>
              </div>
              <div className="max-h-[132px] overflow-y-auto space-y-1 pr-1">
                {styles.map(s => (
                  <button
                    key={s.name}
                    onClick={() => loadProfile(s.name)}
                    className={`w-full text-left text-xs px-3 py-2 rounded-xl flex justify-between group transition-colors ${s.name === style.name ? 'bg-indigo-50 text-indigo-700 font-medium border border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-200 dark:border-indigo-500/30' : 'border border-transparent hover:bg-muted hover:border-slate-200 dark:hover:bg-slate-900 dark:hover:border-slate-800 dark:text-slate-300'}`}
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
      <div className="xl:col-span-8 grid xl:grid-rows-[auto_1fr] gap-6 xl:h-full">

        {/* Editor de Plantillas */}
        <Card className="flex flex-col overflow-hidden border border-slate-200 bg-white shadow-[0_20px_70px_-50px_rgba(15,23,42,0.32)] dark:border-slate-800 dark:bg-slate-950 dark:shadow-[0_20px_70px_-50px_rgba(2,6,23,0.95)]">
          <CardHeader className="py-4 px-5 border-b border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between dark:border-slate-800 dark:bg-[linear-gradient(180deg,#020617_0%,#0f172a_100%)]">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Plantillas</CardTitle>
              <Badge variant="secondary" className="font-normal text-xs text-muted-foreground shadow-sm">Editor</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {mounted && sampleLeads.length > 0 ? (
                <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
                  <FileText className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                  <select
                    className="h-6 max-w-[220px] bg-transparent pr-2 text-xs outline-none dark:text-slate-200 dark:[color-scheme:dark]"
                    value={sampleLeadId}
                    onChange={e => setSampleLeadId(e.target.value)}
                  >
                    {sampleLeads.map(l => <option key={l.id} value={l.id}>{l.fullName} · {l.companyName}</option>)}
                  </select>
                </div>
              ) : <span className="text-xs text-muted-foreground">Sin leads para previsualizar</span>}
            </div>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            {/* Subject */}
            <div className="grid gap-1.5 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/60">
              <div className="flex justify-between items-end">
                <label className="text-xs font-medium uppercase text-muted-foreground tracking-wider">Asunto</label>
                <div className="text-[10px] text-muted-foreground">{style.subjectTemplate?.length || 0} caracteres</div>
              </div>
              <Input
                value={style.subjectTemplate || ''}
                onChange={e => setStyle(s => ({ ...s, subjectTemplate: e.target.value }))}
                onBlur={() => recomputePreview({ ...style })}
                placeholder="Ej: {{lead.firstName}}, idea rápida para {{company.name}}"
                className="font-mono text-sm border-slate-200 bg-white focus-visible:border-indigo-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </div>

            {/* Body */}
            <div className="grid gap-1.5 flex-1 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/60">
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
                className="font-mono text-sm leading-6 border-slate-200 bg-white focus-visible:border-indigo-500 min-h-[280px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                placeholder={`Saludo\n\nHook\n\nContexto\n\nValor + CTA\n\nFirma`}
              />
            </div>
          </CardContent>
        </Card>

        {/* Preview Result */}
        <Card className="flex flex-col shadow-[0_22px_80px_-55px_rgba(15,23,42,0.42)] border border-slate-200 relative overflow-hidden bg-[linear-gradient(180deg,#eef4ff_0%,#f8fafc_100%)] dark:border-slate-800 dark:bg-[linear-gradient(180deg,#0f172a_0%,#020617_100%)] dark:shadow-[0_22px_80px_-55px_rgba(2,6,23,0.98)]">
          <div className="absolute top-0 right-0 p-2 opacity-5 pointer-events-none">
            <Wand2 className="h-32 w-32" />
          </div>
          <CardHeader className="py-4 px-5 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <CardTitle className="text-sm font-medium text-slate-600 dark:text-slate-300">Vista previa</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="flex-1 overflow-auto p-5">
            <div className="mx-auto max-w-4xl rounded-[28px] border border-slate-200 bg-white shadow-[0_30px_80px_-45px_rgba(15,23,42,0.45)] overflow-hidden dark:border-slate-800 dark:bg-slate-950 dark:shadow-[0_30px_80px_-45px_rgba(2,6,23,0.98)]">
              <div className="border-b border-slate-200 bg-[linear-gradient(180deg,#f8fbff_0%,#f3f6fb_100%)] px-5 py-3 dark:border-slate-800 dark:bg-[linear-gradient(180deg,#111827_0%,#0f172a_100%)]">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-[#ea4335]" />
                      <span className="h-2.5 w-2.5 rounded-full bg-[#fbbc05]" />
                      <span className="h-2.5 w-2.5 rounded-full bg-[#34a853]" />
                    </div>
                    <div className="flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs text-slate-500 shadow-sm border border-slate-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                      <Mail className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                      Mensaje nuevo
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
                    <Clock3 className="h-3.5 w-3.5" />
                    ahora
                  </div>
                </div>
              </div>
              <div className="grid gap-6 bg-[#f8fafc] p-4 lg:grid-cols-[220px_minmax(0,1fr)] dark:bg-[#020617]">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-950/80">
                  <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">Contexto</div>
                  <div className="space-y-3 text-slate-600 dark:text-slate-300">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">Para</div>
                      <div className="font-medium text-slate-800 dark:text-slate-100">{selectedSampleLead?.fullName || 'Lead de ejemplo'}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{selectedSampleLead?.email || 'correo no disponible'}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">Empresa</div>
                      <div className="font-medium text-slate-800 dark:text-slate-100">{selectedSampleLead?.companyName || 'Empresa de ejemplo'}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{selectedSampleLead?.title || 'Cargo no disponible'}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">Agente</div>
                      <div className="text-sm text-slate-700 dark:text-slate-200">{style.tone || 'professional'} · {style.length || 'medium'}</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">Objetivo</div>
                      <div className="text-sm text-slate-700 dark:text-slate-200">correo mas creible, directo y listo para revisar</div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">Motor</div>
                      <div className="text-sm text-slate-700 dark:text-slate-200">chat + templates + validacion visual</div>
                    </div>
                  </div>
                </div>
                <div className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950/85">
                  <div className="mb-5 flex items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
                    <div className="min-w-0">
                      <div className="mb-2 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">{highlightTokens(subjectPreview || 'Sin asunto')}</div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
                        <span className="font-medium text-slate-700 dark:text-slate-200">Tú</span>
                        <span>&lt;tu-bandeja@anton.ia&gt;</span>
                        <span>para</span>
                        <span className="text-slate-700 dark:text-slate-200">{selectedSampleLead?.fullName || 'lead de ejemplo'}</span>
                      </div>
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-500">borrador</div>
                  </div>
                  <div className="space-y-4 text-[15px] leading-7 text-slate-800 dark:text-slate-200">
                    {(bodyPreview || '...').split(/\n\n+/).map((paragraph, index) => (
                      <p key={`${index}-${paragraph.slice(0, 12)}`}>
                        {highlightTokens(paragraph)}
                      </p>
                    ))}
                  </div>
                </div>
              </div>

              {warnings?.length > 0 && (
                <div className="border-t border-amber-100 bg-amber-50/80 p-4 text-xs text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100">
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
