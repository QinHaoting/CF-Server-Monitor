import { AppError } from './errors.js';

export function isValidApiSecret(secret) {
  return typeof secret === 'string' && secret.length >= 32 && secret.trim() === secret;
}

export function requireApiSecret(env) {
  if (!isValidApiSecret(env?.API_SECRET)) {
    throw new AppError('Service is not configured', 503);
  }
}

// Count bytes from the stream: Content-Length can be absent or understated.
export async function readLimitedJson(request, maxBytes) {
  const declared = request.headers.get('Content-Length');
  if (declared && Number(declared) > maxBytes) {
    void request.body?.cancel().catch(() => {});
    throw new AppError('Payload too large', 413);
  }
  if (!request.body) throw new AppError('Invalid JSON body', 400);

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const parts = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new AppError('Payload too large', 413);
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return JSON.parse(parts.join(''));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Invalid JSON body', 400);
  } finally {
    reader.releaseLock();
  }
}
