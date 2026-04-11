import crypto from 'node:crypto';
import type { Duplex } from 'node:stream';
import type { IncomingMessage } from 'node:http';

export type WebSocketMessageHandler = (message: string) => void;
export type WebSocketCloseHandler = () => void;

function encodeFrame(opcode: number, payload: Buffer) {
  const header: number[] = [0x80 | (opcode & 0x0f)];

  if (payload.length < 126) {
    header.push(payload.length);
  } else if (payload.length <= 0xffff) {
    header.push(126, (payload.length >> 8) & 0xff, payload.length & 0xff);
  } else {
    const len = BigInt(payload.length);
    header.push(127);
    for (let shift = 56n; shift >= 0n; shift -= 8n) {
      header.push(Number((len >> shift) & 0xffn));
    }
  }

  return Buffer.concat([Buffer.from(header), payload]);
}

function tryDecodeFrame(buffer: Buffer) {
  if (buffer.length < 2) return undefined;

  const first = buffer[0];
  const second = buffer[1];
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let offset = 2;
  let payloadLength = second & 0x7f;

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) return undefined;
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) return undefined;
    const longLength = Number(buffer.readBigUInt64BE(offset));
    payloadLength = longLength;
    offset += 8;
  }

  const maskBytes = masked ? 4 : 0;
  const frameLength = offset + maskBytes + payloadLength;
  if (buffer.length < frameLength) return undefined;

  let payload = buffer.subarray(offset + maskBytes, frameLength);
  if (masked) {
    const mask = buffer.subarray(offset, offset + 4);
    const unmasked = Buffer.allocUnsafe(payload.length);
    for (let index = 0; index < payload.length; index += 1) {
      unmasked[index] = payload[index] ^ mask[index % 4];
    }
    payload = unmasked;
  }

  return {
    opcode,
    payload,
    remaining: Buffer.from(buffer.subarray(frameLength))
  };
}

export function isWebSocketUpgradeRequest(req: IncomingMessage) {
  return (
    typeof req.headers.upgrade === 'string' &&
    req.headers.upgrade.toLowerCase() === 'websocket'
  );
}

export function acceptWebSocket(
  req: IncomingMessage,
  socket: Duplex,
  handlers: {
    onMessage?: WebSocketMessageHandler;
    onClose?: WebSocketCloseHandler;
  }
) {
  const websocketKey = req.headers['sec-websocket-key'];
  if (typeof websocketKey !== 'string' || !isWebSocketUpgradeRequest(req)) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return undefined;
  }

  const acceptKey = crypto
    .createHash('sha1')
    .update(`${websocketKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');

  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '\r\n'
    ].join('\r\n')
  );

  let buffered = Buffer.alloc(0);
  let closed = false;

  function close() {
    if (closed) return;
    closed = true;
    try {
      socket.write(encodeFrame(0x8, Buffer.alloc(0)));
    } catch {
      // ignore close write failures
    }
    socket.destroy();
    handlers.onClose?.();
  }

  function sendJson(message: Record<string, unknown>) {
    socket.write(encodeFrame(0x1, Buffer.from(JSON.stringify(message))));
  }

  socket.on('data', (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);

    while (buffered.length > 0) {
      const decoded = tryDecodeFrame(buffered);
      if (!decoded) break;
      buffered = decoded.remaining;

      if (decoded.opcode === 0x8) {
        close();
        return;
      }

      if (decoded.opcode === 0x9) {
        socket.write(encodeFrame(0xa, decoded.payload));
        continue;
      }

      if (decoded.opcode !== 0x1) {
        continue;
      }

      handlers.onMessage?.(decoded.payload.toString('utf8'));
    }
  });

  socket.on('close', close);
  socket.on('end', close);
  socket.on('error', close);

  return {
    sendJson,
    close
  };
}
