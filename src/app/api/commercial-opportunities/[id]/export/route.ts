import { z } from 'zod';
import { requireOpportunityWorkspace, opportunityScope, assertOpportunityRead } from '@/lib/server/commercial-opportunities/workspace-access';
import { opportunityDb } from '@/lib/server/commercial-opportunities/workspace-store';
import { opportunityReportMarkdown, opportunityReportPdf, opportunityReportExcel } from '@/lib/server/commercial-opportunities/workspace-exports';
import { opportunitiesError } from '@/lib/server/commercial-opportunities/responses';
import { AuthError } from '@/lib/server/auth-utils';
import { OPPORTUNITY_BUCKET } from '@/lib/commercial-opportunities/workspace';
import type { OpportunityReport } from '@/lib/commercial-opportunities/expedient';
import {CoworkExportError} from '@/lib/server/cowork/file-exports';
import {opportunitiesJson} from '@/lib/server/commercial-opportunities/responses';

export const dynamic = 'force-dynamic'; export const maxDuration = 60;
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireOpportunityWorkspace(); const scope = opportunityScope(auth); const id = z.string().uuid().parse((await context.params).id);
    await assertOpportunityRead(auth.admin, scope, id);
    const format = z.enum(['pdf', 'md', 'docx', 'xlsx', 'zip']).parse(new URL(request.url).searchParams.get('format') || 'pdf');
    const row = opportunityDb(await auth.admin.from('opportunity_reports').select('report').eq('organization_id', scope.organizationId).eq('opportunity_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle());
    if (!row) throw new AuthError('El informe aún no está disponible.', 409);
    const report = row.report as OpportunityReport; let bytes: Uint8Array; let mime: string;
    if (format === 'pdf') { bytes = await opportunityReportPdf(report); mime = 'application/pdf'; }
    else if (format === 'xlsx') { bytes = await opportunityReportExcel(report); mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; }
    else if (format === 'docx') {
      const {renderCoworkDocx}=await import('@/lib/server/cowork/docx-render');
      const {parseMarkdown}=await import('@/lib/cowork/markdown');
      bytes = await renderCoworkDocx(report.title,parseMarkdown(opportunityReportMarkdown(report)));
      mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    } else if (format === 'md') { bytes = new TextEncoder().encode(opportunityReportMarkdown(report)); mime = 'text/markdown'; }
    else {
      const { default: JSZip } = await import('jszip'); const zip = new JSZip();
      zip.file('Informe.pdf', await opportunityReportPdf(report)); zip.file('Informe.md', opportunityReportMarkdown(report)); zip.file('Requisitos-y-plan.xlsx', await opportunityReportExcel(report));
      const docs = opportunityDb(await auth.admin.from('opportunity_documents').select('id,name,bytes,storage_path,extraction_status').eq('organization_id', scope.organizationId).eq('opportunity_id', id)) || [];
      if (docs.reduce((sum, d) => sum + d.bytes, 0) > 80 * 1024 * 1024) throw new AuthError('El paquete supera 80 MB. Descarga los anexos individualmente.', 413);
      const index = [];
      for (const doc of docs) {
        if (!doc.storage_path) continue;
        const file = opportunityDb(await auth.admin.storage.from(OPPORTUNITY_BUCKET).download(doc.storage_path));
        if (!file) throw new AuthError('Un anexo no pudo descargarse; no entregaremos un paquete incompleto.', 503);
        const name = `Anexos/${doc.id.slice(0, 8)}-${doc.name.replace(/[\\/\u0000-\u001f]/g, '_')}`;
        zip.file(name, await file.arrayBuffer()); index.push({ id: doc.id, file: name, extraction: doc.extraction_status });
      }
      zip.file('Indice-documentos.json', JSON.stringify({ generatedAt: report.generatedAt, documents: index, warnings: report.warnings }, null, 2));
      bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 3 } }); mime = 'application/zip';
    }
    return new Response(new Uint8Array(bytes).buffer, { headers: { 'Content-Type': mime, 'Content-Disposition': `attachment; filename="Expediente-${id.slice(0, 8)}.${format}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return error instanceof CoworkExportError?opportunitiesJson({error:error.message},error.status):opportunitiesError(error); }
}
