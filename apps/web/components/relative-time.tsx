"use client";
import { useEffect, useState } from "react";
import { formatAbsolute, relativeTime } from "@/lib/format";

/**
 * Renders a relative timestamp. The first render (SSR + hydration) shows the
 * absolute UTC value so server and client markup match; the effect swaps in
 * the relative string once mounted.
 */
export function RelativeTime({ iso }: { iso: string | null }) {
  const [text, setText] = useState(() => (iso ? formatAbsolute(iso) : "—"));
  useEffect(() => {
    setText(relativeTime(iso));
  }, [iso]);
  return <time dateTime={iso ?? undefined}>{text}</time>;
}