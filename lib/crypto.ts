import crypto from "crypto";
import { env } from "@/lib/env";

export function generateHostSecret(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashHostSecret(secret: string): string {
  const payload = `${secret}:${env.secretPepper}`;
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export function safeSecretMatch(secret: string, hashHex: string): boolean {
  const candidate = Buffer.from(hashHostSecret(secret), "hex");
  const actual = Buffer.from(hashHex, "hex");
  if (candidate.length !== actual.length) {
    return false;
  }
  return crypto.timingSafeEqual(candidate, actual);
}
