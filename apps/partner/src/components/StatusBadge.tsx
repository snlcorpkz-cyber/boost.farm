const STYLES: Record<string, string> = {
  pending:   'bg-amber-50 text-amber-700 ring-amber-200',
  approved:  'bg-blue-50 text-blue-700 ring-blue-200',
  paid:      'bg-emerald-50 text-emerald-700 ring-emerald-200',
  rejected:  'bg-rose-50 text-rose-700 ring-rose-200',
  duplicate: 'bg-gray-100 text-gray-600 ring-gray-300',

  queued:    'bg-amber-50 text-amber-700 ring-amber-200',
  sent:      'bg-emerald-50 text-emerald-700 ring-emerald-200',
  failed:    'bg-rose-50 text-rose-700 ring-rose-200',
  dead:      'bg-gray-100 text-gray-600 ring-gray-300',

  active:    'bg-emerald-50 text-emerald-700 ring-emerald-200',
  draft:     'bg-amber-50 text-amber-700 ring-amber-200',
  paused:    'bg-gray-100 text-gray-700 ring-gray-300',
  archived:  'bg-gray-100 text-gray-500 ring-gray-300',
};

export function StatusBadge({ status }: { status: string }) {
  const cls = STYLES[status] ?? 'bg-gray-100 text-gray-700 ring-gray-300';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
      {status}
    </span>
  );
}
