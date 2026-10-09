"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { formatPhone } from "@/lib/format";
import { useMe, useRefreshMe } from "@/lib/hooks";
import type { User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { PageHeader, Spinner } from "@/components/ui/feedback";
import { Switch } from "@/components/ui/choice";

export default function ProfilePage() {
  const { data: user } = useMe();
  const refreshMe = useRefreshMe();
  const [form, setForm] = useState({ fullName: "", email: "", quarter: "", addressDetails: "", notifyByEmail: true });
  const [pwd, setPwd] = useState({ currentPassword: "", newPassword: "" });
  const [saving, setSaving] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);

  useEffect(() => {
    if (user) {
      setForm({
        fullName: user.fullName,
        email: user.email ?? "",
        quarter: user.profile?.quarter ?? "",
        addressDetails: user.profile?.addressDetails ?? "",
        notifyByEmail: user.profile?.notifyByEmail ?? true,
      });
    }
  }, [user]);

  if (!user) return <Spinner />;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api<{ user: User }>("/auth/me", { method: "PATCH", body: form });
      await refreshMe(res.user);
      toast.success("Profil mis à jour.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPwd(true);
    try {
      await api("/auth/change-password", { body: pwd });
      setPwd({ currentPassword: "", newPassword: "" });
      toast.success("Mot de passe modifié. Vos autres sessions ont été déconnectées.");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSavingPwd(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Profil" description={`Téléphone : ${formatPhone(user.phone)}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Informations personnelles</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="space-y-4">
              <Field label="Nom complet" htmlFor="fn">
                <Input id="fn" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required minLength={2} />
              </Field>
              <Field label="Email" htmlFor="em" hint="Pour recevoir vos reçus et notifications par email.">
                <Input id="em" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label="Quartier (livraison)" htmlFor="qt">
                <Input id="qt" value={form.quarter} onChange={(e) => setForm({ ...form, quarter: e.target.value })} />
              </Field>
              <Field label="Indications d'adresse" htmlFor="ad">
                <Input id="ad" value={form.addressDetails} onChange={(e) => setForm({ ...form, addressDetails: e.target.value })} />
              </Field>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-sm">Recevoir les notifications par email</span>
                <Switch checked={form.notifyByEmail} onChange={(v) => setForm({ ...form, notifyByEmail: v })} label="Notifications par email" />
              </div>
              <Button type="submit" loading={saving}>
                Enregistrer
              </Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Sécurité</CardTitle>
            <CardDescription>Au moins 8 caractères, lettres et chiffres.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={changePassword} className="space-y-4">
              <Field label="Mot de passe actuel" htmlFor="cp">
                <Input id="cp" type="password" autoComplete="current-password" value={pwd.currentPassword} onChange={(e) => setPwd({ ...pwd, currentPassword: e.target.value })} required />
              </Field>
              <Field label="Nouveau mot de passe" htmlFor="np">
                <Input id="np" type="password" autoComplete="new-password" value={pwd.newPassword} onChange={(e) => setPwd({ ...pwd, newPassword: e.target.value })} required minLength={8} />
              </Field>
              <Button type="submit" variant="outline" loading={savingPwd}>
                Changer le mot de passe
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
