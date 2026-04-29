import pino from 'pino/browser.js';
import type { Level, LogEvent, Logger } from 'pino';

interface ConsoleMethods {
  log: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  trace: (...args: unknown[]) => void;
}

interface BrowserTransportEntry {
  level: Level;
  logEvent: LogEvent;
}

interface BrowserLogTransportOptions {
  token: string;
  endpoint?: string;
  batchIntervalMs?: number;
  fetchImpl?: typeof fetch;
  sendBeaconImpl?: (url: string, data: BodyInit) => boolean;
  scheduleFlush?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancelFlush?: (handle: ReturnType<typeof setTimeout>) => void;
  now?: () => number;
}

interface CreatePinoBrowserLoggerOptions {
  transmit: {
    send: (level: Level, logEvent: LogEvent) => void;
  };
  consoleMethods?: ConsoleMethods;
}

type ConsoleMethodName = keyof ConsoleMethods;

const FLUSH_INTERVAL_MS = 500;
const LOGS_ENDPOINT = '/_aadm/logs';
const TOKEN_HEADER = 'x-aadm-logs-token';

function defaultConsoleMethods(): ConsoleMethods {
  return {
    log: console.log.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    trace: (console.trace ?? console.debug).bind(console)
  };
}

function buildConsoleWriteBridge(consoleMethods: ConsoleMethods) {
  return {
    fatal: (obj: unknown) => consoleMethods.error(obj),
    error: (obj: unknown) => consoleMethods.error(obj),
    warn: (obj: unknown) => consoleMethods.warn(obj),
    info: (obj: unknown) => consoleMethods.info(obj),
    debug: (obj: unknown) => consoleMethods.debug(obj),
    trace: (obj: unknown) => consoleMethods.trace(obj)
  };
}

function consoleMethodToLevel(method: ConsoleMethodName): Level {
  switch (method) {
    case 'log':
    case 'info':
      return 'info';
    case 'debug':
      return 'debug';
    case 'warn':
      return 'warn';
    case 'error':
      return 'error';
    case 'trace':
      return 'trace';
  }
}

export function createBrowserLogTransport({
  token,
  endpoint = LOGS_ENDPOINT,
  batchIntervalMs = FLUSH_INTERVAL_MS,
  fetchImpl = fetch,
  sendBeaconImpl,
  scheduleFlush = (callback, delay) => setTimeout(callback, delay),
  cancelFlush = (handle) => clearTimeout(handle),
  now = () => Date.now()
}: BrowserLogTransportOptions) {
  let queue: BrowserTransportEntry[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer() {
    if (timer !== null) {
      cancelFlush(timer);
      timer = null;
    }
  }

  async function sendBatch(batch: BrowserTransportEntry[]) {
    if (batch.length === 0) return;

    const body = JSON.stringify({ logs: batch });
    await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [TOKEN_HEADER]: token
      },
      body,
      keepalive: true
    });
  }

  async function flush() {
    clearTimer();
    if (queue.length === 0) return;
    const batch = queue.splice(0);
    try {
      await sendBatch(batch);
    } catch {
      // Never let log delivery break the app.
    }
  }

  function flushWithBeacon() {
    clearTimer();
    if (queue.length === 0) return;

    const batch = queue.splice(0);
    const body = JSON.stringify({ logs: batch });

    if (sendBeaconImpl) {
      const blob = new Blob([body], { type: 'application/json' });
      if (sendBeaconImpl(endpoint, blob)) {
        return;
      }
    }

    void sendBatch(batch).catch(() => {
      // Ignore delivery failures during page shutdown.
    });
  }

  function schedule() {
    if (timer !== null) return;
    timer = scheduleFlush(() => {
      void flush();
    }, Math.max(0, batchIntervalMs));
  }

  return {
    now,
    send(level: Level, logEvent: LogEvent) {
      queue.push({ level, logEvent });
      schedule();
    },
    flush,
    flushWithBeacon
  };
}

export function createPinoBrowserLogger({
  transmit,
  consoleMethods = defaultConsoleMethods()
}: CreatePinoBrowserLoggerOptions) {
  const logger = pino({
    level: 'trace',
    browser: {
      asObject: true,
      reportCaller: true,
      serialize: true,
      write: buildConsoleWriteBridge(consoleMethods),
      transmit: {
        level: 'trace',
        send: transmit.send
      }
    }
  });

  return {
    logger,
    captureConsole(method: ConsoleMethodName, args: unknown[]) {
      switch (consoleMethodToLevel(method)) {
        case 'trace':
          (logger.trace as (...values: unknown[]) => void)(...args);
          break;
        case 'debug':
          (logger.debug as (...values: unknown[]) => void)(...args);
          break;
        case 'warn':
          (logger.warn as (...values: unknown[]) => void)(...args);
          break;
        case 'error':
          (logger.error as (...values: unknown[]) => void)(...args);
          break;
        default:
          (logger.info as (...values: unknown[]) => void)(...args);
      }
    }
  };
}

interface BrowserLoggerState {
  transport: ReturnType<typeof createBrowserLogTransport>;
  restoreConsole: () => void;
  cleanupWindow: () => void;
}

let state: BrowserLoggerState | null = null;

function installConsoleCapture(
  browserLogger: ReturnType<typeof createPinoBrowserLogger>
) {
  const original = {
    log: console.log,
    info: console.info,
    debug: console.debug,
    warn: console.warn,
    error: console.error,
    trace: console.trace
  };

  console.log = (...args: unknown[]) =>
    browserLogger.captureConsole('log', args);
  console.info = (...args: unknown[]) =>
    browserLogger.captureConsole('info', args);
  console.debug = (...args: unknown[]) =>
    browserLogger.captureConsole('debug', args);
  console.warn = (...args: unknown[]) =>
    browserLogger.captureConsole('warn', args);
  console.error = (...args: unknown[]) =>
    browserLogger.captureConsole('error', args);
  console.trace = (...args: unknown[]) =>
    browserLogger.captureConsole('trace', args);

  return () => {
    console.log = original.log;
    console.info = original.info;
    console.debug = original.debug;
    console.warn = original.warn;
    console.error = original.error;
    console.trace = original.trace;
  };
}

function installWindowCapture(
  logger: Logger,
  transport: ReturnType<typeof createBrowserLogTransport>
) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const onError = (event: ErrorEvent) => {
    logger.error(
      {
        type: 'window.onerror',
        source: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        err: event.error
      },
      String(event.message ?? 'Uncaught error')
    );
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    logger.error(
      {
        type: 'unhandledrejection',
        reason: event.reason
      },
      'Unhandled promise rejection'
    );
  };

  const onVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      transport.flushWithBeacon();
    }
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };
}

export function initBrowserLogger(logsToken: string) {
  stopBrowserLogger();

  const transport = createBrowserLogTransport({
    token: logsToken,
    fetchImpl: fetch.bind(globalThis),
    sendBeaconImpl:
      typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
        ? navigator.sendBeacon.bind(navigator)
        : undefined
  });
  const browserLogger = createPinoBrowserLogger({ transmit: transport });

  state = {
    transport,
    restoreConsole: installConsoleCapture(browserLogger),
    cleanupWindow: installWindowCapture(browserLogger.logger, transport)
  };
}

export async function flushBrowserLogger() {
  await state?.transport.flush();
}

export function stopBrowserLogger() {
  if (!state) return;
  state.restoreConsole();
  state.cleanupWindow();
  state = null;
}
