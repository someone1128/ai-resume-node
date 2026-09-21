export class HttpClientError extends Error {
  readonly status: number | undefined;
  readonly responseBody: unknown;

  constructor(message: string, options: { status?: number; responseBody?: unknown } = {}) {
    super(message);
    this.name = 'HttpClientError';
    this.status = options.status;
    this.responseBody = options.responseBody;
  }
}

export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const upstream = init.signal;
  const abortUpstream = () => controller.abort();
  upstream?.addEventListener('abort', abortUpstream, { once: true });
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new HttpClientError('外部请求超时');
    }
    throw new HttpClientError('外部请求失败');
  } finally {
    clearTimeout(timeout);
    upstream?.removeEventListener('abort', abortUpstream);
  }
}

export async function fetchJson<T>(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs: number,
): Promise<T> {
  const response = await fetchWithTimeout(input, init, timeoutMs);
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new HttpClientError('外部响应不是有效 JSON', { status: response.status });
  }
  if (!response.ok) {
    throw new HttpClientError('外部请求返回错误状态', {
      status: response.status,
      responseBody: body,
    });
  }
  return body as T;
}
