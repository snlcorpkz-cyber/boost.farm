export function formatUsd(cents: number | null | undefined): string {
  const n = cents ?? 0;
  return `$${(n / 100).toFixed(2)}`;
}

export function formatInt(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString('en-US');
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso ?? '—';
  }
}

export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
  } catch {
    return iso ?? '—';
  }
}
