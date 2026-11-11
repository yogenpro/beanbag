function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
function decode(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
async function key(secret: string) {
  const bytes = decode(secret);
  if (bytes.length !== 32)
    throw new Error("Encryption key must be 32 base64-encoded bytes");
  return crypto.subtle.importKey(
    "raw",
    bytes as BufferSource,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
export async function encryptToken(
  token: string,
  secret: string,
  itemId: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(itemId) },
    await key(secret),
    new TextEncoder().encode(token),
  );
  return `v1.${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
}
export async function decryptToken(
  value: string,
  secret: string,
  itemId: string,
): Promise<string> {
  const [version, iv, ciphertext] = value.split(".");
  if (version !== "v1") throw new Error("Unsupported token format");
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decode(iv) as BufferSource,
        additionalData: new TextEncoder().encode(itemId),
      },
      await key(secret),
      decode(ciphertext) as BufferSource,
    ),
  );
}
