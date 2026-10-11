"use client";

import { DashboardShell } from "@/components/layout/dashboard-shell";
import { customerMobileNav, customerNav, focusRoutes } from "@/config/nav";

export default function EspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell nav={customerNav} mobileNav={customerMobileNav} focusRoutes={focusRoutes} title="Espace client">
      {children}
    </DashboardShell>
  );
}
