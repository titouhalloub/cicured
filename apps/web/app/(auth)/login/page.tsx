"use client";
import { Button } from "@/components/ui/button";
import { GitHubIcon } from "@/components/github-icon";
import { API_BASE } from "@/lib/api";

/** Centered hero; the button hands off to the API's GitHub OAuth redirect. */
export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-surface-light px-6 dark:bg-surface-dark">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="text-2xl font-medium tracking-tight">cicured</span>
        <p className="text-sm text-text-muted-light dark:text-text-muted-dark">
          Build &amp; repair intelligence for repositories
        </p>
      </div>

      <Button
        onClick={() => {
          window.location.href = `${API_BASE}/auth/github`;
        }}
        className="h-12 w-full max-w-sm gap-2 rounded-input bg-brand-primary text-base text-white shadow-[0_18px_40px_rgba(67,24,255,0.25)] hover:bg-brand-primary/90"
      >
        <GitHubIcon className="h-5 w-5" />
        Sign in with GitHub
      </Button>

      <p className="text-xs text-text-muted-light dark:text-text-muted-dark">
        You&apos;ll be redirected to GitHub to authorize cicured.
      </p>
    </div>
  );
}
