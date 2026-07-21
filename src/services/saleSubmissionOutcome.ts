export type SaleSubmissionOutcomeKind = 'definitive_rejection' | 'ambiguous_result';

export interface SaleSubmissionOutcome {
  kind: SaleSubmissionOutcomeKind;
}

export interface SaleSubmissionErrorMetadata {
  httpStatus?: number;
  responseReceived?: boolean;
  code?: string;
  name?: string;
  message?: string;
}

function readProperty(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

export function readSaleSubmissionErrorMetadata(error: unknown): SaleSubmissionErrorMetadata {
  if (typeof error === 'string') {
    return { message: error };
  }
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) {
    return {};
  }

  const metadata: SaleSubmissionErrorMetadata = {};
  const httpStatus = readProperty(error, 'httpStatus');
  const responseReceived = readProperty(error, 'responseReceived');
  const code = readProperty(error, 'code');
  const name = readProperty(error, 'name');
  const message = readProperty(error, 'message');

  if (typeof httpStatus === 'number' && Number.isFinite(httpStatus)) {
    metadata.httpStatus = httpStatus;
  }
  if (typeof responseReceived === 'boolean') {
    metadata.responseReceived = responseReceived;
  }
  if (typeof code === 'string') {
    metadata.code = code;
  }
  if (typeof name === 'string') {
    metadata.name = name;
  }
  if (typeof message === 'string') {
    metadata.message = message;
  }

  return metadata;
}

const FUNCTIONAL_CODES = new Set([
  'insufficient_stock',
  'session_expired',
  'api_rejection',
  'access_denied',
  'validation_error',
  'forbidden',
  'unauthorized',
]);

const AMBIGUOUS_CODE_OR_NAME_RE =
  /invalid_response|timeout|timedout|network|abort|etimedout|econnreset|econnrefused|enotfound|ehostunreach|enetunreach/;
const AMBIGUOUS_MESSAGE_RE =
  /network|timed?\s*out|timeout|abort(?:ed)?|connection\s+(?:lost|failed|reset|refused)|conexi[oó]n.*(?:fall|perdid|rechaz)|sin respuesta/i;

export function classifySaleSubmissionError(error: unknown): SaleSubmissionOutcome {
  const metadata = readSaleSubmissionErrorMetadata(error);
  const status = metadata.httpStatus;

  if (status !== undefined && status >= 500 && status <= 599) {
    return { kind: 'ambiguous_result' };
  }
  if (metadata.responseReceived === false) {
    return { kind: 'ambiguous_result' };
  }
  if (status !== undefined && status >= 400 && status <= 499) {
    return { kind: 'definitive_rejection' };
  }

  const code = metadata.code?.trim().toLowerCase();
  if (code !== undefined && FUNCTIONAL_CODES.has(code)) {
    return { kind: 'definitive_rejection' };
  }

  const name = metadata.name?.trim().toLowerCase();
  if (
    (code !== undefined && AMBIGUOUS_CODE_OR_NAME_RE.test(code))
    || (name !== undefined && AMBIGUOUS_CODE_OR_NAME_RE.test(name))
  ) {
    return { kind: 'ambiguous_result' };
  }

  if (
    status === undefined
    && metadata.responseReceived !== true
    && metadata.message !== undefined
    && AMBIGUOUS_MESSAGE_RE.test(metadata.message)
  ) {
    return { kind: 'ambiguous_result' };
  }

  return { kind: 'ambiguous_result' };
}
