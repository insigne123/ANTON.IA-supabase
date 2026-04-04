'use client';

import { PageHeader } from '@/components/page-header';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import ConversationalDesigner from '@/components/email-studio/ConversationalDesigner';
import SignatureManager from '@/components/email-studio/SignatureManager';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Beaker, Sparkles, Layers3, PanelTop, PenSquare, BadgeCheck } from 'lucide-react';

export default function EmailStudioPage() {
  const AdvancedEditor = () => {
    return (
      <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] shadow-[0_20px_70px_-50px_rgba(15,23,42,0.35)] dark:border-slate-800 dark:bg-[linear-gradient(180deg,#020617_0%,#0f172a_100%)] dark:shadow-[0_20px_70px_-50px_rgba(2,6,23,0.95)]">
        <div className="grid gap-6 border-b border-slate-200 px-6 py-6 dark:border-slate-800 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
              <Layers3 className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-300" />
              Espacio en evolución
            </div>
            <h3 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">El editor avanzado puede convertirse en tu biblioteca de mensajes y estructuras.</h3>
            <p className="max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              La idea es darte un espacio más silencioso y ordenado para reutilizar asuntos, cuerpos, CTA y firmas sin depender siempre del chat.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950/70">
              <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"><PanelTop className="h-4 w-4 text-sky-500 dark:text-sky-300" /> Paneles</div>
              <div className="text-sm font-medium text-slate-900 dark:text-slate-100">Bloques reutilizables para asunto, cuerpo, CTA y firma.</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950/70">
              <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"><PenSquare className="h-4 w-4 text-indigo-500 dark:text-indigo-300" /> Snippets</div>
              <div className="text-sm font-medium text-slate-900 dark:text-slate-100">Biblioteca de hooks, objeciones y cierres guardados.</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950/70">
              <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400"><BadgeCheck className="h-4 w-4 text-emerald-500 dark:text-emerald-300" /> QA</div>
              <div className="text-sm font-medium text-slate-900 dark:text-slate-100">Revisiones simples antes de reutilizar o enviar.</div>
            </div>
          </div>
        </div>
        <div className="grid gap-4 bg-slate-50/70 px-6 py-5 dark:bg-slate-900/50 lg:grid-cols-3">
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white/80 p-5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-300">
            <div className="mb-2 font-medium text-slate-800 dark:text-slate-100">01. Estructura del correo</div>
            <p>Ordena hook, contexto, valor, prueba y CTA con drag-and-drop o presets.</p>
          </div>
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white/80 p-5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-300">
            <div className="mb-2 font-medium text-slate-800 dark:text-slate-100">02. Librería reusable</div>
            <p>Guarda variaciones por ICP, idioma, tono y nivel de agresividad comercial.</p>
          </div>
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white/80 p-5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-300">
            <div className="mb-2 font-medium text-slate-800 dark:text-slate-100">03. Verificación final</div>
            <p>Valida antes/después, tokens y consistencia entre preview, firma y copy.</p>
          </div>
        </div>
      </div>
    )
  }


  return (
    <div className="space-y-6 pb-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <PageHeader title="Email Studio" description="Personaliza el tono y la estructura de tus correos." />
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="outline" className="rounded-full border-slate-300 bg-white/80 px-3 py-1 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
            Premium workspace
          </Badge>
          <Link href="/settings/email-studio/test">
            <Button variant="outline" size="sm" className="rounded-full border-slate-300 bg-white/85 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
              <Beaker className="mr-2 h-4 w-4" />
              <span>Tester de Envíos</span>
            </Button>
          </Link>
        </div>
      </div>
      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.10),_transparent_26%),linear-gradient(180deg,_#ffffff_0%,_#f8fafc_100%)] shadow-[0_28px_90px_-55px_rgba(15,23,42,0.30)] dark:border-slate-800 dark:bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.08),_transparent_24%),linear-gradient(180deg,_#020617_0%,_#0b1220_100%)] dark:shadow-[0_28px_90px_-55px_rgba(2,6,23,0.95)]">
        <div className="space-y-4 p-6 xl:p-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white/85 px-3 py-1 text-xs font-medium text-indigo-700 shadow-sm dark:border-indigo-500/30 dark:bg-slate-950/70 dark:text-indigo-300">
            <Sparkles className="h-3.5 w-3.5" />
            Personalización asistida
          </div>
          <div className="space-y-3">
            <h2 className="max-w-4xl text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-50 sm:text-4xl">Crea correos más claros, más creíbles y más alineados con tu estilo.</h2>
            <p className="max-w-3xl text-sm leading-7 text-slate-600 dark:text-slate-300 sm:text-[15px]">
              Conversa con el agente, revisa el resultado antes de guardarlo y mantén una voz consistente para todo tu equipo.
            </p>
          </div>
        </div>
      </section>
      <Tabs defaultValue="chat" className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white/85 p-1 shadow-sm dark:border-slate-800 dark:bg-slate-950/80 lg:w-auto">
            <TabsTrigger value="chat" className="rounded-xl px-4 py-2.5">Conversacional</TabsTrigger>
            <TabsTrigger value="advanced" className="rounded-xl px-4 py-2.5">Avanzado</TabsTrigger>
          </TabsList>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Badge variant="outline" className="rounded-full border-slate-300 bg-white px-3 py-1 text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">Scroll contenido</Badge>
            <Badge variant="outline" className="rounded-full border-slate-300 bg-white px-3 py-1 text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">Preview Gmail</Badge>
            <Badge variant="outline" className="rounded-full border-slate-300 bg-white px-3 py-1 text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">Jerarquía premium</Badge>
          </div>
        </div>
        <TabsContent value="chat" className="mt-4">
          <ConversationalDesigner mode="leads" />
        </TabsContent>
        <TabsContent value="advanced" className="mt-4">
          <div className="space-y-8">
            <AdvancedEditor />
            <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_20px_70px_-50px_rgba(15,23,42,0.35)] dark:border-slate-800 dark:bg-slate-950 dark:shadow-[0_20px_70px_-50px_rgba(2,6,23,0.95)]">
              <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
                <h2 className="text-xl font-semibold text-slate-950 dark:text-slate-50">Firmas</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                Configura tu firma para cada canal. Se añadirá automáticamente al enviar desde la app.
                </p>
              </div>
              <div className="grid gap-8 p-6 lg:grid-cols-2">
                <div className="space-y-3 rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                  <SignatureManager channel="gmail" />
                </div>
                <div className="space-y-3 rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                  <SignatureManager channel="outlook" />
                </div>
              </div>
            </section>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
