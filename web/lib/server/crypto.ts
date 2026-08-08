import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Envelope encryption for stored credentials. SERVER ONLY.
 *
 * AES-256-GCM, one fresh 96-bit nonce per write, authenticated with additional
 * data that binds the ciphertext to the row it belongs to.
 *
 * WHY AUTHENTICATED ENCRYPTION AND NOT JUST ENCRYPTION
 * A CBC or CTR ciphertext can be edited by anyone who can write the row, and
 * the edit decrypts to *something*. For a credential blob that means an
 * attacker with SQL write access — but no key — can still influence which host
 * the engine connects to. GCM's tag makes that a decrypt failure instead.
 *
 * WHY THE AAD MATTERS
 * `aad` is `sourceId:keyVersion`, and it is not stored in the ciphertext. So a
 * row copied from source A onto source B fails to decrypt even though the key
 * is the same and the bytes are intact. Without it, "move the ciphertext" is a
 * privilege escalation: point a source you control at a credential you were
 * never granted.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * No `decryptToString` that takes a plain string, no exported key material, no
 * logging of anything derived from a plaintext. The only way out of this module
 * is `decryptSecrets`, and it returns to exactly two callers.
 */

/** AES-256. 32 bytes, and the key derivation below always produces 32. */
const KEY_BYTES = 32;
/** GCM's designed nonce size. 12 bytes, never anything else. */
const IV_BYTES = 12;
/** Full-length GCM tag. Truncating it trades tamper-evidence for nothing. */
const TAG_BYTES = 16;

/**
 * The current root key generation.
 *
 * Rotation is: add `CANON_CREDENTIAL_KEY_V2`, bump this, and re-encrypt rows
 * whose `key_version` is behind in the background. Old rows keep decrypting
 * under their own version throughout, so there is no window where credentials
 * are unreadable and no flag day.
 */
export const CURRENT_KEY_VERSION = 1;

/**
 * Root keys by version, from the environment.
 *
 * This is the one secret that cannot itself be stored encrypted — something has
 * to be the root of trust. It is also the *only* credential-related env var
 * left: the per-integration keys this feature replaced are gone. In production
 * this should come from a KMS or a secret manager rather than a file, and
 * `keyFor` is the single place that would change.
 */
function keyEnvVar(version: number): string {
  return version === 1 ? "CANON_CREDENTIAL_KEY" : `CANON_CREDENTIAL_KEY_V${version}`;
}

/** Cached per version — the derivation is cheap, but this runs per row read. */
const keyCache = new Map<number, Buffer>();

function keyFor(version: number): Buffer {
  const cached = keyCache.get(version);
  if (cached) return cached;

  const name = keyEnvVar(version);
  const raw = process.env[name];

  if (!raw) {
    throw new CredentialKeyError(
      `${name} is not set. Generate one with \`openssl rand -base64 32\` and add it ` +
        `to web/.env and engine/.env — the same value in both, server-side only, never NEXT_PUBLIC_.`,
    );
  }

  const key = deriveKey(raw, name);
  keyCache.set(version, key);
  return key;
}

/**
 * Accepts a 32-byte base64 key and uses it directly; accepts anything else and
 * hashes it to 32 bytes.
 *
 * The hash branch exists so a developer who pastes a passphrase gets a working
 * install rather than a crash — but it is strictly worse, because a passphrase
 * has far less entropy than the 256 bits AES is being asked to provide, so it
 * warns once. It does not silently accept a weak key as if it were fine.
 */
function deriveKey(raw: string, name: string): Buffer {
  const decoded = Buffer.from(raw, "base64");

  if (decoded.length === KEY_BYTES) return decoded;

  if (process.env.NODE_ENV === "production") {
    throw new CredentialKeyError(
      `${name} must be exactly 32 bytes, base64-encoded. Generate one with ` +
        `\`openssl rand -base64 32\`. Refusing to hash a short key in production.`,
    );
  }

  console.warn(
    `[canon] ${name} is not a 32-byte base64 key; hashing it to length. ` +
      `This is fine locally and unacceptable in production — use \`openssl rand -base64 32\`.`,
  );
  return createHash("sha256").update(raw, "utf8").digest();
}

/** A misconfigured root key. Distinct so a route can say "not set up" not "server error". */
export class CredentialKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialKeyError";
  }
}

/** A ciphertext that did not authenticate. Wrong key, wrong row, or tampered. */
export class CredentialDecryptError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CredentialDecryptError";
  }
}

/** Exactly the three columns the row stores, plus the version that sealed it. */
export type SealedSecret = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
};

/**
 * Whether encryption is available at all, without throwing.
 *
 * Used by the connect screens so a missing key surfaces as "Canon is not
 * configured to store credentials yet" on the page that would have asked for
 * one, rather than as a 500 after the user has typed a password in.
 */
export function credentialEncryptionReady(): boolean {
  try {
    keyFor(CURRENT_KEY_VERSION);
    return true;
  } catch {
    return false;
  }
}

/**
 * Seal a secret bundle for one source.
 *
 * `secrets` is the `{ password, securityToken }` half of a credential — the
 * public half is stored in clear in its own column and is not passed here.
 */
export function encryptSecrets(
  secrets: Record<string, string>,
  { sourceId }: { sourceId: string },
): SealedSecret {
  const key = keyFor(CURRENT_KEY_VERSION);
  // Fresh per write, always. A repeated nonce under the same key breaks GCM
  // completely — it leaks the XOR of two plaintexts and the auth key with it.
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(sourceId, CURRENT_KEY_VERSION));

  const sealed = Buffer.concat([
    cipher.update(JSON.stringify(secrets), "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext: sealed.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

/**
 * Open a sealed bundle. Throws `CredentialDecryptError` on any failure.
 *
 * The message never includes the ciphertext, the key version's env var value,
 * or anything derived from the plaintext — a decrypt failure is exactly as
 * informative as it needs to be to fix a misconfiguration and no more.
 */
export function decryptSecrets(
  sealed: SealedSecret,
  { sourceId }: { sourceId: string },
): Record<string, string> {
  const key = keyFor(sealed.keyVersion);

  const iv = Buffer.from(sealed.iv, "base64");
  const tag = Buffer.from(sealed.authTag, "base64");

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new CredentialDecryptError(
      "Stored credential has a malformed nonce or tag. The row was not written by this code path.",
    );
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(sourceId, sealed.keyVersion));
    decipher.setAuthTag(tag);

    const opened = Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, "base64")),
      decipher.final(),
    ]);

    const parsed: unknown = JSON.parse(opened.toString("utf8"));
    if (!isStringRecord(parsed)) {
      throw new CredentialDecryptError("Decrypted credential was not a flat string map.");
    }
    return parsed;
  } catch (cause) {
    if (cause instanceof CredentialDecryptError) throw cause;
    // `final()` throwing is the tag check failing. Three causes, and the
    // operator needs to be told which class of thing to look at.
    throw new CredentialDecryptError(
      `Could not decrypt the credential for source ${sourceId}. Either ` +
        `${keyEnvVar(sealed.keyVersion)} has changed, the row was copied from another ` +
        `source, or the ciphertext was modified. Reconnect the source to re-establish it.`,
      { cause },
    );
  }
}

/**
 * Additional authenticated data: what this ciphertext is *for*.
 *
 * Not encrypted and not stored — it is recomputed from the row's own identity
 * at decrypt time, which is precisely why moving the ciphertext to a different
 * source makes it undecryptable.
 */
function aad(sourceId: string, keyVersion: number): Buffer {
  return Buffer.from(`canon:source-credential:v${keyVersion}:${sourceId}`, "utf8");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

/**
 * Seal a small payload into a single opaque string, for a cookie.
 *
 * The OAuth flow needs to carry a PKCE `code_verifier` and the pending source
 * across a redirect to a third party and back. Three options: a database table,
 * a server session, or a sealed cookie. The cookie wins here because the state
 * is single-use, expires in minutes, and adding a table for it would mean rows
 * that outlive the flow and have to be swept.
 *
 * `purpose` becomes the AAD, so a cookie sealed for the OAuth flow cannot be
 * replayed anywhere else even though the key is the same.
 *
 * Format: `v<version>.<iv>.<tag>.<ciphertext>`, base64url, cookie-safe.
 */
export function sealToken(payload: Record<string, string>, purpose: string): string {
  const key = keyFor(CURRENT_KEY_VERSION);
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(`canon:${purpose}`, "utf8"));

  const sealed = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);

  return [
    `v${CURRENT_KEY_VERSION}`,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    sealed.toString("base64url"),
  ].join(".");
}

/**
 * Open a `sealToken` string. Returns null on ANY failure.
 *
 * Null rather than throwing: every caller is handling a value that arrived from
 * a browser, where expired, absent, truncated and forged are all normal inputs
 * that deserve the same "start the flow again" answer. A thrown error here
 * would turn a stale cookie into a 500.
 */
export function openToken(token: string, purpose: string): Record<string, string> | null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;

  const [versionTag, ivPart, tagPart, ciphertextPart] = parts;
  const version = Number(versionTag.slice(1));
  if (!versionTag.startsWith("v") || !Number.isInteger(version)) return null;

  try {
    const iv = Buffer.from(ivPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;

    const decipher = createDecipheriv("aes-256-gcm", keyFor(version), iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(`canon:${purpose}`, "utf8"));
    decipher.setAuthTag(tag);

    const opened = Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, "base64url")),
      decipher.final(),
    ]);

    const parsed: unknown = JSON.parse(opened.toString("utf8"));
    return isStringRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** A URL-safe random string, for OAuth `state` and PKCE verifiers. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** S256 PKCE challenge for a verifier (RFC 7636 §4.2). */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

/**
 * Constant-time string comparison, for OAuth `state` and anything else where a
 * timing difference would leak how much of a guess was right.
 *
 * The length check is intentionally not constant-time: length is not the secret,
 * and `timingSafeEqual` throws on a mismatch rather than returning false.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
