import { NextRequest, NextResponse } from 'next/server';

import { handleAuthError, requireAuth } from '@/lib/server/auth-utils';
import { insertSupliaArtifacts } from '@/lib/server/suplia-artifacts';
import { getSupabaseAdminClient } from '@/lib/server/supabase-admin';
import { completeSupliaApprovalStep, createSupliaJobFromMessage, runSupliaJob } from '@/lib/server/suplia-job-runner';
import { getSupliaState } from '@/lib/server/suplia-orchestrator';
import { runSupliaTool } from '@/lib/server/suplia-tool-runner';
import { isSupliaRuntimeError } from '@/lib/suplia/runtime';
import { buildSupliaApprovedActionPayload, validateSupliaStrongConfirmation } from '@/lib/suplia/approval-guards';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SUPPORTED_ACTION_TOOLS = new Set([
  'workflow.approve_plan',
  'email.send',
  'prospecting.search_companies',
  'prospecting.search_people',
  'gmail.search_messages',
  'gmail.get_message',
  'gmail.get_thread',
  'gmail.search_threads',
  'gmail.find_contacted_leads',
  'lead.enrich',
  'lead.enrich_batch',
  'campaign.create_draft',
  'campaign.update',
  'campaign.launch',
  'campaign.pause',
  'campaign.resume',
  'email.bulk_send',
  'crm.update_stage',
  'crm.set_next_action',
  'crm.add_note',
  'crm.assign_owner',
  'followup.create_tasks',
  'thread.reply_send',
  'playbook.create',
  'playbook.update',
  'playbook.archive',
  'playbook.apply',
  'memory.save',
  'memory.forget',
  'antonia.create_mission',
]);

function formatCompanyShortlist(result: any) {
  const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
  if (candidates.length === 0) return 'Sin empresas encontradas con ese criterio.';

  return candidates.slice(0, 12).map((candidate: any, index: number) => {
    const domain = candidate.primary_domain || candidate.website_url || '';
    const score = typeof candidate.score === 'number' ? ` - match ${Math.round(candidate.score * 100)}%` : '';
    return `${index + 1}. ${candidate.name || 'Empresa'}${domain ? ` - ${domain}` : ''}${score}`;
  }).join('\n');
}

function formatPeopleShortlist(result: any) {
  const leads = Array.isArray(result?.leads) ? result.leads : [];
  if (leads.length === 0) return 'Sin personas encontradas con ese criterio.';

  return leads.slice(0, 15).map((lead: any, index: number) => {
    const role = lead.title ? ` - ${lead.title}` : '';
    const company = lead.companyName ? ` en ${lead.companyName}` : '';
    const email = lead.email ? ` - ${lead.email}` : lead.lockedEmail ? ' - email bloqueado' : '';
    return `${index + 1}. ${lead.fullName || 'Contacto'}${role}${company}${email}`;
  }).join('\n');
}

function formatGmailContactList(result: any) {
  const contacts = Array.isArray(result?.contacts) ? result.contacts : [];
  if (result?.artifactContent) return String(result.artifactContent);
  if (contacts.length === 0) return 'Sin contactos encontrados con ese criterio.';

  return contacts.slice(0, 20).map((contact: any, index: number) => {
    const company = contact.company ? ` - ${contact.company}` : '';
    const status = contact.crmStatus ? ` - CRM: ${contact.crmStatus}` : contact.matchedLeadId || contact.matchedContactedId ? ' - match interno' : ' - sin match CRM';
    const date = contact.lastContactedAt ? ` - ${contact.lastContactedAt}` : '';
    return `${index + 1}. ${contact.name || contact.email || 'Contacto'} <${contact.email || 'sin email'}>${company}${status}${date}\n${contact.lastSubject || 'Sin asunto'}`;
  }).join('\n\n');
}

function successMessage(toolName: string, result: any) {
  if (toolName === 'email.send') {
    return `Listo. Envie el email a ${result.to} por ${result.provider}. Quedo registrado en Contactados.`;
  }
  if (toolName === 'prospecting.search_companies') {
    const count = Array.isArray(result?.candidates) ? result.candidates.length : 0;
    return `Listo. Encontre ${count} empresa${count === 1 ? '' : 's'} con ${result?.providerUsed || 'el proveedor seleccionado'}. Deje la shortlist como artifact.`;
  }
  if (toolName === 'prospecting.search_people') {
    const count = Array.isArray(result?.leads) ? result.leads.length : 0;
    return `Listo. Encontre ${count} contacto${count === 1 ? '' : 's'} con ${result?.providerUsed || 'el proveedor seleccionado'}. Deje la shortlist como artifact.`;
  }
  if (toolName === 'gmail.find_contacted_leads') {
    const count = Array.isArray(result?.contacts) ? result.contacts.length : 0;
    return `Listo. Encontre ${count} contacto${count === 1 ? '' : 's'} relacionado${count === 1 ? '' : 's'} con ${result?.topic || 'la busqueda'} en Gmail. No envie nada ni modifique CRM.`;
  }
  if (toolName === 'gmail.search_messages') return `Listo. Busque en Gmail y recupere ${result?.resultCount || 0} mensaje${result?.resultCount === 1 ? '' : 's'}. No envie nada.`;
  if (toolName === 'gmail.search_threads') return `Listo. Busque en Gmail y agrupe ${result?.threadCount || 0} hilo${result?.threadCount === 1 ? '' : 's'}. No envie nada.`;
  if (toolName === 'gmail.get_message') return 'Listo. Recupere el mensaje de Gmail aprobado. No envie nada.';
  if (toolName === 'gmail.get_thread') return 'Listo. Recupere el hilo de Gmail aprobado. No envie nada.';
  if (toolName === 'lead.enrich' || toolName === 'lead.enrich_batch') {
    const summary = result?.summary || {};
    return `Listo. Enrichment completado: ${summary.completed || 0} enriquecido${summary.completed === 1 ? '' : 's'}, ${summary.failed || 0} fallido${summary.failed === 1 ? '' : 's'}.`;
  }
  if (toolName === 'campaign.create_draft') {
    return `Listo. Guarde la campana "${result.name}" como borrador pausado con ${result.stepsCount || 0} paso${result.stepsCount === 1 ? '' : 's'}.`;
  }
  if (toolName === 'campaign.update') return `Listo. Actualice la campana "${result?.campaign?.name || result?.campaign?.id || ''}". No se lanzaron envios.`;
  if (toolName === 'campaign.launch') return `Listo. Active la campana "${result?.campaign?.name || result?.campaign?.id || ''}". El cron procesara envios segun guardrails.`;
  if (toolName === 'campaign.pause') return `Listo. Pause la campana "${result?.campaign?.name || result?.campaign?.id || ''}".`;
  if (toolName === 'campaign.resume') return `Listo. Reanude la campana "${result?.campaign?.name || result?.campaign?.id || ''}". El cron procesara envios segun guardrails.`;
  if (toolName === 'email.bulk_send') {
    const summary = result?.summary || {};
    return result?.dryRun
      ? `Listo. Prepare un dry-run de bulk send para ${summary.requested || 0} mensaje${summary.requested === 1 ? '' : 's'}. No se envio nada.`
      : `Listo. Bulk send ejecutado: ${summary.sent || 0} enviado${summary.sent === 1 ? '' : 's'}, ${summary.failed || 0} fallido${summary.failed === 1 ? '' : 's'}.`;
  }
  if (toolName === 'crm.update_stage') return `Listo. Actualice ${result.updatedCount || 0} lead${result.updatedCount === 1 ? '' : 's'} a ${result.stage}.`;
  if (toolName === 'crm.set_next_action') return `Listo. Registre la proxima accion en ${result.updatedCount || 0} lead${result.updatedCount === 1 ? '' : 's'}.`;
  if (toolName === 'crm.add_note') return `Listo. Agregue la nota en ${result.updatedCount || 0} lead${result.updatedCount === 1 ? '' : 's'}.`;
  if (toolName === 'crm.assign_owner') return `Listo. Asigne owner en ${result.updatedCount || 0} lead${result.updatedCount === 1 ? '' : 's'}.`;
  if (toolName === 'followup.create_tasks') return `Listo. Cree ${result.count || 0} tarea${result.count === 1 ? '' : 's'} de seguimiento.`;
  if (toolName === 'thread.reply_send') return `Listo. Envie la respuesta a ${result.to || 'el destinatario'} por ${result.provider || 'el proveedor disponible'}.`;
  if (toolName === 'playbook.create') return `Listo. Cree el playbook "${result?.playbook?.name || result?.playbook?.id || ''}".`;
  if (toolName === 'playbook.update') return `Listo. Actualice el playbook "${result?.playbook?.name || result?.playbook?.id || ''}".`;
  if (toolName === 'playbook.archive') return `Listo. Archive el playbook "${result?.playbook?.name || result?.playbook?.id || ''}".`;
  if (toolName === 'playbook.apply') return `Listo. Cree un job desde el playbook con ${result?.stepsCount || 0} step${result?.stepsCount === 1 ? '' : 's'}.`;
  if (toolName === 'memory.save') return `Listo. Guarde la memoria "${result?.memory?.key || result?.memory?.id || ''}" para futuras decisiones.`;
  if (toolName === 'memory.forget') return `Listo. Archive la memoria "${result?.memory?.key || result?.memory?.id || ''}".`;
  if (toolName === 'antonia.create_mission') return `Listo. Cree la mision "${result?.mission?.title || 'ANTONIA'}" pausada.`;
  return 'Listo. La accion aprobada fue ejecutada.';
}

function artifactForResult(toolName: string, result: any) {
  if (toolName === 'email.send') {
    return {
      type: 'note',
      title: 'Email enviado',
      content: `Para: ${result.to}\nAsunto: ${result.subject}\nProveedor: ${result.provider}`,
      data: result,
    };
  }
  if (toolName === 'prospecting.search_companies') {
    const count = Array.isArray(result?.candidates) ? result.candidates.length : 0;
    return {
      type: 'company_shortlist',
      title: `Empresas encontradas (${count})`,
      content: formatCompanyShortlist(result),
      data: result,
    };
  }
  if (toolName === 'prospecting.search_people') {
    const count = Array.isArray(result?.leads) ? result.leads.length : 0;
    return {
      type: 'person_shortlist',
      title: `Contactos encontrados (${count})`,
      content: formatPeopleShortlist(result),
      data: result,
    };
  }
  if (toolName === 'gmail.find_contacted_leads') {
    const count = Array.isArray(result?.contacts) ? result.contacts.length : 0;
    return {
      type: 'mailbox_contact_list',
      title: `Contactos Gmail encontrados (${count})`,
      content: formatGmailContactList(result),
      data: result,
    };
  }
  if (toolName === 'gmail.search_messages' || toolName === 'gmail.search_threads' || toolName === 'gmail.get_message' || toolName === 'gmail.get_thread') {
    return {
      type: toolName === 'gmail.get_thread' || toolName === 'gmail.search_threads' ? 'gmail_thread_summary' : 'mailbox_search',
      title: 'Lectura Gmail aprobada',
      content: JSON.stringify(result, null, 2).slice(0, 4000),
      data: result,
    };
  }
  if (toolName === 'lead.enrich' || toolName === 'lead.enrich_batch') {
    const items = Array.isArray(result?.items) ? result.items : result?.lead ? [result.lead] : [];
    return {
      type: 'lead_list',
      title: `Leads enriquecidos (${items.length})`,
      content: items.slice(0, 12).map((lead: any, index: number) => `${index + 1}. ${lead.fullName || lead.name || 'Lead'}${lead.companyName ? ` - ${lead.companyName}` : ''}${lead.email ? ` - ${lead.email}` : ''} (${lead.enrichmentStatus || 'sin estado'})`).join('\n') || 'Sin leads enriquecidos.',
      data: result,
    };
  }
  if (toolName === 'campaign.create_draft') {
    return {
      type: 'campaign_preview',
      title: `Campana guardada: ${result.name}`,
      content: Array.isArray(result.steps)
        ? result.steps.map((step: any, index: number) => `${index + 1}. ${step.name || 'Paso'} (${step.offsetDays || 0} dias)\nAsunto: ${step.subject}`).join('\n\n')
        : 'Campana guardada como borrador pausado.',
      data: result,
    };
  }
  if (toolName === 'campaign.update' || toolName === 'campaign.launch' || toolName === 'campaign.pause' || toolName === 'campaign.resume') {
    return {
      type: 'campaign_preview',
      title: `Campana: ${result?.campaign?.name || result?.campaign?.id || 'actualizada'}`,
      content: `Estado: ${result?.campaign?.status || 'sin estado'}\n${result?.note || ''}`.trim(),
      data: result,
    };
  }
  if (toolName === 'email.bulk_send') {
    const summary = result?.summary || {};
    return {
      type: 'risk_report',
      title: result?.dryRun ? 'Dry-run bulk send' : 'Bulk send ejecutado',
      content: `Solicitados: ${summary.requested || 0}\nEnviados: ${summary.sent || 0}\nFallidos: ${summary.failed || 0}`,
      data: result,
    };
  }
  if (toolName === 'crm.update_stage' || toolName === 'crm.set_next_action' || toolName === 'crm.add_note' || toolName === 'crm.assign_owner' || toolName === 'followup.create_tasks') {
    return {
      type: 'crm_summary',
      title: 'CRM actualizado',
      content: JSON.stringify(result, null, 2),
      data: result,
    };
  }
  if (toolName === 'thread.reply_send') {
    return {
      type: 'thread_reply_draft',
      title: 'Respuesta enviada',
      content: `Para: ${result.to || 'sin destinatario'}\nAsunto: ${result.subject || 'sin asunto'}\nProveedor: ${result.provider || 'sin proveedor'}`,
      data: result,
    };
  }
  if (toolName === 'memory.save' || toolName === 'memory.forget') {
    return {
      type: 'note',
      title: toolName === 'memory.save' ? 'Memoria guardada' : 'Memoria archivada',
      content: `${result?.memory?.key || result?.memory?.id || 'Memoria'}\nEstado: ${result?.memory?.status || 'actualizada'}`,
      data: result,
    };
  }
  if (toolName.startsWith('playbook.')) {
    return {
      type: 'note',
      title: toolName === 'playbook.apply' ? 'Job creado desde playbook' : 'Playbook actualizado',
      content: JSON.stringify(result, null, 2),
      data: result,
    };
  }
  if (toolName === 'antonia.create_mission') {
    return {
      type: 'mission_draft',
      title: `Mision creada: ${result?.mission?.title || 'ANTONIA'}`,
      content: result?.mission?.goal_summary || 'Mision creada pausada.',
      data: result,
    };
  }
  return null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ actionId: string }> }) {
  try {
    const auth = await requireAuth();
    const { actionId } = await params;
    const admin = getSupabaseAdminClient();
    const body = await req.json().catch(() => ({}));

    const { data: action, error: actionError } = await admin
      .from('suplia_pending_actions')
      .select('*')
      .eq('id', actionId)
      .eq('organization_id', auth.organizationId)
      .maybeSingle();

    if (actionError) throw actionError;
    if (!action) return NextResponse.json({ error: 'Accion no encontrada' }, { status: 404 });
    if (action.status !== 'pending') return NextResponse.json({ error: 'La accion ya no esta pendiente' }, { status: 409 });

    const toolName = action.tool_name || action.action_type;
    if (!SUPPORTED_ACTION_TOOLS.has(toolName)) {
      return NextResponse.json({ error: `Accion no soportada en esta version: ${toolName}` }, { status: 400 });
    }

    const confirmation = validateSupliaStrongConfirmation({
      approvalKind: action.approval_kind,
      toolName,
      payload: action.payload || {},
      confirmationText: body?.confirmationText,
    });
    if (!confirmation.valid) {
      return NextResponse.json({ error: `Esta accion requiere confirmacion fuerte: escribe ${confirmation.requiredText}.` }, { status: 400 });
    }

    const actionPayload = buildSupliaApprovedActionPayload({
      toolName,
      payload: action.payload || {},
      requiredText: confirmation.requiredText,
    });

    const now = new Date().toISOString();
    await admin
      .from('suplia_pending_actions')
      .update({ status: 'approved', approved_by: auth.user.id, approved_at: now, updated_at: now })
      .eq('id', action.id);

    if (toolName === 'workflow.approve_plan') {
      const result: Record<string, unknown> = {
        approved: true,
        approvedAt: now,
        plan: action.payload || {},
      };
      let approvedJobId = action.job_id || null;

      if (!approvedJobId) {
        const goal = String((action.payload || {}).goal || (action.payload || {}).originalMessage || action.title || '').trim();
        const job = await createSupliaJobFromMessage(auth, {
          conversationId: action.conversation_id,
          message: goal || 'Continuar plan aprobado de SUPL.IA',
          skipPlanApproval: true,
          approvedPlan: action.payload || {},
          sourceActionId: action.id,
        });
        approvedJobId = job.id;
        result.jobId = job.id;
      }

      await admin.from('suplia_messages').insert({
        conversation_id: action.conversation_id,
        organization_id: auth.organizationId,
        user_id: auth.user.id,
        role: 'assistant',
        content: 'Plan aprobado. Ahora continuo con ICP y criterios de busqueda. No voy a consumir creditos externos hasta pedirte otra aprobacion.',
        metadata: {
          actionId: action.id,
          result,
          generatedBy: 'suplia-plan-approval',
          parts: [
            { type: 'text', text: 'Plan aprobado. Ahora continuo con ICP y criterios de busqueda. No voy a consumir creditos externos hasta pedirte otra aprobacion.' },
            { type: 'job-progress', jobId: approvedJobId, status: 'queued', label: 'Plan aprobado' },
          ],
        },
      });

      if (action.job_id) {
        await completeSupliaApprovalStep(auth, {
          jobId: action.job_id || null,
          stepId: action.step_id || null,
          actionId: action.id,
          actionType: toolName,
          result,
        });
      } else if (approvedJobId) {
        await runSupliaJob(auth, approvedJobId, { maxSteps: 3 });
      }

      const executedAt = new Date().toISOString();
      await admin
        .from('suplia_pending_actions')
        .update({ status: 'executed', result, executed_at: executedAt, updated_at: executedAt })
        .eq('id', action.id);

      const state = await getSupliaState(auth, action.conversation_id);
      return NextResponse.json({ ...state, toast: 'Plan aprobado' });
    }

    try {
      const { output } = await runSupliaTool({
        auth,
        conversationId: action.conversation_id,
        jobId: action.job_id || null,
        stepId: action.step_id || null,
        pendingActionId: action.id,
        existingToolRunId: action.tool_run_id || null,
        toolName,
        input: actionPayload,
        approvedBy: auth.user.id,
      });
      const result = output as any;

      await completeSupliaApprovalStep(auth, {
        jobId: action.job_id || null,
        stepId: action.step_id || null,
        actionId: action.id,
        actionType: toolName,
        result,
      });

      const executedAt = new Date().toISOString();
      await admin
        .from('suplia_pending_actions')
        .update({ status: 'executed', result, executed_at: executedAt, updated_at: executedAt })
        .eq('id', action.id);

      await admin.from('suplia_messages').insert({
        conversation_id: action.conversation_id,
        organization_id: auth.organizationId,
        user_id: auth.user.id,
        role: 'assistant',
        content: successMessage(toolName, result),
        metadata: { actionId: action.id, result },
      });

      const artifact = artifactForResult(toolName, result);
      if (artifact) {
        await insertSupliaArtifacts(auth, [{
          conversationId: action.conversation_id,
          jobId: action.job_id || null,
          sourceMessageId: null,
          changeSummary: `Resultado de accion aprobada: ${toolName}`,
          ...artifact,
        }]);
      }

      const state = await getSupliaState(auth, action.conversation_id);
      return NextResponse.json({ ...state, toast: successMessage(toolName, result) });
    } catch (error: any) {
      const failedAt = new Date().toISOString();
      const deferred = isSupliaRuntimeError(error, 'deferred');
      await admin
        .from('suplia_pending_actions')
        .update({ status: deferred ? 'pending' : 'failed', error_message: error?.message || 'Error ejecutando accion', updated_at: failedAt })
        .eq('id', action.id);

      await admin.from('suplia_messages').insert({
        conversation_id: action.conversation_id,
        organization_id: auth.organizationId,
        user_id: auth.user.id,
        role: 'assistant',
        content: deferred ? `La accion quedo reprogramada: ${error?.message || 'proveedor ocupado'}` : `No pude ejecutar la accion: ${error?.message || 'error desconocido'}`,
        metadata: { actionId: action.id, failed: !deferred, deferred },
      });

      const state = await getSupliaState(auth, action.conversation_id);
      return NextResponse.json({ ...state, error: error?.message || 'Error ejecutando accion' }, { status: deferred ? 202 : 500 });
    }
  } catch (error: any) {
    if (error?.name === 'AuthError') return handleAuthError(error);
    console.error('[SUPLIA/action approve] error:', error);
    return NextResponse.json({ error: error?.message || 'No se pudo aprobar la accion' }, { status: 500 });
  }
}
