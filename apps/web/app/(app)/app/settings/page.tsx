"use client";

import { useMe } from "@/lib/queries";

export default function SettingsPage() {
  const { data: me, isLoading } = useMe();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-medium">Settings</h1>
        <p className="mt-1 text-sm text-text-muted-light dark:text-text-muted-dark">
          Your account information and preferences.
        </p>
      </header>

      <section className="card">
        <h2 className="mb-4 text-lg font-medium">Account</h2>
        {isLoading ? (
          <p className="text-sm text-text-muted-light dark:text-text-muted-dark">Loading…</p>
        ) : (
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-text-muted-light dark:text-text-muted-dark">
                Email
              </dt>
              <dd className="mt-1 text-sm">{me?.email ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-text-muted-light dark:text-text-muted-dark">
                Plan
              </dt>
              <dd className="mt-1 text-sm capitalize">{me?.plan ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-text-muted-light dark:text-text-muted-dark">
                Member since
              </dt>
              <dd className="mt-1 text-sm">
                {me?.createdAt ? new Date(me.createdAt).toLocaleDateString() : "—"}
              </dd>
            </div>
          </dl>
        )}
      </section>
    </div>
  );
}
