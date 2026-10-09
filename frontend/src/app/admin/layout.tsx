"use client";

import { DashboardShell } from "@/components/layout/dashboard-shell";
import { adminNav } from "@/config/nav";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell nav={adminNav} title="Administration" allowedRoles={["ADMIN", "OPERATOR"]}>
      {children}
    </DashboardShell>
  );
}
