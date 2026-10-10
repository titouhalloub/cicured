"use client";
import { useTheme } from "next-themes";
import { Bell, LogOut, Menu, Moon, PanelLeft, Search, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";

// TODO(M4b-2): replace with the real session user from GET /auth/me.
const STUB_USER = { name: "Demo User", email: "demo@example.com" };

interface TopbarProps {
  onToggleSidebar: () => void;
  onOpenMenu: () => void;
}

export function Topbar({ onToggleSidebar, onOpenMenu }: TopbarProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const signOut = async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {
      // Session may already be gone (or the API is down) - leave regardless.
    }
    window.location.href = "/login";
  };

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-black/5 bg-surface-light/80 px-4 backdrop-blur dark:border-white/10 dark:bg-surface-dark/80 lg:px-8">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label="Open navigation"
        onClick={onOpenMenu}
      >
        <Menu className="h-5 w-5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="hidden md:inline-flex"
        aria-label="Toggle sidebar"
        onClick={onToggleSidebar}
      >
        <PanelLeft className="h-5 w-5" />
      </Button>
      <span className="text-lg font-medium md:hidden">cicured</span>

      {/* Search is placeholder-only for M4b-1 - no search endpoint yet. */}
      <div className="relative ml-2 hidden w-full max-w-sm md:block">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted-light dark:text-text-muted-dark" />
        <Input
          disabled
          placeholder="Search..."
          aria-label="Search (coming soon)"
          className="h-10 rounded-input bg-card-light pl-9 dark:bg-card-dark"
        />
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          onClick={() => setTheme(isDark ? "light" : "dark")}
        >
          {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>

        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell className="h-5 w-5" />
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-brand-error" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="ml-1 h-10 w-10 rounded-full p-0">
              <Avatar>
                <AvatarFallback className="bg-brand-primary/10 text-brand-primary">
                  {STUB_USER.name
                    .split(" ")
                    .map((part) => part[0])
                    .join("")}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <span className="block truncate text-sm font-medium">{STUB_USER.name}</span>
              <span className="block truncate text-xs font-normal text-text-muted-light dark:text-text-muted-dark">
                {STUB_USER.email}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void signOut()}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
