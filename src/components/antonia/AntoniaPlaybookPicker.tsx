'use client';

import { BriefcaseBusiness, CheckCircle2, Sparkles } from 'lucide-react';

import type { AntoniaPlaybook } from '@/lib/antonia-playbooks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function AntoniaPlaybookPicker({
  playbooks,
  selectedId,
  onApply,
}: {
  playbooks: AntoniaPlaybook[];
  selectedId?: string | null;
  onApply: (playbook: AntoniaPlaybook) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BriefcaseBusiness className="h-4 w-4 text-primary" />
          Playbooks para outsourcing
        </CardTitle>
        <CardDescription>
          Arranca mas rapido con misiones preconfiguradas para verticales donde ANTONIA puede operar casi en piloto automatico.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {playbooks.map((playbook) => {
            const selected = playbook.id === selectedId;
            return (
              <div
                key={playbook.id}
                className={`rounded-2xl border p-4 transition-colors ${selected ? 'border-primary bg-primary/5' : 'bg-card hover:border-primary/40'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{playbook.name}</p>
                    <p className="text-sm text-muted-foreground">{playbook.summary}</p>
                  </div>
                  {selected && <CheckCircle2 className="h-4 w-4 text-primary" />}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="outline">{playbook.vertical}</Badge>
                  <Badge variant="secondary">{playbook.defaults.jobTitle}</Badge>
                  <Badge variant="outline">{playbook.defaults.location}</Badge>
                </div>

                <p className="mt-3 text-xs text-muted-foreground">{playbook.whyItWorks}</p>

                <Button className="mt-4 w-full" variant={selected ? 'default' : 'outline'} onClick={() => onApply(playbook)}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  {selected ? 'Playbook aplicado' : 'Usar playbook'}
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
