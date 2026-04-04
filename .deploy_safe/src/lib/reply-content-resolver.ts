import { gmailClient } from '@/lib/gmail-client';
import { graphFindReplies, graphGetMessage } from '@/lib/outlook-graph-client';
import { sanitizeReplyHtml } from '@/lib/sanitize-reply-html';
import type { ContactedLead } from '@/lib/types';

export type ResolvedReplyContent = {
  subject: string;
  html: string;
  webLink?: string;
};

function escapeHtml(text: string) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function textToHtml(text: string) {
  const safe = escapeHtml(text || '(Sin contenido)');
  return `<div style="white-space:pre-wrap;line-height:1.55;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">${safe}</div>`;
}

function isHtml(value?: string | null) {
  return /<[a-z][\s\S]*>/i.test(String(value || ''));
}

function pickFallbackText(it: ContactedLead) {
  return String(it.lastReplyText || it.replyPreview || '(Sin contenido de respuesta)').trim();
}

function withSanitizedHtml(payload: ResolvedReplyContent): ResolvedReplyContent {
  return {
    ...payload,
    html: sanitizeReplyHtml(payload.html),
  };
}

export async function resolveReplyContent(it: ContactedLead): Promise<ResolvedReplyContent> {
  const fallbackText = pickFallbackText(it);

  if (it.provider === 'linkedin') {
    return withSanitizedHtml({
      subject: 'Respuesta de LinkedIn',
      html: textToHtml(fallbackText),
      webLink: it.linkedinThreadUrl,
    });
  }

  if (it.provider === 'phone') {
    return withSanitizedHtml({
      subject: it.subject || 'Respuesta telefónica',
      html: textToHtml(fallbackText),
    });
  }

  if (it.provider === 'gmail' && it.threadId) {
    const hits = await gmailClient.findRepliesByThread(it.threadId);
    const best = [...hits].sort(
      (a, b) => Number(b.internalDate || 0) - Number(a.internalDate || 0)
    )[0];

    if (best?.id) {
      const detail = await gmailClient.getMessageById(best.id).catch(() => null);
      const html = detail?.html
        ? detail.html
        : textToHtml(detail?.text || best.snippet || fallbackText);
      return withSanitizedHtml({
        subject: detail?.subject || best.subject || it.replySummary || '(respuesta)',
        html,
        webLink: `https://mail.google.com/mail/u/0/#inbox/${best.id}`,
      });
    }
  }

  const replyId = (it as any).replyMessageId as string | undefined;
  if (replyId) {
    const direct = await graphGetMessage(replyId).catch(() => null);
    if (direct) {
      return withSanitizedHtml({
        subject: direct.subject || '(respuesta)',
        html: isHtml(direct.body?.content)
          ? String(direct.body?.content || '')
          : textToHtml(direct.bodyPreview || fallbackText),
        webLink: direct.webLink,
      });
    }
  }

  if (it.conversationId) {
    const replies = await graphFindReplies({
      conversationId: it.conversationId,
      fromEmail: it.email,
      internetMessageId: it.internetMessageId,
      top: 25,
    }).catch(() => []);

    const best = replies[0];
    if (best?.id) {
      const full = await graphGetMessage(best.id).catch(() => null);
      if (full) {
        return withSanitizedHtml({
          subject: full.subject || best.subject || '(respuesta)',
          html: isHtml(full.body?.content)
            ? String(full.body?.content || '')
            : textToHtml(full.bodyPreview || best.bodyPreview || fallbackText),
          webLink: full.webLink || best.webLink,
        });
      }
      return withSanitizedHtml({
        subject: best.subject || '(respuesta)',
        html: textToHtml(best.bodyPreview || fallbackText),
        webLink: best.webLink,
      });
    }
  }

  return withSanitizedHtml({
    subject: it.replySubject || it.subject || '(respuesta)',
    html: textToHtml(fallbackText),
  });
}
