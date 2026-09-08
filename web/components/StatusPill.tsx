export function StatePill({ state, styles, labels }: { state: string; styles: Record<string, string>; labels: Record<string, string> }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[state] ?? "bg-ink/5 text-ink/60"}`}>
      {labels[state] ?? state}
    </span>
  );
}
