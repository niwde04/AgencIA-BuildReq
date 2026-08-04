import { describe, expect, it, vi } from "vitest";
import { sha256Bytes } from "../client/src/lib/file-sha256";

const ABC_SHA256 =
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

describe("file SHA-256", () => {
  const input = new TextEncoder().encode("abc");

  it("calculates the standard SHA-256 digest without Web Crypto", async () => {
    await expect(sha256Bytes(input, undefined)).resolves.toBe(ABC_SHA256);
  });

  it("falls back locally when an embedded browser rejects digest", async () => {
    const digest = vi.fn().mockRejectedValue(new Error("Not supported"));

    await expect(
      sha256Bytes(input, { digest } as unknown as Pick<SubtleCrypto, "digest">)
    ).resolves.toBe(ABC_SHA256);
    expect(digest).toHaveBeenCalledOnce();
  });
});
