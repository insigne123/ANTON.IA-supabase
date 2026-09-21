// Single authorized workspace channel. Legacy SEND_DM requests are deliberately rejected.
function isAllowedAppUrl(value) {
  try {
    return ['https://app.antonia.ai', 'https://studio--leadflowai-3yjcy.us-central1.hosted.app',
      'http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:9003', 'http://127.0.0.1:9003'].includes(new URL(value).origin);
  } catch { return false; }
}
chrome.runtime.onMessage.addListener((request, _sender, respond) => {
  if (request?.action !== 'SEND_DM') return false;
  respond({ success: false, error: 'Envía desde Contactar en el panel de Anton.IA, con tu cuenta conectada.' });
  return false;
});
importScripts('prospecting-background.js');
