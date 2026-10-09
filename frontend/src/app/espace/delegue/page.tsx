"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GraduationCap, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { fcfa, formatDate } from "@/lib/format";
import { useMe, useRefreshMe } from "@/lib/hooks";
import type { GroupMode, GroupStatus, User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, EmptyState, PageHeader, Skeleton, Spinner } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/input";

interface GroupListItem {
  id: string;
  code: string;
  name: string;
  className: string;
  institution: string;
  mode: GroupMode;
  status: GroupStatus;
  statusLabel: string;
  deadline: string | null;
  contributionsCount: number;
  totalAmount: number;
  paidAmount: number;
  createdAt: string;
}

function DelegateRequest({ user }: { user: User }) {
  const refreshMe = useRefreshMe();
  const [form, setForm] = useState({
    institution: user.delegate?.institution ?? "",
    field: user.delegate?.field ?? "",
    level: user.delegate?.level ?? "",
    className: user.delegate?.className ?? "",
    motivation: "",
  });
  const [loading, setLoading] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api<{ user: User }>("/delegate/request", { body: { ...form, motivation: form.motivation || undefined } });
      await refreshMe(res.user);
      toast.success(res.user.delegate?.status === "APPROVED" ? "Espace délégué activé !" : "Demande envoyée.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GraduationCap className="size-5 text-primary" /> Devenir délégué sur la plateforme
        </CardTitle>
        <CardDescription>Créez des commandes groupées et des liens de collecte pour votre classe. Votre demande est validée par notre équipe.</CardDescription>
      </CardHeader>
      <CardContent>
        {user.delegate?.status === "PENDING" && (
          <Alert variant="info" className="mb-4" title="Demande en cours d'examen">
            Nous vous notifierons dès sa validation.
          </Alert>
        )}
        {user.delegate?.status === "REJECTED" && (
          <Alert variant="warning" className="mb-4" title="Demande non acceptée">
            {user.delegate.reviewNote ?? "Vous pouvez compléter votre demande et la renvoyer."}
          </Alert>
        )}
        {user.delegate?.status === "SUSPENDED" ? (
          <Alert variant="error">Votre accès délégué est suspendu. Contactez l&apos;assistance.</Alert>
        ) : (
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <Field label="Établissement" htmlFor="inst" className="sm:col-span-2">
              <Input id="inst" value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} required minLength={2} />
            </Field>
            <Field label="Filière" htmlFor="fil">
              <Input id="fil" value={form.field} onChange={(e) => setForm({ ...form, field: e.target.value })} required minLength={2} />
            </Field>
            <Field label="Niveau" htmlFor="niv">
              <Input id="niv" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} required placeholder="L1, L2, BTS 1…" />
            </Field>
            <Field label="Classe" htmlFor="cls" className="sm:col-span-2">
              <Input id="cls" value={form.className} onChange={(e) => setForm({ ...form, className: e.target.value })} required />
            </Field>
            <Field label="Message (facultatif)" htmlFor="mot" className="sm:col-span-2">
              <Textarea id="mot" value={form.motivation} onChange={(e) => setForm({ ...form, motivation: e.target.value })} maxLength={500} />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" loading={loading}>
                {user.delegate ? "Mettre à jour ma demande" : "Envoyer ma demande"}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export default function DelegatePage() {
  const { data: user } = useMe();
  const approved = user?.delegate?.status === "APPROVED" && (user.role === "DELEGATE" || user.role === "ADMIN");
  const { data, isLoading } = useQuery({
    queryKey: ["groups", "mine"],
    queryFn: () => api<{ items: GroupListItem[] }>("/groups"),
    enabled: Boolean(approved),
  });
  if (!user) return <Spinner />;
  if (!approved) {
    return (
      <div className="space-y-6">
        <PageHeader title="Espace délégué" description="Commandes groupées pour les délégués de classe." />
        <DelegateRequest user={user} />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Espace délégué"
        description={`${user.delegate?.institution} · ${user.delegate?.className}`}
        actions={
          <Button asChild>
            <Link href="/espace/delegue/groupes/nouveau">
              <Plus /> Créer un lot
            </Link>
          </Button>
        }
      />
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Aucune commande groupée"
          description="Créez un lot pour rassembler les documents de la classe ou partager un lien de collecte."
          action={
            <Button asChild>
              <Link href="/espace/delegue/groupes/nouveau">Créer un lot</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.items.map((g) => (
            <Link key={g.id} href={`/espace/delegue/groupes/${g.id}`}>
              <Card className="h-full transition hover:border-primary/40">
                <CardContent className="space-y-2 pt-5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{g.code}</span>
                    <Badge variant={g.status === "OPEN" ? "success" : g.status === "CANCELLED" ? "danger" : "info"}>{g.statusLabel}</Badge>
                  </div>
                  <p className="font-semibold">{g.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {g.mode === "DELEGATE_COLLECT" ? "Collecte par le délégué" : "Contributions des étudiants"} · {g.contributionsCount} contribution(s)
                    {g.deadline ? ` · limite ${formatDate(g.deadline)}` : ""}
                  </p>
                  <div className="flex justify-between border-t pt-2 text-sm">
                    <span className="text-muted-foreground">Payé / total</span>
                    <span className="font-semibold">
                      {fcfa(g.paidAmount)} / {fcfa(g.totalAmount)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
