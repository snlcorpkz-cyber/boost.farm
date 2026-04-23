interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
}

export function EmptyState({ icon = '📭', title, description, children }: EmptyStateProps) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
      <div className="mx-auto mb-3 text-4xl">{icon}</div>
      <p className="text-base font-semibold text-gray-900">{title}</p>
      {description && <p className="mt-1.5 text-sm text-gray-500 max-w-md mx-auto">{description}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
