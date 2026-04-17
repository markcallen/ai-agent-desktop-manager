import fs from 'node:fs';
import * as grpc from '@grpc/grpc-js';
import { createBridgeWebSocketHandler } from '../vendor/ai-agent-bridge/websocket-handler.js';
import { config } from './config.js';

export function managerBridgeWebsocketPath(desktopId: string) {
  return `/_aadm/bridge/${desktopId}/ws`;
}

/**
 * Convert a bridge address to a bare gRPC target (host:port).
 * AADM_BRIDGE_ADDR may be supplied as a full URL (e.g. http://127.0.0.1:8765)
 * for readability in env files, but @grpc/grpc-js expects "host:port" with no
 * scheme.  If a URL scheme is present we strip it; otherwise the value is
 * returned as-is.
 */
export function toGrpcTarget(addr: string): string {
  // Strip http:// or https:// scheme if present.
  // new URL() cannot be used here because it misparses bare "host:port" strings
  // (treating the hostname as the scheme), so we match explicitly.
  const match = addr.match(/^https?:\/\/(.+)/);
  return match ? match[1] : addr;
}

export function buildBridgeHandler() {
  if (!config.bridgeAddr) {
    return undefined;
  }

  let credentials: grpc.ChannelCredentials;
  if (
    config.bridgeCaCertPath &&
    config.bridgeClientCertPath &&
    config.bridgeClientKeyPath
  ) {
    credentials = grpc.credentials.createSsl(
      fs.readFileSync(config.bridgeCaCertPath),
      fs.readFileSync(config.bridgeClientKeyPath),
      fs.readFileSync(config.bridgeClientCertPath)
    );
  } else {
    credentials = grpc.credentials.createInsecure();
  }

  return createBridgeWebSocketHandler({
    bridgeAddr: toGrpcTarget(config.bridgeAddr),
    credentials,
    metadata: config.bridgeAuthToken
      ? { authorization: `Bearer ${config.bridgeAuthToken}` }
      : undefined
  });
}
