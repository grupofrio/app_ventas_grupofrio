import { makeApiResponseError } from './apiRequestError.ts';

export interface PostRestResponseBodySource {
  status: number;
  text: () => Promise<string>;
}

export async function readPostRestResponseText(
  response: PostRestResponseBodySource,
): Promise<string> {
  try {
    return await response.text();
  } catch (cause: unknown) {
    throw makeApiResponseError(
      cause,
      'No se pudo leer la respuesta del servidor.',
      response.status,
      'invalid_response',
      false,
      true,
    );
  }
}
