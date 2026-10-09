import { DashboardShell } from "@/components/layout/dashboard-shell";
import { customerNav } from "@/config/nav";

export default function EspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell nav={customerNav} title="Espace client">
      {children}
    </DashboardShell>
  );
}
