export default function Loading() {
  return (
    <div
      role="status"
      aria-label="正在加载页面"
      className="space-y-6 motion-safe:animate-pulse"
    >
      <div className="h-8 w-64 rounded bg-muted" />
      <div className="h-4 w-3/4 rounded bg-muted" />
      <div className="h-72 rounded-xl border bg-card" />
      <span className="sr-only">正在加载页面…</span>
    </div>
  );
}
