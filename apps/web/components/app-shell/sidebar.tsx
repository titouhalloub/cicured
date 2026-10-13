"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderGit2, LayoutDashboard, PlayCircle, Settings, Zap } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useMe } from "@/lib/queries";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/app", icon: LayoutDashboard },
  { label: "Projects", href: "/app/projects", icon: FolderGit2 },
  { label: "Runs", href: "/app/runs", icon: PlayCircle },
  // TODO(M4b-3): settings page does not exist yet.
  { label: "Settings", href: "/app/settings", icon: Settings, disabled: true },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

interface SidebarContentProps {
  collapsed?: boolean;
  onNavigate?: () => void;
}

/** Logo + nav links + user card, shared by the desktop sidebar and the mobile sheet. */
export function SidebarContent({ collapsed = false, onNavigate }: SidebarContentProps) {
  const pathname = usePathname();
  const { data: me } = useMe();
  const userEmail = me?.email ?? "—";
  const userPlan = me?.plan ?? "";
  const userInitial = me?.email ? me.email[0]!.toUpperCase() : "U";
  const labelClass = collapsed ? "hidden" : "hidden lg:inline";

  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link href="/" onClick={onNavigate} className="flex items-center gap-3 px-2 py-1">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-primary text-white">
          <Zap className="h-5 w-5" />
        </span>
        <span className={cn("text-xl font-medium tracking-tight", labelClass)}>cicured</span>
      </Link>

      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.disabled ? "#" : item.href}
              title={item.disabled ? `${item.label} — coming soon` : item.label}
              onClick={(event) => {
                if (item.disabled) {
                  event.preventDefault();
                  return;
                }
                onNavigate?.();
              }}
              aria-disabled={item.disabled}
              className={cn(
                "sidebar-link",
                active && !item.disabled && "sidebar-link-active",
                item.disabled && "cursor-not-allowed opacity-50",
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className={labelClass}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Session user card, from GET /auth/me via useMe() (M4b-2). */}
      <div className="mt-auto flex items-center gap-3 rounded-2xl bg-surface-light p-3 dark:bg-white/5">
        <Avatar>
          <AvatarFallback className="bg-brand-primary/10 text-brand-primary">
            {userInitial}
          </AvatarFallback>
        </Avatar>
        <div className={cn("min-w-0", labelClass)}>
          <p className="truncate text-sm font-medium">{userEmail}</p>
          <p className="truncate text-xs text-text-muted-light dark:text-text-muted-dark">
            {userPlan}
          </p>
        </div>
      </div>
    </div>
  );
}

interface DesktopSidebarProps {
  collapsed: boolean;
}

/**
 * Fixed left rail: 290px on lg when expanded, icon-only on md and whenever
 * collapsed. On mobile the shell renders a sheet with the same content.
 */
export function DesktopSidebar({ collapsed }: DesktopSidebarProps) {
  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-black/5 bg-card-light dark:border-white/10 dark:bg-card-dark",
        "md:flex md:w-[88px]",
        collapsed ? "lg:w-[88px]" : "lg:w-[290px]",
      )}
    >
      <SidebarContent collapsed={collapsed} />
    </aside>
  );
}
