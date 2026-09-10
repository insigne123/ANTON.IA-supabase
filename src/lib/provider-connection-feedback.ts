export function providerConnectionError(code: string): string {
  switch (code) {
    case 'session_expired': return 'Vuelve a iniciar sesion en ANTON.IA antes de conectar tu correo.';
    case 'configuration_missing': return 'La conexion no esta configurada. Contacta al administrador.';
    case 'consent_denied': return 'Cancelaste la conexion o el proveedor no autorizo los permisos.';
    case 'invalid_state': return 'La solicitud vencio o no corresponde a esta sesion. Inicia la conexion nuevamente.';
    case 'missing_permissions': return 'Autoriza los permisos de envio y lectura para conectar tu correo.';
    case 'no_refresh_token': return 'No recibimos permiso para automatizacion. Reconecta y autoriza el acceso solicitado.';
    default: return 'No pudimos completar la conexion. Intenta nuevamente; si persiste, contacta al administrador.';
  }
}
