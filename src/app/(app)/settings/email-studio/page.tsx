'use client';

import Link from 'next/link';
import { Beaker, ChevronDown } from 'lucide-react';

import EmailStyleDesigner from '@/components/email-studio/EmailStyleDesigner';
import SignatureManager from '@/components/email-studio/SignatureManager';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

export default function EmailStudioPage() {
  return (
    <div className="mx-auto min-w-0 max-w-[1500px] space-y-6 pb-16">
      <PageHeader
        title="Email Studio"
        description="Define cómo deben sonar tus correos y revisa el resultado antes de guardarlo."
      >
        <Button asChild variant="outline" size="sm" className="w-full rounded-full sm:w-auto">
          <Link href="/settings/email-studio/test">
            <Beaker className="mr-2 h-4 w-4" />
            Probar envíos
          </Link>
        </Button>
      </PageHeader>

      <EmailStyleDesigner />

      <Collapsible className="min-w-0 overflow-hidden rounded-[24px] border border-border/70 bg-card/80">
        <h2>
          <CollapsibleTrigger asChild>
            <button type="button" className="group flex w-full min-w-0 items-center justify-between gap-4 px-4 py-4 text-left outline-none hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-6">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">Firmas avanzadas</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  Configura una firma distinta para Gmail y Outlook.
                </span>
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
            </button>
          </CollapsibleTrigger>
        </h2>
        <CollapsibleContent>
          <div className="min-w-0 border-t border-border/70 px-4 sm:px-6">
            <div className="min-w-0 py-6">
              <SignatureManager channel="gmail" />
            </div>
            <div className="min-w-0 border-t border-border/70 py-6">
              <SignatureManager channel="outlook" />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
