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

function isErrorSafely(value: unknown): value is Error {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
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

export function getApiErrorMessage(cause: unknown, fallbackMessage: string): string {
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
  const error = new Error(getApiErrorMessage(cause, fallbackMessage)) as ApiRequestError;

  if (source) {
    if (isErrorSafely(cause)) {
      const name = readRecordValue(source, 'name');
      if (name.found && typeof name.value === 'string') {
        error.name = name.value;
      }
      const stack = readRecordValue(source, 'stack');
      if (stack.found && typeof stack.value === 'string') {
        error.stack = stack.value;
      }
    }

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
  if (isErrorSafely(cause)) {
    try {
      // Reading these standard fields must also be safe before preserving
      // identity; a Proxy can pass instanceof/isExtensible and still trap them.
      void cause.message;
      void cause.name;
      void cause.stack;
      if (Object.isExtensible(cause)) {
        return cause as ApiRequestError;
      }
    } catch {
      // A hostile Proxy is copied below.
    }
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
  fallbackCode = 'api_rejection',
  alreadyLogged = true,
  forceCode = false,
): ApiRequestError {
  const candidate = makeMutableError(cause, fallbackMessage);
  try {
    candidate.httpStatus = httpStatus;
    candidate.responseReceived = true;
    const code = readRecordValue(candidate as unknown as Record<string, unknown>, 'code');
    if (forceCode || !code.found || typeof code.value !== 'string' || code.value.length === 0) {
      candidate.code = fallbackCode;
    }
    if (alreadyLogged) candidate.__alreadyLogged = true;
    return candidate;
  } catch {
    const copy = copyError(cause, fallbackMessage);
    copy.httpStatus = httpStatus;
    copy.responseReceived = true;
    if (forceCode || !copy.code) copy.code = fallbackCode;
    if (alreadyLogged) copy.__alreadyLogged = true;
    return copy;
  }
}

export function makeApiTransportError(cause: unknown): ApiRequestError {
  const candidate = clearHttpStatus(
    makeMutableError(cause, DEFAULT_REQUEST_ERROR_MESSAGE),
    cause,
    DEFAULT_REQUEST_ERROR_MESSAGE,
  );
  try {
    candidate.responseReceived = false;
    return candidate;
  } catch {
    const copy = clearHttpStatus(
      copyError(cause, DEFAULT_REQUEST_ERROR_MESSAGE),
      cause,
      DEFAULT_REQUEST_ERROR_MESSAGE,
    );
    copy.responseReceived = false;
    return copy;
  }
}

export function hasApiErrorFlag(value: unknown, key: string): boolean {
  if (!isRecord(value)) return false;
  const property = readRecordValue(value, key);
  return property.found && property.value === true;
}

export function getApiErrorCode(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const property = readRecordValue(value, 'code');
  return property.found && typeof property.value === 'string'
    ? property.value
    : undefined;
}
