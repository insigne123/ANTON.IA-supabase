
'use client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Info } from 'lucide-react';

export function HelpCard() {
  return (
    <Alert className="mb-3">
      <Info className="h-4 w-4" />
      <AlertTitle>¿Cómo funciona?</AlertTitle>
      <AlertDescription className="space-y-2 text-sm">
        <p>
          1) Escribe tu <strong>asunto</strong> y <strong>cuerpo</strong>. Puedes insertar variables con los botones de <em>Tokens</em>.
        </p>
        <p>
          2) Usa <strong>Snippets</strong> para añadir bloques típicos (pains, casos de uso, CTA) con condicionales.
        </p>
        <p>
          3) Ajusta <strong>Tono</strong> y <strong>Intensidad IA</strong>. La IA puede reescribir suavemente o redactar desde cero <em>sin inventar información</em>.
        </p>
        <p>
          4) En <strong>Vista previa</strong> verás un render con datos de muestra y un <em>Checklist</em> de calidad.
        </p>
      </AlertDescription>
    </Alert>
  );
}
