import type { StorageMatch } from '@/lib/storage-manager';

class StorageRequestError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}

export async function requestStorage(body: Record<string, string>) {
  const response = await fetch('/api/storage-manager', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new StorageRequestError(data.error || 'Storage request failed.', data.code);
  return data;
}

export async function deleteStorageMatch(file: StorageMatch): Promise<'deleted' | 'missing'> {
  let token = file.token;
  const renew = async () => {
    const approval = await requestStorage({ action: 'renew', token });
    token = approval.token;
  };
  // Renew only when the next file reaches the front of the queue. This works
  // for arbitrarily long runs without re-approving the entire remaining list.
  if (!file.expiresAt || file.expiresAt <= Date.now() + 60_000) await renew();
  try {
    return (await requestStorage({ action: 'delete', token })).result;
  } catch (error) {
    // Server time is authoritative, including clock skew or a sleeping tab.
    if (!(error instanceof StorageRequestError) || error.code !== 'APPROVAL_EXPIRED') throw error;
    await renew();
    return (await requestStorage({ action: 'delete', token })).result;
  }
}
