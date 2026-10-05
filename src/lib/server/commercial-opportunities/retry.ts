/**
 * Waiting and asking again, for the public tender APIs (Plan 10). Mercado Público answers code 10500 when two requests
 * with the same ticket overlap, and Compra Ágil times out or fails with 500 now and then: both work a few seconds later.
 * The wait is injected so the tests never sleep, and `canWait` keeps a retry inside the search's time budget.
 */
export type Wait = (ms: number) => Promise<void>;
export const sleep: Wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function withRetries<T>(work: () => Promise<T>, options: {
  waits: readonly number[]; retryable: (error: unknown) => boolean; wait: Wait; canWait?: (ms: number) => boolean;
}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      const delay = options.waits[attempt];
      if (delay === undefined || !options.retryable(error) || (options.canWait && !options.canWait(delay))) throw error;
      await options.wait(delay);
    }
  }
}
