import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-surface-light dark:bg-surface-dark">
      <header className="mx-auto flex max-w-[1200px] items-center justify-between px-6 py-6">
        <span className="text-lg font-medium">cicured</span>
        <Link href="/login">
          <Button variant="ghost" size="sm">Sign in</Button>
        </Link>
      </header>

      <main className="mx-auto max-w-[900px] px-6">
        <section className="flex flex-col items-center gap-6 py-24 text-center">
          <h1 className="text-5xl font-medium tracking-tight">cicured</h1>
          <p className="max-w-[560px] text-lg text-text-muted-light dark:text-text-muted-dark">
            CI that doesn&apos;t just tell you it broke — it tells you why
            and how to fix it.
          </p>
          <Link href="/login">
            <Button size="lg">Sign in with GitHub</Button>
          </Link>
        </section>

        <section className="grid gap-6 py-16 md:grid-cols-3">
          <Feature
            title="Real build diagnosis"
            body="We run your build in an isolated sandbox and read the actual tsc, eslint, and test output. No guessing from a diff."
          />
          <Feature
            title="AI patches, not prose"
            body="Every finding gets a schema-validated unified diff you can review before applying. Never auto-applied."
          />
          <Feature
            title="Live logs"
            body="Watch the sandbox run in real time. Every line, streamed to your browser."
          />
        </section>
      </main>

      <footer className="mx-auto max-w-[1200px] border-t border-white/10 px-6 py-8 text-sm text-text-muted-light dark:text-text-muted-dark">
        cicured is a private beta. Built by one person.
      </footer>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-card bg-card-light p-6 dark:bg-card-dark">
      <h3 className="text-base font-medium">{title}</h3>
      <p className="mt-2 text-sm text-text-muted-light dark:text-text-muted-dark">
        {body}
      </p>
    </div>
  );
}
