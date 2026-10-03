// Privacy back office: requests in every state, one open incident and the suppression list.
export default function privacy(ctx) {
  const request = (n, type, status, name, email, at) => ({
    id: ctx.uid(9600 + n), request_type: type, status, request_source: 'public_form', requester_name: name, requester_email: email, requester_company: null,
    relation_to_data: 'data_subject', target_email: email, details: type === 'deletion' ? 'Quiero que eliminen mis datos.' : 'Quiero saber qué datos tienen.',
    submitted_at: at, updated_at: at, resolved_at: status === 'completed' ? at : null, reviewed_by_email: status === 'completed' ? ctx.ownerEmail : null,
    last_action_type: null, last_action_at: null, last_action_summary: {}, created_by_user_id: null, metadata: {},
  });
  return {
    tables: {
      privacy_requests: [
        request(1, 'access', 'pending', 'Paula Jiménez', 'paula.jimenez@correo.cl', ctx.daysAgo(1)),
        request(2, 'deletion', 'in_review', 'Rodrigo Ibáñez', 'rodrigo.ibanez@correo.cl', ctx.daysAgo(4)),
        request(3, 'deletion', 'completed', 'Carla Ortiz', 'carla.ortiz@correo.cl', ctx.daysAgo(15)),
      ],
      privacy_incidents: [{ id: ctx.uid(9650), title: 'Exportación compartida por error', severity: 'medium', status: 'investigating', summary: 'Un CSV con 40 contactos se compartió con un correo externo.', affected_scope: '40 contactos', data_types: 'nombre, correo, cargo', incident_at: ctx.daysAgo(3), detected_at: ctx.daysAgo(2), contained_at: null, resolved_at: null, reported_by_email: ctx.ownerEmail, resolution_notes: null, created_at: ctx.daysAgo(2), updated_at: ctx.daysAgo(1), metadata: {} }],
    },
  };
}
