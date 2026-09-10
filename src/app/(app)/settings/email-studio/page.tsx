'use client';

import Link from 'next/link';
import { Beaker, PenLine } from 'lucide-react';

import EmailStyleDesigner from '@/components/email-studio/EmailStyleDesigner';
import SignatureManager from '@/components/email-studio/SignatureManager';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function EmailStudioPage() {
  return (
    <div className="mx-auto min-w-0 max-w-[1500px] space-y-6 pb-16">
      <PageHeader
        title="Email Studio"
        description="Tu firma y el estilo de tus correos, listos antes de enviar."
      >
        <Button asChild variant="outline" size="sm" className="w-full rounded-full sm:w-auto">
          <Link href="/settings/email-studio/test">
            <Beaker className="mr-2 h-4 w-4" />
            Probar envíos
          </Link>
        </Button>
      </PageHeader>

      <Card className="overflow-hidden rounded-[24px] border-border/70 bg-card/80">
        <CardHeader className="border-b border-border/60 px-4 py-5 sm:px-6">
          <div className="flex items-center gap-2">
            <PenLine className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <CardTitle className="text-lg tracking-tight">Firma de correo</CardTitle>
          </div>
          <CardDescription>Sube tu firma una vez por cuenta y se añadirá automáticamente a tus envíos.</CardDescription>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-6 p-4 sm:p-6 lg:grid-cols-2">
          <SignatureManager channel="gmail" />
          <SignatureManager channel="outlook" />
        </CardContent>
      </Card>

      <EmailStyleDesigner />
    </div>
  );
}
