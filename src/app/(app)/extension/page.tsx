import Link from 'next/link';
import { Download, Mail, Puzzle, Search, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'Extensión para LinkedIn · ANTON.IA' };

// The extension is installed from the ZIP the app serves (public/downloads) until it is in the Chrome Web Store.
const VERSION = '4.2.0';
const STEPS = [
  'Descarga el archivo y descomprímelo en una carpeta que no vayas a borrar.',
  'En Chrome abre chrome://extensions y activa «Modo de desarrollador», arriba a la derecha.',
  'Pulsa «Cargar descomprimida», elige la carpeta y fija ANTON.IA en la barra de Chrome.',
  'Abre LinkedIn, pulsa el ícono de ANTON.IA y luego «Conectar Anton.IA».',
];

/** Where the app offers the LinkedIn extension: what it does and how to install it, in four steps. */
export default function ExtensionPage() {
  return <div className="mx-auto max-w-2xl px-5 py-10">
    <section className="rounded-3xl border border-border bg-card p-8 shadow-sm">
      <div className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-cw-accent-soft text-primary"><Puzzle aria-hidden="true" /></div>
      <h1 className="text-balance text-2xl font-semibold tracking-tight">Extensión para LinkedIn</h1>
      <p className="mt-3 text-sm leading-6 text-foreground/70">Elige personas en una búsqueda de LinkedIn o abre un perfil: ANTON.IA busca su correo, las guarda en «Por escribir» y te ayuda a escribirles, sin salir de LinkedIn.</p>
      <ul className="mt-5 grid gap-3 text-sm">
        <li className="flex items-start gap-3"><Mail className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />Correo de varias personas de una búsqueda en un clic, con los créditos de tu cuenta.</li>
        <li className="flex items-start gap-3"><Search className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />Investigación con fuentes de cada contacto.</li>
        <li className="flex items-start gap-3"><Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />Mensajes de LinkedIn y correos con contexto, que revisas tú.</li>
      </ul>
      <Button asChild className="mt-7 w-full sm:w-auto">
        <a href="/downloads/antonia-linkedin-extension.zip" download><Download className="mr-2 size-4" aria-hidden="true" />Descargar extensión · versión {VERSION}</a>
      </Button>
      <h2 className="mt-8 text-base font-semibold">Instalarla en Chrome</h2>
      <ol className="mt-3 grid gap-2 text-sm leading-6 text-foreground/80">
        {STEPS.map((step, index) => <li key={step} className="flex gap-3"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums" aria-hidden="true">{index + 1}</span><span>{step}</span></li>)}
      </ol>
      <p className="mt-6 text-xs leading-5 text-foreground/60">Si ya la tenías, reemplaza la carpeta con la nueva versión, pulsa «Actualizar» en chrome://extensions y recarga LinkedIn. Lo que guardes queda en tu organización; puedes desconectarla desde su panel cuando quieras. ¿Prefieres buscar desde la app? Usa <Link className="underline underline-offset-4" href="/search">Buscar</Link>.</p>
    </section>
  </div>;
}
