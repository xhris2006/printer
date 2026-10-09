"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { formatDate, formatPhone } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import type { Paginated, Role, User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, EmptyState, PageHeader, Skeleton, Spinner } from "@/components/ui/feedback";
import { Input, NativeSelect } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Pagination } from "@/components/ui/navigation";
import { ActionDialog, type ActionConfig } from "@/components/admin/action-dialog";

const ROLE_LABELS: Record<Role, string> = { CUSTOMER: "Client", DELEGATE: "Délégué", OPERATOR: "Opérateur", ADMIN: "Administrateur" };
type Row = User & { ordersCount: number; lastLoginAt: string | null };

function UsersAdmin() {
  const params = useSearchParams();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [delegateStatus, setDelegateStatus] = useState(params.get("delegateStatus") ?? "");
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<ActionConfig | null>(null);
  const [link, setLink] = useState<{ label: string; url: string } | null>(null);
  const dq = useDebounced(q);
  const query = `page=${page}${dq ? `&q=${encodeURIComponent(dq)}` : ""}${role ? `&role=${role}` : ""}${delegateStatus ? `&delegateStatus=${delegateStatus}` : ""}`;
  const { data, isLoading } = useQuery({ queryKey: ["admin", "users", query], queryFn: () => api<Paginated<Row>>(`/admin/users?${query}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "users"] });

  const patch = async (u: Row, body: { role?: Role; isActive?: boolean }) => {
    try {
      await api(`/admin/users/${u.id}`, { method: "PATCH", body });
      toast.success("Utilisateur mis à jour.");
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const reviewDelegate = (u: Row, decision: "APPROVED" | "REJECTED" | "SUSPENDED") =>
    setAction({
      title: decision === "APPROVED" ? "Approuver le délégué" : decision === "REJECTED" ? "Refuser la demande" : "Suspendre le délégué",
      description: `${u.fullName} — ${u.delegate?.institution} · ${u.delegate?.className}`,
      confirmLabel: "Valider",
      destructive: decision !== "APPROVED",
      fields: [{ name: "note", label: "Note (communiquée à l'utilisateur)", type: "textarea" }],
      onSubmit: async (v) => {
        try {
          await api(`/admin/delegates/${u.id}/review`, { body: { decision, note: v.note || undefined } });
          toast.success("Décision enregistrée.");
          refresh();
        } catch (e) {
          toast.error(errorMessage(e));
          throw e;
        }
      },
    });
  const resetLink = async (u: Row) => {
    try {
      const r = await api<{ link: string }>(`/admin/users/${u.id}/reset-link`, { body: {} });
      setLink({ label: `Lien de réinitialisation pour ${u.fullName} (valable 1 h)`, url: r.link });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const createStaff = () =>
    setAction({
      title: "Créer un compte",
      description: "Un lien d'activation sécurisé (72 h) vous sera fourni pour que la personne choisisse son mot de passe.",
      confirmLabel: "Créer",
      fields: [
        { name: "fullName", label: "Nom complet", required: true, minLength: 2 },
        { name: "phone", label: "Téléphone", required: true, minLength: 9 },
        { name: "email", label: "Email (facultatif)" },
        {
          name: "role",
          label: "Rôle",
          type: "select",
          defaultValue: "OPERATOR",
          options: [
            { value: "OPERATOR", label: "Opérateur (production)" },
            { value: "ADMIN", label: "Administrateur" },
            { value: "CUSTOMER", label: "Client" },
          ],
        },
      ],
      onSubmit: async (v) => {
        try {
          const r = await api<{ setupLink: string }>("/admin/users", { body: { fullName: v.fullName, phone: v.phone, email: v.email || undefined, role: v.role } });
          setLink({ label: `Lien d'activation pour ${v.fullName} (valable 72 h)`, url: r.setupLink });
          refresh();
        } catch (e) {
          toast.error(errorMessage(e));
          throw e;
        }
      },
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Utilisateurs"
        description="Clients, délégués, opérateurs et administrateurs."
        actions={
          <Button onClick={createStaff}>
            <UserPlus /> Créer un compte
          </Button>
        }
      />
      {link && (
        <Alert
          variant="success"
          title={link.label}
          action={
            <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(link.url).then(() => toast.success("Lien copié."))}>
              <Copy /> Copier
            </Button>
          }
        >
          <span className="break-all font-mono text-xs">{link.url}</span>
          <p className="mt-1 text-xs">Transmettez-le uniquement à la personne concernée (ex. WhatsApp). Il ne sera plus affiché.</p>
        </Alert>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input placeholder="Nom, email ou téléphone" value={q} onChange={(e) => setQ(e.target.value)} className="sm:max-w-xs" />
        <NativeSelect value={role} onChange={(e) => setRole(e.target.value)} className="sm:max-w-[200px]">
          <option value="">Tous les rôles</option>
          {Object.entries(ROLE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={delegateStatus} onChange={(e) => setDelegateStatus(e.target.value)} className="sm:max-w-[240px]">
          <option value="">Toutes demandes délégué</option>
          <option value="PENDING">Demandes en attente</option>
          <option value="APPROVED">Délégués approuvés</option>
          <option value="SUSPENDED">Délégués suspendus</option>
        </NativeSelect>
      </div>
      <Card>
        <CardContent className="pt-5">
          {isLoading ? (
            <Skeleton className="h-48" />
          ) : !data || data.items.length === 0 ? (
            <EmptyState icon={Users} title="Aucun utilisateur" />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>Utilisateur</TH>
                    <TH>Rôle</TH>
                    <TH>Délégué</TH>
                    <TH className="text-right">Commandes</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.items.map((u) => (
                    <TR key={u.id}>
                      <TD>
                        <p className="font-medium">
                          {u.fullName} {!u.isActive && <Badge variant="danger">Désactivé</Badge>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatPhone(u.phone)}
                          {u.email ? ` · ${u.email}` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">Inscrit le {formatDate(u.createdAt)}</p>
                      </TD>
                      <TD>
                        <NativeSelect
                          aria-label="Rôle"
                          className="h-8 w-40 text-xs"
                          value={u.role}
                          onChange={(e) => {
                            if (window.confirm(`Passer ${u.fullName} au rôle « ${ROLE_LABELS[e.target.value as Role]} » ?`)) patch(u, { role: e.target.value as Role });
                          }}
                        >
                          {Object.entries(ROLE_LABELS).map(([k, v]) => (
                            <option key={k} value={k} disabled={k === "DELEGATE" && u.delegate?.status !== "APPROVED"}>
                              {v}
                            </option>
                          ))}
                        </NativeSelect>
                      </TD>
                      <TD className="text-xs">
                        {u.delegate ? (
                          <div className="space-y-1">
                            <Badge variant={u.delegate.status === "APPROVED" ? "success" : u.delegate.status === "PENDING" ? "warning" : "danger"}>{u.delegate.status}</Badge>
                            <p className="text-muted-foreground">
                              {u.delegate.institution} · {u.delegate.className}
                            </p>
                            <div className="flex gap-1">
                              {u.delegate.status !== "APPROVED" && (
                                <Button size="sm" variant="success" onClick={() => reviewDelegate(u, "APPROVED")}>
                                  Approuver
                                </Button>
                              )}
                              {u.delegate.status === "PENDING" && (
                                <Button size="sm" variant="ghost" onClick={() => reviewDelegate(u, "REJECTED")}>
                                  Refuser
                                </Button>
                              )}
                              {u.delegate.status === "APPROVED" && (
                                <Button size="sm" variant="ghost" onClick={() => reviewDelegate(u, "SUSPENDED")}>
                                  Suspendre
                                </Button>
                              )}
                            </div>
                          </div>
                        ) : (
                          "—"
                        )}
                      </TD>
                      <TD className="text-right">{u.ordersCount}</TD>
                      <TD className="text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => resetLink(u)}>
                          <KeyRound /> Lien mot de passe
                        </Button>
                        <Button size="sm" variant="ghost" className={u.isActive ? "text-destructive" : ""} onClick={() => patch(u, { isActive: !u.isActive })}>
                          {u.isActive ? "Désactiver" : "Réactiver"}
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <Pagination page={data.page} pageCount={data.pageCount} onChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>
      <ActionDialog action={action} onClose={() => setAction(null)} />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <UsersAdmin />
    </Suspense>
  );
}
