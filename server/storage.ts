import { ENV } from "./_core/env";
import { getSupabaseAdminClient } from "./_core/supabaseAdmin";

let bucketReadyPromise: Promise<void> | null = null;

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function getBucketName() {
  const bucket = ENV.supabaseStorageBucket.trim();
  if (!bucket) {
    throw new Error("SUPABASE_STORAGE_BUCKET no esta configurado");
  }
  return bucket;
}

function getSignedUrlTtl() {
  const seconds = ENV.supabaseStorageSignedUrlSeconds;
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 3600;
}

function isMissingBucketError(error: unknown) {
  const anyError = error as {
    status?: number;
    statusCode?: number | string;
    message?: string;
    name?: string;
  };
  const status = Number(anyError?.status ?? anyError?.statusCode);
  const message = String(anyError?.message ?? "").toLowerCase();
  return (
    status === 404 ||
    message.includes("bucket not found") ||
    message.includes("not found")
  );
}

async function ensureBucketExists() {
  const supabase = getSupabaseAdminClient();
  const bucket = getBucketName();
  const { error: getError } = await supabase.storage.getBucket(bucket);

  if (!getError) return;
  if (!isMissingBucketError(getError)) {
    throw new Error(`Supabase Storage bucket check failed: ${getError.message}`);
  }

  const { error: createError } = await supabase.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: "10MB",
    allowedMimeTypes: [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
    ],
  });

  if (createError && !isMissingBucketError(createError)) {
    throw new Error(
      `Supabase Storage bucket creation failed: ${createError.message}`
    );
  }
}

async function ensureStorageReady() {
  if (!bucketReadyPromise) {
    bucketReadyPromise = ensureBucketExists().catch(error => {
      bucketReadyPromise = null;
      throw error;
    });
  }
  return bucketReadyPromise;
}

async function createSignedUrl(key: string) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.storage
    .from(getBucketName())
    .createSignedUrl(key, getSignedUrlTtl());

  if (error || !data?.signedUrl) {
    throw new Error(
      `Supabase Storage signed URL failed: ${error?.message ?? "No URL returned"}`
    );
  }

  return data.signedUrl;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  await ensureStorageReady();

  const supabase = getSupabaseAdminClient();
  const key = normalizeKey(relKey);
  const body =
    typeof data === "string" ? Buffer.from(data) : Buffer.from(data as any);
  const { error } = await supabase.storage.from(getBucketName()).upload(key, body, {
    cacheControl: "3600",
    contentType,
    upsert: false,
  });

  if (error) {
    throw new Error(`Supabase Storage upload failed: ${error.message}`);
  }

  return {
    key,
    url: await createSignedUrl(key),
  };
}

export async function storageGet(
  relKey: string
): Promise<{ key: string; url: string }> {
  await ensureStorageReady();

  const key = normalizeKey(relKey);
  return {
    key,
    url: await createSignedUrl(key),
  };
}

export async function storageDelete(relKey: string): Promise<{ key: string }> {
  await ensureStorageReady();

  const supabase = getSupabaseAdminClient();
  const key = normalizeKey(relKey);
  const { error } = await supabase.storage.from(getBucketName()).remove([key]);

  if (error && !isMissingBucketError(error)) {
    throw new Error(`Supabase Storage delete failed: ${error.message}`);
  }

  return { key };
}
