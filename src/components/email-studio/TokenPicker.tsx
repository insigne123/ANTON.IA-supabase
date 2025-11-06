
'use client';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type TokenPickerProps = {
  onInsert: (token: string) => void;
  scope: 'leads'|'opportunities';
};

const TOKENS = {
  common: [
    { label: 'Mi empresa', token: '{{companyProfile.name}}' },
    { label: 'Servicios', token: '{{companyProfile.services}}' },
    { label: 'Valor', token: '{{companyProfile.valueProposition}}' },
  ],
  leads: [
    { label: 'Nombre lead', token: '{{lead.name}}' },
    { label: 'Cargo', token: '{{lead.title}}' },
    { label: 'Empresa lead', token: '{{lead.company}}' },
    { label: 'Ciudad', token: '{{lead.city}}' },
    { label: 'País', token: '{{lead.country}}' },
    { label: 'Pain #1', token: '{{report.pains.0}}' },
    { label: 'ValueProp #1', token: '{{report.valueProps.0}}' },
  ],
  opps: [
    { label: 'Título vacante', token: '{{job.title}}' },
    { label: 'Empresa', token: '{{job.companyName}}' },
    { label: 'Ubicación', token: '{{job.location}}' },
    { label: 'Descripción (snippet)', token: '{{job.descriptionSnippet}}' },
    { label: 'URL Postulación', token: '{{job.applyUrl}}' },
    { label: 'ValueProp #1', token: '{{report.valueProps.0}}' },
  ],
};

export function TokenPicker({ onInsert, scope }: TokenPickerProps) {
  const items = [
    ...TOKENS.common,
    ...(scope === 'leads' ? TOKENS.leads : TOKENS.opps),
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">Tokens</Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2">
        <div className="text-xs text-muted-foreground mb-2">Haz clic para insertar:</div>
        <div className="grid grid-cols-1 gap-1">
          {items.map((i) => (
            <Button key={i.token} variant="ghost" size="sm" className="justify-start"
              onClick={() => onInsert(i.token)}>
              {i.label}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
