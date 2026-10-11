"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, LogOut, Menu, X, type LucideIcon } from "lucide-react";
import { site } from "@/config/site";
import { whatsappLink } from "@/lib/format";
import { WhatsAppIcon } from "./whatsapp-button";
import { api } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import type { Role, User } from "@/lib/types";
import { Spinner } from "@/components/ui/feedback";
import { Logo, LogoMark } from "./logo";
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

export interface MobileNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  /** Bouton central mis en avant */
  primary?: boolean;
}

export function DashboardShell({
  nav,
  mobileNav = [],
  focusRoutes = [],
  children,
  allowedRoles,
  title,
}: {
  nav: NavItem[];
  /** Barre de navigation basse sur mobile (4 entrées max + « Menu ») */
  mobileNav?: MobileNavItem[];
  /** Pages en mode « focus » (parcours de commande) : barre basse masquée */
  focusRoutes?: string[];
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

  if (isLoading || !user || (allowedRoles && !allowedRoles.includes(user.role))) {
    return <Spinner className="min-h-screen" label="Chargement de votre espace…" />;
  }

  const showBottomNav = mobileNav.length > 0 && !focusRoutes.some((r) => pathname === r);
  const mobileActiveHref = mobileNav
    .filter((m) => (m.exact ? pathname === m.href : pathname === m.href || pathname.startsWith(`${m.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
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
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors lg:py-2.5",
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
        <a
          href={whatsappLink(site.whatsapp, "Bonjour Print & Secrétariat, j'ai besoin d'aide.")}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-green-300 hover:bg-white/10 lg:hidden"
        >
          <WhatsAppIcon className="size-[18px]" /> Assistance WhatsApp
        </a>
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
          <aside className="absolute inset-y-0 left-0 w-[82vw] max-w-72 overflow-y-auto bg-sidebar shadow-xl">
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
            <button className="-ml-1.5 rounded-md p-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Ouvrir le menu">
              <Menu className="size-5" />
            </button>
            <Link href={nav[0]?.href ?? "/"} className="lg:hidden" aria-label="Tableau de bord">
              <LogoMark className="size-7" />
            </Link>
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
        <main className={cn("mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-6 lg:py-8", showBottomNav && "pb-28 lg:pb-8")}>{children}</main>
      </div>
      {showBottomNav && (
        <nav
          className="fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgb(15_23_42/0.06)] backdrop-blur lg:hidden"
          aria-label="Navigation principale mobile"
        >
          <ul className="mx-auto grid max-w-md grid-cols-5">
            {mobileNav.slice(0, 4).map((item) => {
              const isMobileActive = item.href === mobileActiveHref;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn("relative flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", isMobileActive ? "text-primary" : "text-slate-500")}
                    aria-current={isMobileActive ? "page" : undefined}
                  >
                    {item.primary ? (
                      <span className="-mt-[26px] flex size-12 items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-blue-900/25 ring-4 ring-white">
                        <item.icon className="size-6" aria-hidden />
                      </span>
                    ) : (
                      <item.icon className="size-[22px]" aria-hidden />
                    )}
                    <span className="max-w-full truncate px-1">{item.label}</span>
                    {item.href.endsWith("/notifications") && (notif?.unread ?? 0) > 0 && (
                      <span className="absolute top-2 left-1/2 ml-1.5 min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] font-bold text-white">{notif?.unread}</span>
                    )}
                  </Link>
                </li>
              );
            })}
            <li>
              <button onClick={() => setOpen(true)} className="flex h-16 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-slate-500" aria-label="Ouvrir le menu complet">
                <Menu className="size-[22px]" aria-hidden />
                Menu
              </button>
            </li>
          </ul>
        </nav>
      )}
    </div>
  );
}
