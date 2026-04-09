type FetchLike = typeof fetch;

export type RequestJsonOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  fetchImpl?: FetchLike;
  baseUrl?: string;
};

export class AadmRequestError extends Error {
  status: number;
  data: unknown;

  constructor(status: number, data: unknown) {
    super(`request_failed:${status}`);
    this.status = status;
    this.data = data;
  }
}

export function managerBaseUrl() {
  return process.env.AADM_URL ?? 'http://127.0.0.1:8899';
}

export async function requestJson<T>(
  path: string,
  options: RequestJsonOptions = {}
): Promise<T> {
  const {
    method,
    headers = {},
    body,
    fetchImpl = fetch,
    baseUrl = managerBaseUrl()
  } = options;

  const requestHeaders = { ...headers };
  const token = process.env.AADM_AUTH_TOKEN;
  if (token) {
    requestHeaders.Authorization = `Bearer ${token}`;
  }

  if (body !== undefined) {
    requestHeaders['content-type'] = 'application/json';
  }

  const response = await fetchImpl(`${baseUrl}${path}`, {
    method,
    headers: requestHeaders,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });

  const text = await response.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // leave text response as-is
  }

  if (!response.ok) {
    throw new AadmRequestError(response.status, data);
  }

  return data as T;
}
