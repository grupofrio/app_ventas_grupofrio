export const CAMERA_OPEN_TIMEOUT_MS = 15_000;
export const CAMERA_OPEN_ERROR = 'No se pudo abrir la cámara';

export function decideCameraPermission(status: string | null | undefined): 'open' | 'request' {
  return status === 'granted' ? 'open' : 'request';
}

export function withCameraTimeout<T>(
  promise: Promise<T>,
  timeoutMs = CAMERA_OPEN_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(CAMERA_OPEN_ERROR));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function isCameraOpenError(error: unknown): error is Error {
  return error instanceof Error && error.message === CAMERA_OPEN_ERROR;
}
