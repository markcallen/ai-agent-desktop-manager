import fs from 'node:fs';
import * as grpc from '@grpc/grpc-js';
import { createBridgeWebSocketHandler } from '../vendor/ai-agent-bridge/websocket-handler.js';
import { config } from './config.js';

export function buildBridgeWebsocketPath(
  novncPathPrefix: string,
  display: number
) {
  const prefix = novncPathPrefix.replace(/\/$/, '');
  return `${prefix}/${display}/bridge/ws`;
}

export function buildBridgeWebsocketUrl(
  publicBaseUrl: string,
  novncPathPrefix: string,
  display: number
) {
  const url = new URL(
    buildBridgeWebsocketPath(novncPathPrefix, display),
    publicBaseUrl
  );
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export function managerBridgeWebsocketPath(desktopId: string) {
  return `/_aadm/bridge/${desktopId}/ws`;
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
    bridgeAddr: config.bridgeAddr,
    credentials,
    metadata: config.bridgeAuthToken
      ? { authorization: `Bearer ${config.bridgeAuthToken}` }
      : undefined
  });
}
