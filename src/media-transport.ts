export function base64ToArrayBuffer(value: string): ArrayBuffer {
  const fast = (Uint8Array as unknown as { fromBase64?: (input: string) => Uint8Array }).fromBase64;
  if (typeof fast === 'function') {
    const bytes = fast.call(Uint8Array, value);
    return bytes.buffer as ArrayBuffer;
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
