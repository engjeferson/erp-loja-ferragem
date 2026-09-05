import crypto from "crypto";
import { env } from "../config/env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/**
 * ENCRYPTION_KEY must be a 32-byte key, hex-encoded (64 hex chars).
 * Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
function getKey(): Buffer {
  const key = Buffer.from(env.encryptionKey, "hex");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY deve ser uma chave hex de 32 bytes (64 caracteres)");
  }
  return key;
}

export interface EncryptedPayload {
  data: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export function encryptBuffer(plain: Buffer): EncryptedPayload {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { data, iv, authTag: cipher.getAuthTag() };
}

export function decryptBuffer(payload: EncryptedPayload): Buffer {
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), payload.iv);
  decipher.setAuthTag(payload.authTag);
  return Buffer.concat([decipher.update(payload.data), decipher.final()]);
}

export function encryptText(plain: string): EncryptedPayload {
  return encryptBuffer(Buffer.from(plain, "utf8"));
}

export function decryptText(payload: EncryptedPayload): string {
  return decryptBuffer(payload).toString("utf8");
}
