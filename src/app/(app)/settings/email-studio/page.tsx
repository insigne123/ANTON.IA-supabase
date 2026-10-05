'use client';

import { useEffect, useState } from 'react';
import { Palette, PenLine } from 'lucide-react';

import EmailStyleDesigner from '@/components/email-studio/EmailStyleDesigner';
import SignatureBuilder from '@/components/email-studio/SignatureBuilder';
import { PageHeader } from '@/components/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * «Firmas y estilo» (Plan 11, PR 3b): two tabs. «Firma» builds the signature that goes out with every email; «Estilos» is
 * the gallery of styles the drafts are written with. `?tab=firma|estilos` opens one directly; otherwise the last one used.
 * Both stay mounted, so moving between them never loses what is being edited.
 */
type StudioTab = 'firma' | 'estilos';
const TAB_KEY = 'anton.email-studio.tab';
const isTab = (value: unknown): value is StudioTab => value === 'firma' || value === 'estilos';

export default function EmailStudioPage() {
  // null until the URL and the remembered tab are read, so the page never shows one tab and then jumps to the other.
  const [tab, setTab] = useState<StudioTab | null>(null);
  const [signatureVersion, setSignatureVersion] = useState(0);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab');
    let remembered: string | null = null;
    try { remembered = window.localStorage.getItem(TAB_KEY); } catch { /* storage unavailable */ }
    setTab(isTab(requested) ? requested : isTab(remembered) ? remembered : 'firma');
  }, []);

  function chooseTab(next: string) {
    if (!isTab(next)) return;
    setTab(next);
    try { window.localStorage.setItem(TAB_KEY, next); } catch { /* storage unavailable */ }
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(window.history.state, '', url);
  }

  return (
    <div className="mx-auto min-w-0 max-w-[1500px] pb-16">
      <PageHeader
        eyebrow="Configuración"
        title="Firmas y estilo"
        description="Tu firma va al final de cada correo que envías. Tus estilos le dicen a la IA cómo escribir tus borradores."
      />

      <Tabs value={tab ?? ''} onValueChange={chooseTab} className="min-w-0">
        <TabsList className="grid h-11 w-full grid-cols-2 sm:inline-grid sm:w-auto">
          <TabsTrigger value="firma" className="gap-2 px-5"><PenLine className="h-4 w-4" aria-hidden="true" />Firma</TabsTrigger>
          <TabsTrigger value="estilos" className="gap-2 px-5"><Palette className="h-4 w-4" aria-hidden="true" />Estilos</TabsTrigger>
        </TabsList>

        <TabsContent value="firma" forceMount className="mt-6 min-w-0 data-[state=inactive]:hidden">
          <SignatureBuilder onSaved={() => setSignatureVersion(version => version + 1)} />
        </TabsContent>
        <TabsContent value="estilos" forceMount className="mt-6 min-w-0 data-[state=inactive]:hidden">
          <EmailStyleDesigner onOpenSignature={() => chooseTab('firma')} signatureVersion={signatureVersion} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
