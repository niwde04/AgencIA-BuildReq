import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

type DigestProvider = Pick<SubtleCrypto, "digest">;

export async function sha256Bytes(
  bytes: Uint8Array,
  digestProvider: DigestProvider | undefined = globalThis.crypto?.subtle
) {
  const input = Uint8Array.from(bytes);

  if (digestProvider) {
    try {
      const digest = await digestProvider.digest("SHA-256", input);
      return bytesToHex(new Uint8Array(digest));
    } catch {
      // Some embedded QR browsers expose crypto.subtle but reject digest().
      // Fall through to the audited local JavaScript implementation.
    }
  }

  return bytesToHex(sha256(input));
}

export async function sha256File(file: File) {
  return sha256Bytes(new Uint8Array(await file.arrayBuffer()));
}
