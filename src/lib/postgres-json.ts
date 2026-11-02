/**
 * Postgres stores no NUL character in text or json: one `\u0000` anywhere in a value refuses the whole write with 22P05
 * («unsupported Unicode escape sequence»). Text from outside can carry one: a LinkedIn post did, and GrupoExpro's daily posts
 * search failed on it from 26 Oct 2026 (plan de uso A6). So it is taken out, from every string and key, before such a value
 * is stored. Anything that is not a string, an array or a plain object is left as it is.
 */
export function withoutNul<T>(value: T): T {
  if (typeof value === 'string') return (value.includes('\u0000') ? value.replace(/\u0000/g, '') : value) as T;
  if (Array.isArray(value)) return value.map(item => withoutNul(item)) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [withoutNul(key), withoutNul(item)])) as T;
  }
  return value;
}
