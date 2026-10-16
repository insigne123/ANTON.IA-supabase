import { z } from 'zod';
import { requireOpportunityWorkspace, opportunityScope, assertOpportunityRead } from '@/lib/server/commercial-opportunities/workspace-access';
import { opportunityDb, readOpportunityReportMarks, workspaceMembers } from '@/lib/server/commercial-opportunities/workspace-store';
import { opportunityReportMarkdown, opportunityReportPdf, opportunityReportExcel, type ExportMarks } from '@/lib/server/commercial-opportunities/workspace-exports';
import { opportunityStorageName } from '@/lib/server/commercial-opportunities/workspace-documents';
import { opportunitiesError } from '@/lib/server/commercial-opportunities/responses';
import { AuthError } from '@/lib/server/auth-utils';
import { OPPORTUNITY_BUCKET } from '@/lib/commercial-opportunities/workspace';
import type { OpportunityReport } from '@/lib/commercial-opportunities/expedient';
import {CoworkExportError} from '@/lib/server/cowork/file-exports';
import {opportunitiesJson} from '@/lib/server/commercial-opportunities/responses';
import { opportunityExportName } from '@/lib/commercial-opportunities/export-file-name';

export const dynamic = 'force-dynamic'; export const maxDuration = 60;
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireOpportunityWorkspace(); const scope = opportunityScope(auth); const id = z.string().uuid().parse((await context.params).id);
    await assertOpportunityRead(auth.admin, scope, id);
    const format = z.enum(['pdf', 'md', 'docx', 'xlsx', 'zip']).parse(new URL(request.url).searchParams.get('format') || 'pdf');
    const row = opportunityDb(await auth.admin.from('opportunity_reports').select('report').eq('organization_id', scope.organizationId).eq('opportunity_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle());
    if (!row) throw new AuthError('El informe aún no está disponible.', 409);
    const report = row.report as OpportunityReport; let bytes: Uint8Array; let mime: string;
    const item = opportunityDb(await auth.admin.from('commercial_opportunities').select('title,buyer_name,company_name,deadline_at,amount,currency').eq('organization_id', scope.organizationId).eq('id', id).maybeSingle());
    const opportunity = item ? { title: item.title, buyer: item.buyer_name || item.company_name, deadline: item.deadline_at, amount: item.amount, currency: item.currency } : undefined;
    // The download keeps what the team marked: checks, highlights and notes with who wrote them.
    const saved = await readOpportunityReportMarks(auth.admin, scope, id);
    const marks: ExportMarks | undefined = saved.available ? { items: saved.items,
      names: Object.fromEntries((await workspaceMembers(auth.admin, scope)).map(member => [member.user_id, member.name])) } : undefined;
    if (format === 'pdf') { bytes = await opportunityReportPdf(report, opportunity, marks); mime = 'application/pdf'; }
    else if (format === 'xlsx') { bytes = await opportunityReportExcel(report); mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; }
    else if (format === 'docx') {
      const {renderCoworkDocx}=await import('@/lib/server/cowork/docx-render');
      const {parseMarkdown}=await import('@/lib/cowork/markdown');
      bytes = await renderCoworkDocx(opportunity?.title || report.title,parseMarkdown(opportunityReportMarkdown(report, opportunity, marks)));
      mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    } else if (format === 'md') { bytes = new TextEncoder().encode(opportunityReportMarkdown(report, opportunity, marks)); mime = 'text/markdown'; }
    else {
      const { default: JSZip } = await import('jszip'); const zip = new JSZip();
      zip.file('Informe.pdf', await opportunityReportPdf(report, opportunity, marks)); zip.file('Informe.md', opportunityReportMarkdown(report, opportunity, marks)); zip.file('Requisitos-y-plan.xlsx', await opportunityReportExcel(report));
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
    // An ASCII twin of the name for old clients.
    const name = opportunityExportName(format === 'zip' ? 'Expediente' : 'Informe', opportunity?.title || report.title);
    const ascii = opportunityStorageName(`${name}.x`).replace(/\.x$/, '').replace(/"/g, '');
    return new Response(new Uint8Array(bytes).buffer, { headers: { 'Content-Type': mime, 'Content-Disposition': `attachment; filename="${ascii}.${format}"; filename*=UTF-8''${encodeURIComponent(`${name}.${format}`)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return error instanceof CoworkExportError?opportunitiesJson({error:error.message},error.status):opportunitiesError(error); }
}
