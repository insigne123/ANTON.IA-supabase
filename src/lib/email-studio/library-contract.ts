export type EmailLibraryScope = 'personal' | 'team';

export function canPublishEmailTemplates(role: unknown) {
  return role === 'owner' || role === 'admin';
}

export function emailLibraryError(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  const messages: Record<string, string> = {
    EMAIL_STYLE_REVISION_CONFLICT: 'Esta plantilla cambio en otra sesion. Recarga la biblioteca antes de guardar; tus cambios siguen aqui.',
    EMAIL_STYLE_NAME_CONFLICT: 'Ya existe una plantilla con ese nombre en este espacio. Elige otro nombre.',
    EMAIL_STYLE_FORBIDDEN: 'No tienes permiso para publicar o modificar plantillas del equipo.',
    EMAIL_STYLE_NOT_FOUND: 'La plantilla ya no esta disponible. Recarga la biblioteca.',
    EMAIL_STYLE_INVALID_REQUEST: 'Revisa los campos y confirma la publicacion si elegiste Equipo.',
  };
  return messages[code] || 'No pudimos completar la accion. Tus cambios se conservan; vuelve a intentarlo.';
}

export function emailStyleDraftKey(name: string, profile: unknown, isDefault: boolean, libraryScope: EmailLibraryScope) {
  return JSON.stringify({ name, profile, isDefault, libraryScope });
}
