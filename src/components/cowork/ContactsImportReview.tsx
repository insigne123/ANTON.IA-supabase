'use client';

import { useEffect, useState } from 'react';
import { COWORK_IMPORT_SHOWN, coworkImportSummary, type CoworkImportPreview } from '@/lib/cowork/contacts-import';
import { ReviewActions, ReviewChips, ReviewError, ReviewField, ReviewFields, ReviewLoading, ReviewNote } from './ReviewParts';

type Preview = CoworkImportPreview & { matches: boolean };

/**
 * Contacts-import review card: the exact contacts staged for the proposal, which column each field came
 * from and what was left out (already saved, rows without a name, over the limit). A staged import that
 * no longer matches the proposal blocks approval.
 */
export function ContactsImportReview({ runId, onApprove, onReject, resolving }: {
  runId: string; onApprove: () => void; onReject: () => void; resolving: boolean;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    setPreview(null);
    setError('');
    fetch(`/api/cowork/runs/${runId}/contactsimport-preview`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudo cargar la vista previa.');
        if (!disposed) setPreview(data);
      })
      .catch(err => { if (!disposed) setError(err instanceof Error ? err.message : 'No se pudo cargar la vista previa.'); });
    return () => { disposed = true; };
  }, [runId]);
  if (error) return <ReviewError message={error} />;
  if (!preview) return <ReviewLoading label="Cargando los contactos del archivo…" />;
  const summary = coworkImportSummary(preview);
  return <div className="space-y-4">
    <div className="space-y-1">
      <p className="text-[14px]"><span className="font-semibold">{summary.headline}</span>
        <span className="text-cw-muted"> {summary.source}</span></p>
      {!!summary.leftOut.length && <p className="text-[12.5px] text-cw-muted">Quedan fuera: {summary.leftOut.join(' · ')}.</p>}
    </div>
    <ReviewFields>
      <ReviewField label="Columnas"><ReviewChips values={summary.columns} empty="Sin columnas" /></ReviewField>
    </ReviewFields>
    <div className="overflow-x-auto rounded-xl border border-cw-border bg-cw-panel">
      <table className="w-full text-left text-[13px]">
        <caption className="sr-only">Contactos que se importan</caption>
        <thead className="text-[12px] text-cw-muted">
          <tr className="border-b border-cw-border">
            <th scope="col" className="px-3 py-2 font-medium">Nombre</th>
            <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">Empresa</th>
            <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">Correo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-cw-border">
          {preview.contacts.slice(0, COWORK_IMPORT_SHOWN).map((contact, index) => <tr key={`${contact.name}-${index}`}>
            <td className="px-3 py-2">
              <span className="font-medium">{contact.name}</span>
              {contact.title && <span className="block text-[12px] text-cw-muted">{contact.title}</span>}
              {/* On a phone the company and the email go under the name, so nothing hides off to the side. */}
              <span className="block break-all text-[12px] text-cw-muted sm:hidden">
                {contact.company && `${contact.company} · `}{contact.email || <span className="text-cw-faint">Sin correo</span>}
              </span>
            </td>
            <td className="hidden px-3 py-2 sm:table-cell">{contact.company || <span className="text-cw-faint">—</span>}</td>
            <td className="hidden break-all px-3 py-2 sm:table-cell">{contact.email || <span className="text-cw-faint">Sin correo</span>}</td>
          </tr>)}
        </tbody>
      </table>
      {summary.more && <p className="border-t border-cw-border px-3 py-2 text-[12.5px] text-cw-muted">{summary.more}</p>}
    </div>
    {summary.notes.map(note => <ReviewNote key={note}>{note}</ReviewNote>)}
    <ReviewNote ok={preview.matches}>{preview.matches
      ? 'Coincide con la propuesta. Al aprobar se guardan solo estos contactos; no se les escribe ni se gastan créditos.'
      : 'La importación cambió desde la propuesta. Descártala y pide una nueva.'}</ReviewNote>
    <ReviewActions onReject={onReject} onApprove={onApprove} approveLabel={summary.approve}
      disabled={!preview.matches} resolving={resolving} />
  </div>;
}
