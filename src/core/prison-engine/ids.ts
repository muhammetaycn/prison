const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomToken(length: number): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

export const PRISON_ID_PATTERN = /^pr_[a-z0-9]{8}$/;

export function newPrisonId(): string {
  return `pr_${randomToken(8)}`;
}

export function isPrisonId(value: string): boolean {
  return PRISON_ID_PATTERN.test(value);
}

export function newRecordId(prefix: string): string {
  return `${prefix}_${randomToken(6)}`;
}
