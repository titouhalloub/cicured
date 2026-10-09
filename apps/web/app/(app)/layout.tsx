"use client";
import { useEffect, useState } from "react";
import { DesktopSidebar, SidebarContent } from "@/components/app-shell/sidebar";
import { Topbar } from "@/components/app-shell/topbar";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Toaster } from "sonner";

const STORAGE_KEY = "cicured-sidebar-collapsed";

/** Authenticated shell: fixed sidebar + sticky topbar + centered content area. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // localStorage is read after mount so SSR and hydration markup match.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored !== null) setCollapsed(stored === "1");
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  };

  return (
    <div className="min-h-screen">
      <DesktopSidebar collapsed={collapsed} />

      {/* Off-canvas navigation for the mobile (<md) breakpoint. */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-[290px] p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className={collapsed ? "md:pl-[88px] lg:pl-[88px]" : "md:pl-[88px] lg:pl-[290px]"}>
        <Topbar onToggleSidebar={toggleCollapsed} onOpenMenu={() => setMenuOpen(true)} />
        <main className="mx-auto flex max-w-[1200px] flex-col gap-6 p-6 lg:p-8">{children}</main>
      </div>

      <Toaster position="top-right" richColors />
    </div>
  );
}
