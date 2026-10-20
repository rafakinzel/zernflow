"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Two questions, kept apart.
 *
 * Flow is about what the automations did with the people who arrived.
 * Profile is about the account that brought them. Mixing the two on one
 * screen means neither gets read: the numbers answer to different decisions
 * and move on different timescales.
 */
const TABS = [
  { name: "Flow", href: "/dashboard/analytics" },
  { name: "Profile", href: "/dashboard/analytics/profile" },
];

export function AnalyticsTabs() {
  const pathname = usePathname();

  return (
    <div className="flex gap-1 border-b border-border px-6">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.name}
          </Link>
        );
      })}
    </div>
  );
}
