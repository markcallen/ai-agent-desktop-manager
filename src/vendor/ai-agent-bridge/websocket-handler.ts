/*
 * Vendored from ai-agent-bridge v0.2.0 bridge-client-node.
 */

import { WebSocket, WebSocketServer } from 'ws';
import type { RawData } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { BridgeGrpcClient } from './grpc-client.js';
import type {
  BridgeClientOptions,
  ClientMessage,
  ErrorMsg,
  Logger,
  ServerMessage
} from './types.js';

export interface BridgeWebSocketHandlerOptions {
  bridgeAddr: string;
  credentials?: object;
  metadata?: Record<string, string>;
  channelOptions?: Record<string, string | number>;
  logger?: Logger;
  wssOptions?: ConstructorParameters<typeof WebSocketServer>[0];
}

export function createBridgeWebSocketHandler(
  options: BridgeWebSocketHandlerOptions
): WebSocketServer {
  const logger: Logger = options.logger ?? {
    info: (msg, ...a) => console.info('[bridge-ws]', msg, ...a),
    warn: (msg, ...a) => console.warn('[bridge-ws]', msg, ...a),
    error: (msg, ...a) => console.error('[bridge-ws]', msg, ...a),
    debug: (msg, ...a) => console.debug('[bridge-ws]', msg, ...a)
  };

  const wss = new WebSocketServer(options.wssOptions ?? { noServer: true });

  wss.on('connection', (ws: WebSocket) => {
    const connId = uuidv4();
    logger.info('WebSocket connected', { connId });

    const clientOptions: BridgeClientOptions = {
      bridgeAddr: options.bridgeAddr,
      credentials: options.credentials,
      metadata: options.metadata,
      channelOptions: options.channelOptions,
      logger
    };

    const grpcClient = new BridgeGrpcClient(clientOptions);
    const activeAttachments = new Map<string, AbortController>();

    function send(msg: ServerMessage) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    }

    function sendError(code: string, message: string) {
      const msg: ErrorMsg = { type: 'error', code, message };
      send(msg);
    }

    async function handleMessage(raw: string) {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw) as ClientMessage;
      } catch {
        sendError('parse_error', 'Invalid JSON');
        return;
      }

      try {
        switch (msg.type) {
          case 'start_session': {
            const result = await grpcClient.startSession({
              projectId: msg.projectId,
              sessionId: msg.sessionId,
              repoPath: msg.repoPath,
              provider: msg.provider,
              agentOpts: msg.agentOpts,
              initialCols: msg.initialCols,
              initialRows: msg.initialRows
            });
            send({
              type: 'session_started',
              sessionId: result.sessionId,
              status: result.status,
              createdAt: result.createdAt
            });
            break;
          }

          case 'send_input': {
            const text = msg.text.replace(/\n/g, '\r');
            const result = await grpcClient.writeInput({
              sessionId: msg.sessionId,
              clientId: msg.clientId,
              data: text
            });
            send({
              type: 'input_accepted',
              accepted: result.accepted,
              bytesWritten: result.bytesWritten
            });
            break;
          }

          case 'stop_session': {
            const result = await grpcClient.stopSession({
              sessionId: msg.sessionId,
              force: msg.force
            });
            send({
              type: 'session_stopped',
              sessionId: msg.sessionId,
              status: result.status
            });
            break;
          }

          case 'attach_session': {
            const { sessionId, clientId, afterSeq } = msg;
            const existing = activeAttachments.get(sessionId);
            if (existing) {
              existing.abort();
              activeAttachments.delete(sessionId);
            }

            const ac = new AbortController();
            activeAttachments.set(sessionId, ac);

            void (async () => {
              try {
                for await (const event of grpcClient.attachSession({
                  sessionId,
                  clientId,
                  afterSeq,
                  signal: ac.signal
                })) {
                  send({
                    type: 'attach_event',
                    seq: event.seq,
                    sessionId: event.sessionId,
                    eventType: event.type,
                    payloadB64: event.payload.toString('base64'),
                    replay: event.replay,
                    oldestSeq: event.oldestSeq,
                    lastSeq: event.lastSeq,
                    exitRecorded: event.exitRecorded,
                    exitCode: event.exitCode,
                    error: event.error,
                    cols: event.cols,
                    rows: event.rows
                  });
                }
              } catch (err) {
                if (!ac.signal.aborted) {
                  const message =
                    err instanceof Error ? err.message : String(err);
                  logger.warn('Attach stream error', { sessionId, message });
                  sendError('stream_error', message);
                }
              } finally {
                activeAttachments.delete(sessionId);
              }
            })();
            break;
          }

          case 'resize_session': {
            await grpcClient.resizeSession({
              sessionId: msg.sessionId,
              clientId: msg.clientId,
              cols: msg.cols,
              rows: msg.rows
            });
            break;
          }

          case 'list_sessions': {
            const sessions = await grpcClient.listSessions(msg.projectId);
            send({ type: 'sessions_list', sessions });
            break;
          }

          case 'get_session': {
            const session = await grpcClient.getSession(msg.sessionId);
            send({ type: 'session_info', session });
            break;
          }

          case 'health': {
            const result = await grpcClient.health();
            send({
              type: 'health_response',
              status: result.status,
              providers: result.providers
            });
            break;
          }

          case 'list_providers': {
            const providers = await grpcClient.listProviders();
            send({ type: 'providers_list', providers });
            break;
          }

          default: {
            logger.debug('Ignoring unknown WebSocket message type', {
              connId,
              type: (msg as { type?: string }).type
            });
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Error handling message', {
          connId,
          type: (msg as { type?: string }).type,
          message
        });
        sendError('internal_error', message);
      }
    }

    ws.on('message', (data: RawData) => {
      void handleMessage(data.toString()).catch((err) => {
        logger.error('Unhandled message error', { connId, err });
      });
    });

    ws.on('close', () => {
      logger.info('WebSocket disconnected', { connId });
      for (const [, ac] of activeAttachments) {
        ac.abort();
      }
      activeAttachments.clear();
      grpcClient.close();
    });

    ws.on('error', (err: Error) => {
      logger.error('WebSocket error', { connId, err: err.message });
    });
  });

  return wss;
}
