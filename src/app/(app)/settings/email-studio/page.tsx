'use client';

import { PageHeader } from '@/components/page-header';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import ConversationalDesigner from '@/components/email-studio/ConversationalDesigner';
import SignatureManager from '@/components/email-studio/SignatureManager';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Beaker } from 'lucide-react';

export default function EmailStudioPage() {
  const AdvancedEditor = () => {
    return (
      <div className="text-center text-muted-foreground p-8 border rounded-lg">
        Advanced Editor Placeholder
      </div>
    )
  }


  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <PageHeader title="Email Studio" description="Personaliza el tono y la estructura de tus correos." />
        <Link href="/settings/email-studio/test">
          <Button variant="outline" size="sm">
            <Beaker className="mr-2 h-4 w-4" />
            <span>Tester de Envíos</span>
          </Button>
        </Link>
      </div>
      <Tabs defaultValue="chat">
        <TabsList>
          <TabsTrigger value="chat">Conversacional</TabsTrigger>
          <TabsTrigger value="advanced">Avanzado</TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="mt-4">
          <ConversationalDesigner mode="leads" />
        </TabsContent>
        <TabsContent value="advanced" className="mt-4">
          <div className="space-y-8">
            <AdvancedEditor />
            <section className="space-y-3">
              <h2 className="text-xl font-semibold">Firmas</h2>
              <p className="text-sm text-muted-foreground">
                Configura tu firma para cada canal. Se añadirá automáticamente al enviar desde la app.
              </p>
              <div className="grid lg:grid-cols-2 gap-8">
                <div className="space-y-3">
                  <SignatureManager channel="gmail" />
                </div>
                <div className="space-y-3">
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
