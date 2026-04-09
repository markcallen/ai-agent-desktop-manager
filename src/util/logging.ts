import crypto from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';

const REDACTED = '[REDACTED]';
const REQUEST_ID_HEADER = 'x-request-id';

function redactSensitiveQueryParams(url: string) {
  try {
    const parsed = new URL(url, 'http://localhost');
    for (const key of ['token', 'access_token']) {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, REDACTED);
      }
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url.replace(/([?&](?:token|access_token)=)[^&]+/gi, `$1${REDACTED}`);
  }
}

function sanitizeHeaders(
  headers: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!headers) return undefined;

  const sanitized = { ...headers };
  for (const key of [
    'authorization',
    'cookie',
    'set-cookie',
    'x-orchestrator-token'
  ]) {
    if (key in sanitized) {
      sanitized[key] = REDACTED;
    }
  }

  return sanitized;
}

export function buildLoggerOptions(stream?: NodeJS.WritableStream) {
  return {
    level: 'info',
    ...(stream ? { stream } : {}),
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["set-cookie"]',
        'res.headers["set-cookie"]'
      ],
      censor: REDACTED
    },
    serializers: {
      req(request: {
        method?: string;
        url?: string;
        headers?: Record<string, unknown>;
        id?: string;
      }) {
        return {
          method: request.method,
          url: redactSensitiveQueryParams(request.url ?? ''),
          headers: sanitizeHeaders(request.headers),
          reqId: request.id
        };
      },
      res(reply: {
        statusCode?: number;
        getHeaders?: () => Record<string, unknown>;
      }) {
        return {
          statusCode: reply.statusCode,
          headers: sanitizeHeaders(
            (reply.getHeaders?.() ?? {}) as Record<string, unknown>
          )
        };
      },
      err(error: Error & { code?: string }) {
        return {
          type: error.name,
          message: error.message,
          code: error.code,
          stack: error.stack ?? ''
        };
      }
    },
    genReqId(req: { headers: Record<string, unknown> }) {
      const incoming = req.headers[REQUEST_ID_HEADER];
      if (typeof incoming === 'string' && incoming.trim()) {
        return incoming.trim();
      }
      return crypto.randomUUID();
    }
  };
}

export function attachRequestIdHeader(
  reply: { header: (name: string, value: string) => void },
  logger: FastifyBaseLogger,
  requestId: string
) {
  reply.header(REQUEST_ID_HEADER, requestId);
  logger.debug({ reqId: requestId }, 'request received');
}
