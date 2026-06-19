/**
 * Minimal S3 v4 presigned-URL generator for MinIO.
 *
 * Uses only Node.js built-in `crypto` — no AWS SDK dependency needed.
 * Supports single-object PUT presigned URLs (sufficient for files ≤ 5 GB).
 */

import { createHmac, createHash } from 'crypto';

// ─── types ──────────────────────────────────────────────────────────

interface MinioCredentials {
  accessKey: string;
  secretKey: string;
}

interface PresignOptions {
  /** e.g. "https://minio.example.com" */
  baseUrl: string;
  bucket: string;
  /** Object key (path inside the bucket) */
  key: string;
  contentType: string;
  /** TTL in seconds (default 3600) */
  expires?: number;
}

// ─── credential helpers ─────────────────────────────────────────────

/**
 * Returns the MinIO root credentials from environment variables.
 * Uses MINIO_ROOT_USER / MINIO_ROOT_PASSWORD which your setup already defines.
 */
export function getMinioCredentials(): MinioCredentials {
  const accessKey = process.env.MINIO_ROOT_USER?.trim();
  const secretKey = process.env.MINIO_ROOT_PASSWORD?.trim();

  if (!accessKey || !secretKey) {
    throw new Error(
      'Missing MinIO credentials. Set MINIO_ROOT_USER and MINIO_ROOT_PASSWORD in .env.local',
    );
  }

  return { accessKey, secretKey };
}

// ─── S3 v4 signing ─────────────────────────────────────────────────

const ALGORITHM = 'AWS4-HMAC-SHA256';
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function formatDate(date: Date): string {
  return (
    date.getUTCFullYear().toString() +
    pad2(date.getUTCMonth() + 1) +
    pad2(date.getUTCDate()) +
    'T' +
    pad2(date.getUTCHours()) +
    pad2(date.getUTCMinutes()) +
    pad2(date.getUTCSeconds()) +
    'Z'
  );
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Generate a presigned PUT URL for uploading a file to MinIO/S3.
 *
 * The URL allows the browser to PUT directly to MinIO without any
 * server-side proxying — the file never touches Next.js.
 */
export function generatePresignedPutUrl(opts: PresignOptions): string {
  const { baseUrl, bucket, key, expires = 3600 } = opts;

  const { accessKey, secretKey } = getMinioCredentials();
  const endpoint = new URL(`${baseUrl}/${bucket}/${key}`);
  const host = endpoint.host;
  const now = new Date();
  const timestamp = formatDate(now);

  // Scope
  const dateStamp = timestamp.slice(0, 8); // YYYYMMDD
  const region = 'us-east-1'; // MinIO default region
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;

  // Canonical query string — must be in alphabetical order
  const queryParams: Record<string, string> = {
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${accessKey}/${credentialScope}`,
    'X-Amz-Date': timestamp,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };

  const canonicalQueryString = Object.keys(queryParams)
    .sort()
    .map(
      (k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`,
    )
    .join('&');

  // Canonical request
  const canonicalRequest = [
    'PUT',
    `/${bucket}/${key}`,
    canonicalQueryString,
    `host:${host}`,
    '',
    'host',
    UNSIGNED_PAYLOAD,
  ].join('\n');

  // String to sign
  const stringToSign = [
    ALGORITHM,
    timestamp,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  // Signing key
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');

  const signature = createHmac('sha256', kSigning)
    .update(stringToSign)
    .digest('hex');

  // Final URL
  const presignedUrl =
    `${endpoint.origin}${endpoint.pathname}?${canonicalQueryString}` +
    `&X-Amz-Signature=${signature}`;

  return presignedUrl;
}
