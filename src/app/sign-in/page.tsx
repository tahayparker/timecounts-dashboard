import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import AuthForm from "@/components/auth/auth-form";
import { ClipboardClock } from "lucide-react";

export default async function SignInPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (session) {
    redirect("/");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <div className="mb-6 flex items-center gap-2.5">
        <ClipboardClock className="h-6 w-6 shrink-0" strokeWidth={2} />
        <span className="text-xl font-bold tracking-tight">timecounts</span>
      </div>
      <AuthForm />
    </div>
  );
}
