const HARD_NEGATIVE_PATTERN =
  /\b(no\s+estoy\s+interesad[oa]|no\s+me\s+interesa|no\s+gracias|no,\s*gracias|no\s+deseo|no\s+quiero|no\s+por\s+ahora|no\s+seguimos|no\s+continuar|no\s+contactarme|no\s+nos\s+contacten|no\s+me\s+contacten|not\s+interested|do\s+not\s+contact)\b/i;

export function isHardNegativeReply(text: string): boolean {
  return HARD_NEGATIVE_PATTERN.test(String(text || '').trim());
}
