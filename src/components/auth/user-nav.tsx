"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { LogOut, User as UserIcon } from "lucide-react";

interface UserNavProps {
  user: {
    name?: string | null;
    email: string;
  };
}

export default function UserNav({ user }: UserNavProps) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push("/sign-in");
          router.refresh();
        },
      },
    });
  };

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <UserIcon className="h-3.5 w-3.5" />
        <span className="font-medium text-foreground">
          {user.name || user.email}
        </span>
      </div>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={signingOut}
        className="group inline-flex items-center gap-1 bg-transparent p-0 text-xs text-muted-foreground outline-none transition-colors duration-200 hover:text-white disabled:pointer-events-none disabled:opacity-40"
      >
        <LogOut className="h-3 w-3 shrink-0 transition-colors duration-200 group-hover:text-white" />
        <span className="transition-colors duration-200 group-hover:text-white">
          {signingOut ? "Signing out..." : "Sign out"}
        </span>
      </button>
    </div>
  );
}
