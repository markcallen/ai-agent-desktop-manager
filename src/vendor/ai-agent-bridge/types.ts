/*
 * Vendored from ai-agent-bridge v0.2.0 bridge-client-node.
 * Kept locally so aadm can build and deploy without a sibling checkout.
 */

export type AttachEventType =
  | 'unspecified'
  | 'attached'
  | 'output'
  | 'replay_gap'
  | 'session_exit'
  | 'error';

export type SessionStatus =
  | 'unspecified'
  | 'starting'
  | 'running'
  | 'attached'
  | 'stopping'
  | 'stopped'
  | 'failed';

export interface SessionInfo {
  sessionId: string;
  projectId: string;
  provider: string;
  status: SessionStatus;
  createdAt: string;
  stoppedAt?: string;
  error?: string;
}

export interface ProviderInfo {
  provider: string;
  available: boolean;
  binary: string;
  version: string;
}

export interface ProviderHealth {
  provider: string;
  available: boolean;
  error?: string;
}

export interface StartSessionMsg {
  type: 'start_session';
  projectId: string;
  sessionId?: string;
  repoPath: string;
  provider: string;
  agentOpts?: Record<string, string>;
  initialCols?: number;
  initialRows?: number;
}

export interface SendInputMsg {
  type: 'send_input';
  sessionId: string;
  clientId: string;
  text: string;
}

export interface StopSessionMsg {
  type: 'stop_session';
  sessionId: string;
  force?: boolean;
}

export interface AttachSessionMsg {
  type: 'attach_session';
  sessionId: string;
  clientId: string;
  afterSeq?: number;
}

export interface ResizeSessionMsg {
  type: 'resize_session';
  sessionId: string;
  clientId: string;
  cols: number;
  rows: number;
}

export interface ListSessionsMsg {
  type: 'list_sessions';
  projectId?: string;
}

export interface GetSessionMsg {
  type: 'get_session';
  sessionId: string;
}

export interface HealthMsg {
  type: 'health';
}

export interface ListProvidersMsg {
  type: 'list_providers';
}

export type ClientMessage =
  | StartSessionMsg
  | SendInputMsg
  | StopSessionMsg
  | AttachSessionMsg
  | ResizeSessionMsg
  | ListSessionsMsg
  | GetSessionMsg
  | HealthMsg
  | ListProvidersMsg;

export interface SessionStartedMsg {
  type: 'session_started';
  sessionId: string;
  status: SessionStatus;
  createdAt: string;
}

export interface AttachEventMsg {
  type: 'attach_event';
  seq: number;
  sessionId: string;
  eventType: AttachEventType;
  payloadB64: string;
  replay: boolean;
  oldestSeq: number;
  lastSeq: number;
  exitRecorded: boolean;
  exitCode: number;
  error: string;
  cols: number;
  rows: number;
}

export interface InputAcceptedMsg {
  type: 'input_accepted';
  accepted: boolean;
  bytesWritten: number;
}

export interface SessionStoppedMsg {
  type: 'session_stopped';
  sessionId: string;
  status: SessionStatus;
}

export interface SessionsListMsg {
  type: 'sessions_list';
  sessions: SessionInfo[];
}

export interface SessionInfoMsg {
  type: 'session_info';
  session: SessionInfo;
}

export interface HealthResponseMsg {
  type: 'health_response';
  status: string;
  providers: ProviderHealth[];
}

export interface ProvidersListMsg {
  type: 'providers_list';
  providers: ProviderInfo[];
}

export interface ErrorMsg {
  type: 'error';
  code: string;
  message: string;
}

export type ServerMessage =
  | SessionStartedMsg
  | AttachEventMsg
  | InputAcceptedMsg
  | SessionStoppedMsg
  | SessionsListMsg
  | SessionInfoMsg
  | HealthResponseMsg
  | ProvidersListMsg
  | ErrorMsg;

export interface ProtoAttachSessionEvent {
  type: string | number;
  seq: number | Long;
  timestamp?: { seconds: number | Long; nanos: number };
  session_id: string;
  payload: Buffer | Uint8Array;
  replay: boolean;
  oldest_seq: number | Long;
  last_seq: number | Long;
  exit_recorded: boolean;
  exit_code: number;
  error: string;
  cols: number;
  rows: number;
}

export interface ProtoGetSessionResponse {
  session_id: string;
  project_id: string;
  provider: string;
  status: string | number;
  created_at?: { seconds: number | Long; nanos: number };
  stopped_at?: { seconds: number | Long; nanos: number };
  error: string;
}

export interface ProtoListSessionsResponse {
  sessions: ProtoGetSessionResponse[];
}

export interface ProtoStartSessionResponse {
  session_id: string;
  status: string | number;
  created_at?: { seconds: number | Long; nanos: number };
}

export interface ProtoStopSessionResponse {
  status: string | number;
}

export interface ProtoWriteInputResponse {
  accepted: boolean;
  bytes_written: number;
}

export interface ProtoResizeSessionResponse {
  applied: boolean;
}

export interface ProtoHealthResponse {
  status: string;
  providers: Array<{ provider: string; available: boolean; error: string }>;
}

export interface ProtoListProvidersResponse {
  providers: Array<{
    provider: string;
    available: boolean;
    binary: string;
    version: string;
  }>;
}

export interface Logger {
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
  debug: (msg: string, ...args: unknown[]) => void;
}

export interface BridgeClientOptions {
  bridgeAddr: string;
  credentials?: object;
  metadata?: Record<string, string>;
  channelOptions?: Record<string, string | number>;
  logger?: Logger;
}

type Long = { toNumber(): number };
