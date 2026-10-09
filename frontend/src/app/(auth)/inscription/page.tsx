"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useRefreshMe } from "@/lib/hooks";
import { safeNext } from "@/lib/navigation";
import type { User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/feedback";

const schema = z
  .object({
    fullName: z.string().trim().min(2, "Nom complet requis"),
    phone: z
      .string()
      .trim()
      .refine((v) => /^(\+?237)?\s*[26](\s*\d){8}$/.test(v.replace(/[.-]/g, "")), "Numéro camerounais invalide (ex. 6 94 60 00 07)"),
    email: z.union([z.string().trim().email("Adresse email invalide"), z.literal("")]),
    password: z
      .string()
      .min(8, "Au moins 8 caractères")
      .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Utilisez des lettres et des chiffres"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Les mots de passe ne correspondent pas", path: ["confirm"] });

type Values = z.infer<typeof schema>;

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const refreshMe = useRefreshMe();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { fullName: "", phone: "", email: "", password: "", confirm: "" } });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit(async ({ fullName, phone, email, password }) => {
    const values = { fullName, phone, email, password };
    try {
      const { user } = await api<{ user: User }>("/auth/register", { body: values });
      await refreshMe(user);
      router.replace(safeNext(params.get("next"), "/espace"));
    } catch (error) {
      if (error instanceof ApiError && error.fields.length > 0) {
        for (const f of error.fields) form.setError(f.path as keyof Values, { message: f.message });
      }
      form.setError("root", { message: errorMessage(error) });
    }
  });

  return (
    <Card className="animate-fade-up">
      <CardHeader>
        <CardTitle className="text-2xl">Créer un compte</CardTitle>
        <CardDescription>Commandez vos impressions et suivez-les en temps réel.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {errors.root && <Alert variant="error">{errors.root.message}</Alert>}
          <Field label="Nom complet" htmlFor="fullName" error={errors.fullName?.message}>
            <Input id="fullName" autoComplete="name" {...form.register("fullName")} aria-invalid={Boolean(errors.fullName)} />
          </Field>
          <Field label="Téléphone (Mobile Money)" htmlFor="phone" error={errors.phone?.message}>
            <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="6 94 60 00 07" {...form.register("phone")} aria-invalid={Boolean(errors.phone)} />
          </Field>
          <Field label="Email (facultatif, pour recevoir vos reçus)" htmlFor="email" error={errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" {...form.register("email")} aria-invalid={Boolean(errors.email)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mot de passe" htmlFor="password" error={errors.password?.message}>
              <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} aria-invalid={Boolean(errors.password)} />
            </Field>
            <Field label="Confirmation" htmlFor="confirm" error={errors.confirm?.message}>
              <Input id="confirm" type="password" autoComplete="new-password" {...form.register("confirm")} aria-invalid={Boolean(errors.confirm)} />
            </Field>
          </div>
          <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
            Créer mon compte
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Déjà inscrit ?{" "}
            <Link href={`/connexion${params.get("next") ? `?next=${encodeURIComponent(params.get("next") as string)}` : ""}`} className="font-semibold text-primary hover:underline">
              Se connecter
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
