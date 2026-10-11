import Link from "next/link";
import { ArrowRight, Inbox } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function EmptyState({
  title,
  description,
  href,
  action,
}: {
  title: string;
  description: string;
  href?: string;
  action?: string;
}) {
  return (
    <Card className="shadow-none">
      <CardContent className="flex min-h-60 flex-col items-center justify-center px-6 py-10 text-center">
        <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-muted">
          <Inbox className="size-5 text-muted-foreground" aria-hidden="true" />
        </div>
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          {description}
        </p>
        {href && action && (
          <Link
            href={href}
            className="mt-5 flex items-center gap-2 text-sm font-medium text-primary"
          >
            {action}
            <ArrowRight className="size-4" />
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
