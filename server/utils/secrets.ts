import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import path from "node:path";
export class Vault {
  private key: Buffer;
  constructor(dir: string, key = process.env.ENCRYPTION_KEY) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (key) {
      if (!/^[a-f0-9]{64}$/i.test(key))
        throw new Error("ENCRYPTION_KEY must be 64 hex characters");
      this.key = Buffer.from(key, "hex");
    } else {
      const file = path.join(dir, ".key");
      if (!existsSync(file) && existsSync(path.join(dir, "state.json")))
        throw new Error(
          "The encryption key is missing. Restore .key or set the original ENCRYPTION_KEY before starting.",
        );
      if (!existsSync(file))
        writeFileSync(file, randomBytes(32), { mode: 0o600, flag: "wx" });
      chmodSync(file, 0o600);
      this.key = readFileSync(file);
      if (this.key.length !== 32)
        throw new Error("Invalid local encryption key");
    }
  }
  encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    return Buffer.concat([
      iv,
      cipher.update(value, "utf8"),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString("base64");
  }
  decrypt(value: string) {
    const b = Buffer.from(value, "base64");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      b.subarray(0, 12),
    );
    decipher.setAuthTag(b.subarray(-16));
    return Buffer.concat([
      decipher.update(b.subarray(12, -16)),
      decipher.final(),
    ]).toString("utf8");
  }
}
