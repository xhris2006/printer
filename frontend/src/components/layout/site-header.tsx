"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LayoutDashboard, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMe, isStaffRole } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";

const NAV = [
  { href: "/", label: "Accueil" },
  { href: "/services", label: "Nos services" },
  { href: "/comment-ca-marche", label: "Comment ça marche" },
  { href: "/tarifs", label: "Tarifs" },
  { href: "/contact", label: "Contact" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { data: user } = useMe();
  const dashboardHref = isStaffRole(user?.role) ? "/admin" : "/espace";

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/90 backdrop-blur">
      <div className="container-page flex h-16 items-center justify-between gap-4 sm:h-[72px]">
        <Logo />
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Navigation principale">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:text-primary",
                pathname === item.href ? "text-primary" : "text-slate-700",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          {user ? (
            <Button asChild>
              <Link href={dashboardHref}>
                <LayoutDashboard /> Mon espace
              </Link>
            </Button>
          ) : (
            <>
              <Button variant="outline" asChild>
                <Link href="/connexion">Se connecter</Link>
              </Button>
              <Button asChild>
                <Link href="/inscription">Créer un compte</Link>
              </Button>
            </>
          )}
        </div>
        <button className="rounded-md p-2 lg:hidden" onClick={() => setOpen((v) => !v)} aria-label={open ? "Fermer le menu" : "Ouvrir le menu"} aria-expanded={open}>
          {open ? <X className="size-6" /> : <Menu className="size-6" />}
        </button>
      </div>
      {open && (
        <div className="border-t bg-white lg:hidden">
          <nav className="container-page flex flex-col gap-1 py-3" aria-label="Navigation mobile">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className="rounded-md px-3 py-2.5 text-sm font-medium hover:bg-muted">
                {item.label}
              </Link>
            ))}
            <div className="mt-2 grid grid-cols-2 gap-2">
              {user ? (
                <Button asChild className="col-span-2">
                  <Link href={dashboardHref} onClick={() => setOpen(false)}>
                    Mon espace
                  </Link>
                </Button>
              ) : (
                <>
                  <Button variant="outline" asChild>
                    <Link href="/connexion" onClick={() => setOpen(false)}>
                      Se connecter
                    </Link>
                  </Button>
                  <Button asChild>
                    <Link href="/inscription" onClick={() => setOpen(false)}>
                      Créer un compte
                    </Link>
                  </Button>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
