export interface ApiRequestError extends Error {
  httpStatus?: number;
  responseReceived?: boolean;
  code?: string;
  data?: unknown;
  __alreadyLogged?: boolean;
}

const DEFAULT_REQUEST_ERROR_MESSAGE = 'Error de solicitud';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readRecordValue(
  source: Record<string, unknown>,
  key: string,
): { found: boolean; value?: unknown } {
  try {
    return key in source
      ? { found: true, value: source[key] }
      : { found: false };
  } catch {
    return { found: false };
  }
}

function getCauseMessage(cause: unknown, fallbackMessage: string): string {
  if (cause instanceof Error) {
    return cause.message;
  }

  if (isRecord(cause)) {
    const message = readRecordValue(cause, 'message');
    if (message.found && typeof message.value === 'string') {
      return message.value;
    }
  }

  if (cause === undefined) {
    return fallbackMessage;
  }

  try {
    return String(cause);
  } catch {
    return fallbackMessage;
  }
}

function copyError(cause: unknown, fallbackMessage: string): ApiRequestError {
  const source = isRecord(cause) ? cause : undefined;
  const error = new Error(getCauseMessage(cause, fallbackMessage)) as ApiRequestError;

  if (cause instanceof Error) {
    error.name = cause.name;
    error.stack = cause.stack;
  }
  if (source) {
    const code = readRecordValue(source, 'code');
    if (code.found && typeof code.value === 'string') {
      error.code = code.value;
    }

    const data = readRecordValue(source, 'data');
    if (data.found) {
      error.data = data.value;
    }
  }

  return error;
}

function makeMutableError(cause: unknown, fallbackMessage: string): ApiRequestError {
  if (cause instanceof Error && Object.isExtensible(cause)) {
    return cause as ApiRequestError;
  }

  return copyError(cause, fallbackMessage);
}

function clearHttpStatus(
  error: ApiRequestError,
  cause: unknown,
  fallbackMessage: string,
): ApiRequestError {
  try {
    if (!('httpStatus' in error)) {
      return error;
    }
    delete error.httpStatus;
    if (!('httpStatus' in error)) {
      return error;
    }
  } catch {
    // Copy below when stale status cannot be inspected or removed safely.
  }

  return copyError(cause, fallbackMessage);
}

export function makeApiResponseError(
  cause: unknown,
  fallbackMessage: string,
  httpStatus: number,
): ApiRequestError {
  const error = makeMutableError(cause, fallbackMessage);
  error.httpStatus = httpStatus;
  error.responseReceived = true;
  error.code ||= 'api_rejection';
  error.__alreadyLogged = true;
  return error;
}

export function makeApiTransportError(cause: unknown): ApiRequestError {
  const error = clearHttpStatus(
    makeMutableError(cause, DEFAULT_REQUEST_ERROR_MESSAGE),
    cause,
    DEFAULT_REQUEST_ERROR_MESSAGE,
  );
  error.responseReceived = false;
  return error;
}
