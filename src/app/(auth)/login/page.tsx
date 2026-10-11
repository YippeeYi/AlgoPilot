import { AuthPreview } from "@/components/auth-preview";
import { AuthForm } from "@/components/auth-form";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { safeNext } from "@/lib/auth/redirect";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return getSupabaseConfig() ? (
    <AuthForm
      next={safeNext(params.next)}
      confirmationError={params.error === "confirmation"}
    />
  ) : (
    <AuthPreview />
  );
}
