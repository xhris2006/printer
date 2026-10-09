"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, LogOut, Menu, X, type LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import type { Role, User } from "@/lib/types";
import { Spinner } from "@/components/ui/feedback";
import { Logo } from "./logo";
import { TestModeBanner } from "./test-mode-banner";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  roles?: Role[];
  exact?: boolean;
  /** Masque l'élément selon l'utilisateur */
  visible?: (user: User) => boolean;
}

export function DashboardShell({
  nav,
  children,
  allowedRoles,
  title,
}: {
  nav: NavItem[];
  children: React.ReactNode;
  allowedRoles?: Role[];
  title: string;
}) {
  const { data: user, isLoading } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: notif } = useQuery({
    queryKey: ["notifications", "count"],
    queryFn: () => api<{ unread: number }>("/notifications?pageSize=1"),
    enabled: Boolean(user),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (isLoading) return;
    if (!user) router.replace(`/connexion?next=${encodeURIComponent(pathname)}`);
    else if (allowedRoles && !allowedRoles.includes(user.role)) router.replace("/espace");
  }, [user, isLoading, allowedRoles, router, pathname]);

  useEffect(() => setOpen(false), [pathname]);

  if (isLoading || !user || (allowedRoles && !allowedRoles.includes(user.role))) {
    return <Spinner className="min-h-screen" label="Chargement de votre espace…" />;
  }

  const items = nav.filter((i) => (!i.roles || i.roles.includes(user.role)) && (!i.visible || i.visible(user)));
  const matches = (item: NavItem) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`));
  // L'élément actif est celui dont le chemin correspond le plus précisément
  const activeHref = items.filter(matches).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const isActive = (item: NavItem) => item.href === activeHref;

  const logout = async () => {
    await api("/auth/logout", { body: {} }).catch(() => undefined);
    qc.clear();
    router.replace("/connexion");
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-5 pb-6">
        <Logo dark />
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3" aria-label={title}>
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              isActive(item) ? "bg-sidebar-active text-white shadow-sm" : "text-sidebar-foreground/85 hover:bg-white/10 hover:text-white",
            )}
          >
            <item.icon className="size-[18px]" aria-hidden />
            <span className="flex-1">{item.label}</span>
            {item.href.endsWith("/notifications") && (notif?.unread ?? 0) > 0 && (
              <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white">{notif?.unread}</span>
            )}
          </Link>
        ))}
      </nav>
      <div className="border-t border-white/10 p-3">
        <div className="mb-2 px-3 text-xs text-sidebar-foreground/70">
          Connecté : <span className="font-semibold text-white">{user.fullName}</span>
        </div>
        <button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/85 hover:bg-white/10 hover:text-white">
          <LogOut className="size-[18px]" aria-hidden /> Déconnexion
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-sidebar lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-72 bg-sidebar shadow-xl">
            <button className="absolute top-4 right-3 rounded-md p-1.5 text-white/80 hover:bg-white/10" onClick={() => setOpen(false)} aria-label="Fermer le menu">
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="lg:pl-64">
        <TestModeBanner />
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b bg-white/90 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2">
            <button className="rounded-md p-1.5 lg:hidden" onClick={() => setOpen(true)} aria-label="Ouvrir le menu">
              <Menu className="size-5" />
            </button>
            <span className="text-sm font-semibold text-slate-700">{title}</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/espace/notifications" className="relative rounded-full p-2 hover:bg-muted" aria-label="Notifications">
              <Bell className="size-5 text-slate-600" />
              {(notif?.unread ?? 0) > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-red-500" />}
            </Link>
            <div className="flex size-8 items-center justify-center rounded-full bg-accent text-xs font-bold text-primary" aria-hidden>
              {user.fullName
                .split(" ")
                .map((p) => p[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
