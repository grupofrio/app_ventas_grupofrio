export interface ApiRequestError extends Error {
  httpStatus?: number;
  responseReceived?: boolean;
  code?: string;
  data?: unknown;
  __alreadyLogged?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function makeMutableError(cause: unknown, fallbackMessage: string): ApiRequestError {
  const source = isRecord(cause) ? cause : undefined;
  if (cause instanceof Error && Object.isExtensible(cause)) {
    return cause as ApiRequestError;
  }

  const message = cause instanceof Error ? cause.message : fallbackMessage;
  const error = new Error(message) as ApiRequestError;

  if (cause instanceof Error) {
    error.name = cause.name;
    error.stack = cause.stack;
  }
  if (source && typeof source.code === 'string') {
    error.code = source.code;
  }
  if (source && 'data' in source) {
    error.data = source.data;
  }

  return error;
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
  const fallbackMessage = cause instanceof Error ? cause.message : String(cause);
  const error = makeMutableError(cause, fallbackMessage);
  error.responseReceived = false;
  return error;
}
