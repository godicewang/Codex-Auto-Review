// Bound bytes before decoding: stream chunks can split a UTF-8 code point.
// Parser diagnostics must never echo prompt or source snippets into logs.
export const MAX_INPUT_BYTES = 256000;
export async function readJsonObject(stream, { allowEmpty = false } = {}) {
  const chunks = []; let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_INPUT_BYTES) throw new Error(`输入超过 ${MAX_INPUT_BYTES} 字节限制。`);
    chunks.push(bytes);
  }
  if (allowEmpty && size === 0) return {};
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new Error('输入不是有效的 UTF-8 JSON 对象。'); }
}
