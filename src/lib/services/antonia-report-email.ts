type AntoniaDailyMissionRow = {
  title: string;
  status?: string | null;
  agentLabel?: string | null;
  found: number;
  enriched: number;
  investigated: number;
  contacted: number;
  blocked: number;
  failed: number;
};

type AntoniaDailyDashboardParams = {
  rangeLabel: string;
  generatedAtLabel: string;
  dashboardUrl: string;
  searchRuns: number;
  leadsFound: number;
  leadsEnriched: number;
  leadsInvestigated: number;
  leadsContacted: number;
  replies: number;
  activeMissions: number;
  tasksCompleted: number;
  tasksFailed: number;
  missions: AntoniaDailyMissionRow[];
};

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pct(num: number, den: number) {
  if (!den) return '0%';
  return `${Math.min(100, (num / den) * 100).toFixed(1)}%`;
}

function statusLabel(status?: string | null) {
  if (status === 'active') return 'Activa';
  if (status === 'paused') return 'Pausada';
  if (status === 'completed') return 'Completada';
  return 'Seguimiento';
}

function statusTone(status?: string | null) {
  if (status === 'active') return { bg: '#e0f2fe', fg: '#075985' };
  if (status === 'paused') return { bg: '#fef3c7', fg: '#92400e' };
  if (status === 'completed') return { bg: '#dcfce7', fg: '#166534' };
  return { bg: '#e2e8f0', fg: '#334155' };
}

function healthTone(tasksFailed: number) {
  if (tasksFailed > 3) return { label: 'Atencion', bg: '#fef2f2', border: '#fecaca', fg: '#991b1b' };
  if (tasksFailed > 0) return { label: 'Monitorear', bg: '#fff7ed', border: '#fed7aa', fg: '#9a3412' };
  return { label: 'Operando normal', bg: '#ecfdf5', border: '#bbf7d0', fg: '#166534' };
}

function metricCard(label: string, value: number, accent: string) {
  return `
    <td width="25%" style="padding:6px;vertical-align:top;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:#ffffff;border:1px solid #dbe3ef;border-radius:16px;">
        <tr>
          <td style="padding:16px 16px 14px 16px;">
            <div style="font-family:Arial,sans-serif;font-size:11px;line-height:16px;letter-spacing:0.9px;text-transform:uppercase;color:#64748b;font-weight:700;">${escapeHtml(label)}</div>
            <div style="margin-top:8px;font-family:Arial,sans-serif;font-size:30px;line-height:34px;font-weight:800;color:${accent};">${value}</div>
          </td>
        </tr>
      </table>
    </td>`;
}

function insightList(params: AntoniaDailyDashboardParams) {
  const insights: string[] = [];
  const topMission = [...params.missions].sort((a, b) => {
    const scoreA = a.contacted * 3 + a.enriched * 2 + a.found;
    const scoreB = b.contacted * 3 + b.enriched * 2 + b.found;
    return scoreB - scoreA;
  })[0];
  const attention = params.missions.filter((mission) => mission.blocked + mission.failed > 0).length;

  if (topMission && (topMission.found || topMission.contacted || topMission.enriched)) {
    insights.push(`La mision con mayor actividad fue ${topMission.title}, con ${topMission.contacted} contactos y ${topMission.enriched} leads enriquecidos.`);
  }
  if (params.replies > 0) {
    insights.push(`Se recibieron ${params.replies} respuestas en la ventana analizada. Conviene revisar follow-ups y oportunidades abiertas.`);
  }
  if (attention > 0) {
    insights.push(`${attention} mision(es) registraron bloqueos o fallos y requieren seguimiento operativo.`);
  }
  if (params.leadsFound > params.leadsContacted && params.leadsFound > 0) {
    insights.push(`Todavia hay ${Math.max(0, params.leadsFound - params.leadsContacted)} leads encontrados sin pasar a contacto dentro de esta ventana.`);
  }
  if (insights.length === 0) {
    insights.push('No se detectaron alertas relevantes. La operacion diaria se mantuvo estable durante la ventana analizada.');
  }

  return insights.slice(0, 4)
    .map((item) => `<tr><td style="padding:0 0 10px 0;font-family:Arial,sans-serif;font-size:14px;line-height:21px;color:#334155;">- ${escapeHtml(item)}</td></tr>`)
    .join('');
}

function actionList(params: AntoniaDailyDashboardParams) {
  const actions: string[] = [];
  if (params.tasksFailed > 0) actions.push('Revisar tareas fallidas y relanzar las misiones que quedaron con bloqueo operativo.');
  if (params.replies > 0) actions.push('Priorizar respuestas y reuniones potenciales antes del siguiente envio automatico.');
  if (params.leadsContacted === 0 && params.leadsFound > 0) actions.push('Hay leads encontrados sin contacto. Revisar aprobaciones, deliverability o limites diarios.');
  if (actions.length === 0) actions.push('Mantener el monitoreo diario y revisar solo las misiones con mayor gap comercial.');

  return actions.slice(0, 3)
    .map((item) => `<tr><td style="padding:0 0 10px 0;font-family:Arial,sans-serif;font-size:14px;line-height:21px;color:#334155;">- ${escapeHtml(item)}</td></tr>`)
    .join('');
}

function missionRows(missions: AntoniaDailyMissionRow[]) {
  if (missions.length === 0) {
    return `<tr><td colspan="7" style="padding:16px;font-family:Arial,sans-serif;font-size:13px;line-height:20px;color:#64748b;text-align:center;">No hubo actividad por mision en esta ventana.</td></tr>`;
  }

  return missions.map((mission) => {
    const tone = statusTone(mission.status);
    const alerts = [] as string[];
    if (mission.blocked > 0) alerts.push(`${mission.blocked} bloqueados`);
    if (mission.failed > 0) alerts.push(`${mission.failed} fallidos`);
    const alertText = alerts.length ? alerts.join(' · ') : 'Sin alertas';

    return `
      <tr>
        <td style="padding:14px 12px;border-bottom:1px solid #e2e8f0;vertical-align:top;">
          <div style="font-family:Arial,sans-serif;font-size:14px;line-height:20px;font-weight:700;color:#0f172a;">${escapeHtml(mission.title)}</div>
          <div style="margin-top:4px;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#64748b;">${escapeHtml(mission.agentLabel || 'Sin ejecucion activa')}</div>
        </td>
        <td style="padding:14px 12px;border-bottom:1px solid #e2e8f0;vertical-align:top;text-align:center;">
          <span style="display:inline-block;padding:5px 10px;border-radius:999px;background:${tone.bg};color:${tone.fg};font-family:Arial,sans-serif;font-size:11px;line-height:14px;font-weight:700;">${escapeHtml(statusLabel(mission.status))}</span>
        </td>
        <td style="padding:14px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-family:Arial,sans-serif;font-size:14px;line-height:20px;color:#0f172a;font-weight:700;">${mission.found}</td>
        <td style="padding:14px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-family:Arial,sans-serif;font-size:14px;line-height:20px;color:#0f172a;font-weight:700;">${mission.enriched}</td>
        <td style="padding:14px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-family:Arial,sans-serif;font-size:14px;line-height:20px;color:#0f172a;font-weight:700;">${mission.investigated}</td>
        <td style="padding:14px 12px;border-bottom:1px solid #e2e8f0;text-align:center;font-family:Arial,sans-serif;font-size:14px;line-height:20px;color:#0f172a;font-weight:700;">${mission.contacted}</td>
        <td style="padding:14px 12px;border-bottom:1px solid #e2e8f0;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:${alerts.length ? '#9a3412' : '#166534'};">${escapeHtml(alertText)}</td>
      </tr>`;
  }).join('');
}

export function buildAntoniaDailyDashboardHtml(params: AntoniaDailyDashboardParams) {
  const enrichRate = pct(params.leadsEnriched, params.leadsFound);
  const contactRate = pct(params.leadsContacted, params.leadsFound);
  const replyRate = pct(params.replies, params.leadsContacted);
  const health = healthTone(params.tasksFailed);
  const visibleMissions = [...params.missions].sort((a, b) => {
    const scoreA = a.contacted * 3 + a.enriched * 2 + a.found;
    const scoreB = b.contacted * 3 + b.enriched * 2 + b.found;
    return scoreB - scoreA;
  }).slice(0, 10);

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#eef2f7;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;margin:0;padding:0;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="760" cellpadding="0" cellspacing="0" style="width:760px;max-width:760px;background:#ffffff;border:1px solid #dbe3ef;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="padding:30px 28px;background:linear-gradient(135deg,#102a43 0%,#185a7d 55%,#2d7b68 100%);">
                <div style="font-family:Arial,sans-serif;font-size:12px;line-height:16px;letter-spacing:1px;text-transform:uppercase;color:#c7d2fe;font-weight:700;">ANTON.IA · Dashboard diario</div>
                <div style="margin-top:10px;font-family:Arial,sans-serif;font-size:32px;line-height:36px;font-weight:800;color:#ffffff;">Resumen consolidado de misiones</div>
                <div style="margin-top:10px;font-family:Arial,sans-serif;font-size:14px;line-height:21px;color:#dbeafe;">Ventana analizada: ${escapeHtml(params.rangeLabel)}</div>
                <div style="margin-top:4px;font-family:Arial,sans-serif;font-size:13px;line-height:20px;color:#bfdbfe;">Generado automaticamente: ${escapeHtml(params.generatedAtLabel)}</div>
              </td>
            </tr>

            <tr>
              <td style="padding:18px;background:#f8fafc;border-bottom:1px solid #e2e8f0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    ${metricCard('Busquedas', params.searchRuns, '#0f4c81')}
                    ${metricCard('Leads encontrados', params.leadsFound, '#0f4c81')}
                    ${metricCard('Leads enriquecidos', params.leadsEnriched, '#0f766e')}
                    ${metricCard('Leads contactados', params.leadsContacted, '#b45309')}
                  </tr>
                  <tr>
                    ${metricCard('Investigados', params.leadsInvestigated, '#0f4c81')}
                    ${metricCard('Respuestas', params.replies, '#7c3aed')}
                    ${metricCard('Misiones activas', params.activeMissions, '#1d4ed8')}
                    ${metricCard('Tareas fallidas', params.tasksFailed, params.tasksFailed > 0 ? '#b91c1c' : '#166534')}
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:22px 22px 8px 22px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="58%" style="padding:0 12px 14px 0;vertical-align:top;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #dbe3ef;border-radius:16px;">
                        <tr><td style="padding:18px 18px 12px 18px;font-family:Arial,sans-serif;font-size:17px;line-height:22px;font-weight:800;color:#0f172a;">Embudo comercial</td></tr>
                        <tr>
                          <td style="padding:0 18px 18px 18px;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                              <tr>
                                <td style="padding:0 8px 0 0;vertical-align:top;">
                                  <div style="font-family:Arial,sans-serif;font-size:12px;line-height:16px;color:#64748b;text-transform:uppercase;font-weight:700;">Enriquecimiento</div>
                                  <div style="margin-top:6px;font-family:Arial,sans-serif;font-size:28px;line-height:32px;font-weight:800;color:#0f766e;">${enrichRate}</div>
                                </td>
                                <td style="padding:0 8px;vertical-align:top;">
                                  <div style="font-family:Arial,sans-serif;font-size:12px;line-height:16px;color:#64748b;text-transform:uppercase;font-weight:700;">Contacto</div>
                                  <div style="margin-top:6px;font-family:Arial,sans-serif;font-size:28px;line-height:32px;font-weight:800;color:#b45309;">${contactRate}</div>
                                </td>
                                <td style="padding:0 0 0 8px;vertical-align:top;">
                                  <div style="font-family:Arial,sans-serif;font-size:12px;line-height:16px;color:#64748b;text-transform:uppercase;font-weight:700;">Respuesta</div>
                                  <div style="margin-top:6px;font-family:Arial,sans-serif;font-size:28px;line-height:32px;font-weight:800;color:#7c3aed;">${replyRate}</div>
                                </td>
                              </tr>
                              <tr>
                                <td colspan="3" style="padding-top:16px;font-family:Arial,sans-serif;font-size:13px;line-height:20px;color:#475569;">
                                  De ${params.leadsFound} leads encontrados, ${params.leadsEnriched} llegaron a enriquecimiento, ${params.leadsContacted} avanzaron a contacto y ${params.replies} respondieron en la ventana.
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                    <td width="42%" style="padding:0 0 14px 12px;vertical-align:top;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${health.bg};border:1px solid ${health.border};border-radius:16px;">
                        <tr><td style="padding:18px 18px 10px 18px;font-family:Arial,sans-serif;font-size:17px;line-height:22px;font-weight:800;color:${health.fg};">Salud operativa</td></tr>
                        <tr><td style="padding:0 18px 6px 18px;font-family:Arial,sans-serif;font-size:26px;line-height:30px;font-weight:800;color:${health.fg};">${health.label}</td></tr>
                        <tr><td style="padding:0 18px 18px 18px;font-family:Arial,sans-serif;font-size:13px;line-height:20px;color:${health.fg};">Tareas completadas: <strong>${params.tasksCompleted}</strong> · Tareas fallidas: <strong>${params.tasksFailed}</strong></td></tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:0 22px 10px 22px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td width="50%" style="padding:0 12px 14px 0;vertical-align:top;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #dbe3ef;border-radius:16px;">
                        <tr><td style="padding:18px 18px 10px 18px;font-family:Arial,sans-serif;font-size:17px;line-height:22px;font-weight:800;color:#0f172a;">Lecturas clave</td></tr>
                        <tr><td style="padding:0 18px 12px 18px;">${insightList(params)}</td></tr>
                      </table>
                    </td>
                    <td width="50%" style="padding:0 0 14px 12px;vertical-align:top;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #dbe3ef;border-radius:16px;">
                        <tr><td style="padding:18px 18px 10px 18px;font-family:Arial,sans-serif;font-size:17px;line-height:22px;font-weight:800;color:#0f172a;">Siguiente foco sugerido</td></tr>
                        <tr><td style="padding:0 18px 12px 18px;">${actionList(params)}</td></tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:0 22px 24px 22px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #dbe3ef;border-radius:16px;overflow:hidden;">
                  <tr>
                    <td style="padding:18px;font-family:Arial,sans-serif;font-size:17px;line-height:22px;font-weight:800;color:#0f172a;border-bottom:1px solid #e2e8f0;">Dashboard por mision</td>
                  </tr>
                  <tr>
                    <td style="padding:0;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                        <tr style="background:#f8fafc;">
                          <th align="left" style="padding:12px;font-family:Arial,sans-serif;font-size:11px;line-height:16px;color:#64748b;text-transform:uppercase;letter-spacing:0.7px;border-bottom:1px solid #e2e8f0;">Mision</th>
                          <th align="center" style="padding:12px;font-family:Arial,sans-serif;font-size:11px;line-height:16px;color:#64748b;text-transform:uppercase;letter-spacing:0.7px;border-bottom:1px solid #e2e8f0;">Estado</th>
                          <th align="center" style="padding:12px;font-family:Arial,sans-serif;font-size:11px;line-height:16px;color:#64748b;text-transform:uppercase;letter-spacing:0.7px;border-bottom:1px solid #e2e8f0;">Found</th>
                          <th align="center" style="padding:12px;font-family:Arial,sans-serif;font-size:11px;line-height:16px;color:#64748b;text-transform:uppercase;letter-spacing:0.7px;border-bottom:1px solid #e2e8f0;">Enriq.</th>
                          <th align="center" style="padding:12px;font-family:Arial,sans-serif;font-size:11px;line-height:16px;color:#64748b;text-transform:uppercase;letter-spacing:0.7px;border-bottom:1px solid #e2e8f0;">Invest.</th>
                          <th align="center" style="padding:12px;font-family:Arial,sans-serif;font-size:11px;line-height:16px;color:#64748b;text-transform:uppercase;letter-spacing:0.7px;border-bottom:1px solid #e2e8f0;">Contact.</th>
                          <th align="left" style="padding:12px;font-family:Arial,sans-serif;font-size:11px;line-height:16px;color:#64748b;text-transform:uppercase;letter-spacing:0.7px;border-bottom:1px solid #e2e8f0;">Alertas</th>
                        </tr>
                        ${missionRows(visibleMissions)}
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:18px 24px;background:#0f172a;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#cbd5e1;text-align:center;">
                Reporte automatico de ANTON.IA · <a href="${escapeHtml(params.dashboardUrl)}" style="color:#ffffff;text-decoration:none;">Abrir dashboard</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export type { AntoniaDailyDashboardParams, AntoniaDailyMissionRow };
