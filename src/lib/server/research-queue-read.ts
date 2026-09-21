/** Retry only read-only queue discovery. Never wrap claims, processing or provider calls. */
export async function readResearchQueue<T>(
  stage: string,
  read: () => PromiseLike<{ data: T; error: unknown }>,
  sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<{ data: T; error: null }> {
  for (let attempt = 0; ; attempt++) {
    let result;
    try { result = await read(); }
    catch (error) { result = { data: undefined, error }; }
    if (!result.error) return { data: result.data as T, error: null };
    const error = result.error as { message?: string; code?: string };
    const message = error?.message || String(result.error);
    const transient = /gateway timeout|bad gateway|service unavailable|fetch failed|ECONNRESET|ETIMEDOUT|timeout|timed out|temporar|connection (reset|refused|closed)|network|502|503|504/i.test(message);
    if (!transient || attempt >= 2) {
      throw new Error(`Research queue read failed (${stage}): ${message}`, { cause: result.error });
    }
    await sleep(250 * (attempt + 1));
  }
}
