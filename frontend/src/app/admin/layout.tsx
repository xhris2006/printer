"use client";

import { DashboardShell } from "@/components/layout/dashboard-shell";
import { adminMobileNav, adminNav } from "@/config/nav";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell nav={adminNav} mobileNav={adminMobileNav} title="Administration" allowedRoles={["ADMIN", "OPERATOR"]}>
      {children}
    </DashboardShell>
  );
}
