'use client';

import { PageHeader } from '@/components/page-header';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import ConversationalDesigner from '@/components/email-studio/ConversationalDesigner';
import SignatureManager from '@/components/email-studio/SignatureManager';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Beaker, Layers3 } from 'lucide-react';

export default function EmailStudioPage() {
  const AdvancedEditor = () => {
    return (
      <div className="flex flex-col gap-4 rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_18px_55px_-44px_rgba(15,23,42,0.25)] sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-950 dark:shadow-[0_18px_55px_-44px_rgba(2,6,23,0.9)]">
          <div className="min-w-0 space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              <Layers3 className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-300" />
              Proximamente
            </div>
            <h3 className="text-lg font-semibold tracking-tight text-slate-950 dark:text-slate-50">Biblioteca de mensajes reutilizables</h3>
            <p className="max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              Pronto podrás guardar bloques, CTAs y variantes de mensajes que ya funcionan.
            </p>
          </div>
      </div>
    )
  }


  return (
    <div className="space-y-4 pb-6">
      <PageHeader title="Email Studio" description="Define tu estilo y revisa cómo se verá antes de enviar.">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="rounded-full border-slate-300 bg-white/80 px-3 py-1 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
            Tono guardado
          </Badge>
          <Link href="/settings/email-studio/test">
            <Button variant="outline" size="sm" className="rounded-full border-slate-300 bg-white/85 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
              <Beaker className="mr-2 h-4 w-4" />
              <span>Tester de Envíos</span>
            </Button>
          </Link>
        </div>
      </PageHeader>
      <Tabs defaultValue="chat" className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white/85 p-1 shadow-sm dark:border-slate-800 dark:bg-slate-950/80 lg:w-auto">
            <TabsTrigger value="chat" className="rounded-xl px-4 py-2.5">Conversacional</TabsTrigger>
            <TabsTrigger value="advanced" className="rounded-xl px-4 py-2.5">Avanzado</TabsTrigger>
          </TabsList>
          <p className="text-xs text-muted-foreground">Los cambios se aplican a la vista previa al editar.</p>
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
