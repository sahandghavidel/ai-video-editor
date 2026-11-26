import type { StorageDeleteResult, StorageMatch } from '@/lib/storage-manager';

class StorageRequestError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}

export async function requestStorage(body: Record<string, string | string[]>) {
  const response = await fetch('/api/storage-manager', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new StorageRequestError(data.error || 'Storage request failed.', data.code);
  return data;
}

export async function deleteStorageBatch(files: StorageMatch[]): Promise<StorageDeleteResult[]> {
  const data = await requestStorage({ action: 'deleteBatch', tokens: files.map(file => file.token) });
  return data.results;
}
