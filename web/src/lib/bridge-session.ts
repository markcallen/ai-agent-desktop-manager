export interface BridgeSession {
  sessionId: string;
  clientId: string;
}

export interface PendingBridgeSessionStart {
  sessionId: string;
  clientId: string;
}

export interface BridgeSessionUiState {
  session: BridgeSession | null;
  pendingStart: PendingBridgeSessionStart | null;
  error: string | null;
}

export function beginBridgeSessionStart(
  state: BridgeSessionUiState,
  pendingStart: PendingBridgeSessionStart,
  sent: boolean
): BridgeSessionUiState {
  if (!sent) {
    return {
      ...state,
      pendingStart: null,
      error: 'Bridge connection is not ready'
    };
  }

  return {
    ...state,
    pendingStart,
    error: null
  };
}

export function acknowledgeBridgeSessionStart(
  state: BridgeSessionUiState,
  sessionId: string
): BridgeSessionUiState {
  return {
    ...state,
    pendingStart: null,
    session: {
      sessionId,
      clientId: state.pendingStart?.clientId ?? crypto.randomUUID()
    }
  };
}

export function clearBridgeSession(
  state: BridgeSessionUiState
): BridgeSessionUiState {
  return {
    ...state,
    session: null,
    pendingStart: null
  };
}

export function setBridgeSessionError(
  state: BridgeSessionUiState,
  error: string
): BridgeSessionUiState {
  return {
    ...state,
    pendingStart: null,
    error
  };
}
