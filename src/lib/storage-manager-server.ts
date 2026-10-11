import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { DOMParser } from '@xmldom/xmldom';
import { getMinioConfig, ensureMinioRunning } from '@/lib/minio-runtime';
import { getMinioCredentials } from '@/lib/minio-s3';
import { parseStorageKeywords, type StorageGroup } from '@/lib/storage-manager';

function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

// Authenticated S3 requests, always scoped to the configured MinIO bucket.
export async function storageRequest(method: 'GET' | 'HEAD' | 'DELETE', key?: string, query: Record<string, string> = {}) {
  if (key?.split('/').some(segment => segment === '.' || segment === '..')) {
    throw new Error('This file path contains dot segments and cannot be safely deleted here.');
  }
  const { baseUrl, bucket } = getMinioConfig();
  const { accessKey, secretKey } = getMinioCredentials();
  const endpoint = new URL(baseUrl);
  const path = `${endpoint.pathname.replace(/\/$/, '')}/${encode(bucket)}/${key === undefined ? '' : key.split('/').map(encode).join('/')}`;
  const canonicalQuery = Object.entries(query).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `${encode(name)}=${encode(value)}`).join('&');
  const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = timestamp.slice(0, 8);
  const scope = `${date}/us-east-1/s3/aws4_request`;
  const payloadHash = createHash('sha256').update('').digest('hex');
  const headers = `host:${endpoint.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${timestamp}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [method, path, canonicalQuery, headers, signedHeaders, payloadHash].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', timestamp, scope, createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, date), 'us-east-1'), 's3'), 'aws4_request');
  const signature = hmac(signingKey, stringToSign).toString('hex');
  return fetch(`${endpoint.origin}${path}${canonicalQuery ? `?${canonicalQuery}` : ''}`, {
    method,
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
    headers: {
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': timestamp,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  });
}

type DeleteApproval = { key: string; etag: string; size: number; keyword: string; bucket: string; baseUrl: string; expires: number };

function approvalSignature(payload: string): Buffer {
  return hmac(getMinioCredentials().secretKey, `storage-manager:${payload}`);
}

function approveFile(file: Omit<DeleteApproval, 'expires' | 'bucket' | 'baseUrl'>): string {
  const payload = Buffer.from(JSON.stringify({ ...file, ...getMinioConfig(), expires: Date.now() + 60 * 60 * 1000 })).toString('base64url');
  return `${payload}.${approvalSignature(payload).toString('base64url')}`;
}

export async function previewStorage(input: string): Promise<StorageGroup[]> {
  const keywords = parseStorageKeywords(input);
  if (!keywords.length || keywords.length > 100 || input.length > 10_000) throw new Error('Enter between 1 and 100 comma-separated keywords.');
  await ensureMinioRunning();
  const groups: StorageGroup[] = keywords.map(keyword => ({ keyword, files: [] }));
  let continuation = '';
  const seenTokens = new Set<string>();
  do {
    const response = await storageRequest('GET', undefined, {
      'list-type': '2', 'max-keys': '1000', ...(continuation ? { 'continuation-token': continuation } : {}),
    });
    if (!response.ok) throw new Error(`Unable to list MinIO files (${response.status}).`);
    const document = new DOMParser({ onError: (_level, message) => { throw new Error(message); } }).parseFromString(await response.text(), 'application/xml');
    const contents = document.getElementsByTagName('Contents');
    for (let index = 0; index < contents.length; index++) {
      const entry = contents.item(index)!;
      const key = entry.getElementsByTagName('Key').item(0)?.textContent || '';
      const group = groups.find(group => key.toLowerCase().includes(group.keyword));
      if (!group) continue;
      const size = Number(entry.getElementsByTagName('Size').item(0)?.textContent);
      const etag = entry.getElementsByTagName('ETag').item(0)?.textContent || '';
      if (!key || !etag || !Number.isFinite(size)) throw new Error('MinIO returned an invalid file entry.');
      group.files.push({ key, size, token: approveFile({ key, size, etag, keyword: group.keyword }) });
    }
    const truncated = document.getElementsByTagName('IsTruncated').item(0)?.textContent === 'true';
    continuation = truncated ? document.getElementsByTagName('NextContinuationToken').item(0)?.textContent || '' : '';
    if (truncated && (!continuation || seenTokens.has(continuation))) throw new Error('MinIO listing could not continue. Please preview again.');
    if (continuation) seenTokens.add(continuation);
  } while (continuation);
  return groups;
}

export async function deletePreviewedFile(token: string): Promise<'deleted' | 'missing'> {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) throw new Error('Invalid deletion approval. Preview again.');
  const expected = approvalSignature(payload);
  const received = Buffer.from(signature, 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error('Invalid deletion approval. Preview again.');
  const file: DeleteApproval = JSON.parse(Buffer.from(payload, 'base64url').toString());
  const config = getMinioConfig();
  if (file.expires < Date.now() || file.bucket !== config.bucket || file.baseUrl !== config.baseUrl) throw new Error('Preview expired or storage configuration changed. Preview again.');
  await ensureMinioRunning();
  const head = await storageRequest('HEAD', file.key);
  if (head.status === 404) return 'missing';
  if (!head.ok) throw new Error(`Unable to check file (${head.status}).`);
  if (head.headers.get('etag') !== file.etag || Number(head.headers.get('content-length')) !== file.size) throw new Error('File changed since preview. Preview again before deleting it.');
  const response = await storageRequest('DELETE', file.key);
  if (!response.ok) throw new Error(`Unable to delete file (${response.status}).`);
  return 'deleted';
}
