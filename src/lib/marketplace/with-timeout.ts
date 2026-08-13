/**
 * Reject a promise that takes too long.
 *
 * Needed because `ClientSDK.init` gives up after five handshake attempts but
 * leaves its promise pending rather than rejecting. Without a deadline of our
 * own the panel shows "Connecting to Pages…" forever for anyone who opens the
 * deployment URL outside the Pages iframe — observed, not theorised.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
