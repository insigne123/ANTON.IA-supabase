const HARD_NEGATIVE_PATTERN =
  /\b(no\s+estoy\s+interesad[oa]|no\s+me\s+interesa|no\s+gracias|no,\s*gracias|no\s+deseo|no\s+quiero|no\s+por\s+ahora|no\s+seguimos|no\s+continuar|no\s+contactarme|no\s+nos\s+contacten|no\s+me\s+contacten|ya\s+no\s+trabaj[oa]\s+en|ya\s+no\s+estoy\s+en|no\s+trabaj[oa]\s+en|left\s+the\s+company|no\s+longer\s+with|no\s+longer\s+work|not\s+interested|do\s+not\s+contact)\b/i;

export function isHardNegativeReply(text: string): boolean {
  return HARD_NEGATIVE_PATTERN.test(String(text || '').trim());
}
