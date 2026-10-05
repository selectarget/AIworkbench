import type { ApiResult } from '@shared/contracts';

export function unwrap<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}
