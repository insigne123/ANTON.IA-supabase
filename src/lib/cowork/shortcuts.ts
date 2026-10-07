/**
 * Cowork's keyboard shortcuts, the ones any AI chat has (Plan 13): a new conversation, searching the conversations and the list
 * of shortcuts. On a Mac they use ⌘ only, so Ctrl+K keeps deleting to the end of the line in a text field; elsewhere, Ctrl.
 * Shift+Esc (the composer in ChatGPT) is left out: Chrome keeps it for its task manager.
 */
export type CoworkShortcutAction = 'new' | 'search' | 'help';

export type CoworkKeyPress = { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; isComposing?: boolean };

export const COWORK_SHORTCUTS: ReadonlyArray<{ action: CoworkShortcutAction; label: string; keys: (mac: boolean) => string[] }> = [
  { action: 'new', label: 'Nueva conversación', keys: mac => [mac ? '⌘' : 'Ctrl', mac ? '⇧' : 'Shift', 'O'] },
  { action: 'search', label: 'Buscar conversaciones', keys: mac => [mac ? '⌘' : 'Ctrl', 'K'] },
  { action: 'help', label: 'Ver los atajos de teclado', keys: mac => [mac ? '⌘' : 'Ctrl', '/'] },
];

/** The composer's own keys, in the same list so they are found. */
export const COWORK_COMPOSER_KEYS: ReadonlyArray<{ label: string; keys: string[] }> = [
  { label: 'Enviar el mensaje', keys: ['Enter'] },
  { label: 'Nueva línea', keys: ['Shift', 'Enter'] },
  { label: 'Nombrar a un contacto guardado', keys: ['@'] },
  { label: 'Usar una plantilla', keys: ['/'] },
];

export function coworkIsMac(platform: string | null | undefined): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform || '');
}

/** Which shortcut a key press is, or null. */
export function coworkShortcut(event: CoworkKeyPress, mac: boolean): CoworkShortcutAction | null {
  if (event.isComposing || event.altKey) return null;
  const modifier = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!modifier) return null;
  const key = event.key.toLowerCase();
  if (event.shiftKey && (key === 'o' || event.code === 'KeyO')) return 'new';
  if (!event.shiftKey && (key === 'k' || event.code === 'KeyK')) return 'search';
  if (!event.shiftKey && (key === '/' || event.code === 'Slash')) return 'help';
  return null;
}

/** What already does something with the keys typed on it: a field, a button, a link, a menu, a list of options… */
export const COWORK_KEY_HANDLERS = 'input, textarea, select, button, a[href], [contenteditable=""], [contenteditable="true"], [role="button"], [role="link"], '
  + '[role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="slider"], [role="textbox"], '
  + '[role="combobox"], [role="listbox"], [role="menu"], [role="grid"], [role="tree"]';

/**
 * A letter or digit typed where it does nothing goes to the composer, as in ChatGPT: start typing and the message starts. Not
 * from a field, a button, a link or a menu (focusHandlesKeys: the key already means something there; the page or a region with
 * focus, like the main content, does not), and with no modifier but Shift.
 */
export function coworkTypesIntoComposer(event: CoworkKeyPress, focusHandlesKeys: boolean): boolean {
  if (event.isComposing || event.altKey || event.metaKey || event.ctrlKey || focusHandlesKeys) return false;
  return event.key.length === 1 && /[\p{L}\p{N}¿¡]/u.test(event.key);
}
