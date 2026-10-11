import type { TrainingSession } from "@/lib/validation/m1";

export function displayedSeconds(
  session: Pick<TrainingSession, "active_seconds" | "status" | "resumed_at">,
  nowMs: number,
) {
  const start = session.resumed_at ? Date.parse(session.resumed_at) : NaN;
  const running =
    session.status === "active" && Number.isFinite(start)
      ? Math.max(0, Math.floor((nowMs - start) / 1000))
      : 0;
  return session.active_seconds + running;
}
export function formatSeconds(seconds: number) {
  return [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}
