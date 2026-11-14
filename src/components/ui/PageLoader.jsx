export function PageLoader() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-sm text-slate-500"
    >
      <span
        className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600"
        aria-hidden="true"
      />
      <span>Loading workspace…</span>
    </div>
  );
}
