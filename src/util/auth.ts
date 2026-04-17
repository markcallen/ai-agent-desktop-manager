import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from './config.js';

export async function authHook(req: FastifyRequest, reply: FastifyReply) {
  const url = req.raw.url ?? '';
  if (
    url.startsWith('/_aadm/access/') ||
    url.startsWith('/_aadm/verify/') ||
    url.startsWith('/_aadm/desktop/') ||
    url.startsWith('/_aadm/assets/') ||
    url.startsWith('/healthz/') ||
    url === '/_aadm/logs'
  ) {
    return;
  }

  const token = config.authToken;
  if (!token) return;

  const h = req.headers['authorization'];
  if (!h || !h.toLowerCase().startsWith('bearer ')) {
    reply.code(401).send({ ok: false, error: 'missing_bearer_token' });
    return;
  }
  const got = h.slice('bearer '.length).trim();
  if (got !== token) {
    reply.code(403).send({ ok: false, error: 'invalid_token' });
    return;
  }
}
