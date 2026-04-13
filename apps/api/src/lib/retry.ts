export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
}

export class RetryableHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'RetryableHttpError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function isRetryableHttpStatus(status: number): boolean {
  return status === 408
    || status === 425
    || status === 429
    || status >= 500;
}

export function isRetryableNetworkError(error: unknown): boolean {
  if (error instanceof RetryableHttpError) {
    return isRetryableHttpStatus(error.status);
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return false;
  }

  return error instanceof TypeError;
}

export async function withDelayedRetry<T>(
  operation: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 4;
  const initialDelayMs = options?.initialDelayMs ?? 400;
  const backoffFactor = options?.backoffFactor ?? 2;
  const maxDelayMs = options?.maxDelayMs ?? 4_000;
  const shouldRetry = options?.shouldRetry ?? isRetryableNetworkError;

  let delayMs = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !shouldRetry(error)) {
        throw error;
      }

      await sleep(delayMs);
      delayMs = Math.min(maxDelayMs, Math.round(delayMs * backoffFactor));
    }
  }

  throw new Error('Retry loop exited unexpectedly.');
}
