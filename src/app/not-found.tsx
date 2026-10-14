import Link from "next/link";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center gap-5 px-6 text-center">
      <Compass className="size-10 text-primary" />
      <p className="text-xs tracking-widest text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold">没有找到这个页面或训练</h1>
      <p className="text-sm text-muted-foreground">
        检查链接，或回到为你推荐重新开始。
      </p>
      <Link
        href="/dashboard"
        className="rounded-lg bg-primary px-5 py-3 text-sm text-primary-foreground"
      >
        回到为你推荐
      </Link>
    </main>
  );
}
