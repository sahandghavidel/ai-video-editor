export type StorageMatch = {
  key: string;
  size: number;
  token: string;
};

export type StorageGroup = {
  keyword: string;
  files: StorageMatch[];
};

export function parseStorageKeywords(input: string): string[] {
  return [...new Set(input.split(',').map(value => value.trim().toLowerCase()).filter(Boolean))];
}

export function formatStorageSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index++; }
  return `${size.toFixed(1)} ${units[index]}`;
}
