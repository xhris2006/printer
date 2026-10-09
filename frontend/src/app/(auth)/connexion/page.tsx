"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, errorMessage } from "@/lib/api";
import { useRefreshMe } from "@/lib/hooks";
import { safeNext } from "@/lib/navigation";
import type { User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/feedback";

const schema = z.object({
  identifier: z.string().trim().min(3, "Saisissez votre email ou votre numéro de téléphone"),
  password: z.string().min(1, "Saisissez votre mot de passe"),
});

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const refreshMe = useRefreshMe();
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { identifier: "", password: "" } });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const { user } = await api<{ user: User }>("/auth/login", { body: values });
      await refreshMe(user);
      const fallback = user.role === "ADMIN" || user.role === "OPERATOR" ? "/admin" : "/espace";
      router.replace(safeNext(params.get("next"), fallback));
    } catch (error) {
      form.setError("root", { message: errorMessage(error) });
    }
  });

  return (
    <Card className="animate-fade-up">
      <CardHeader>
        <CardTitle className="text-2xl">Se connecter</CardTitle>
        <CardDescription>Accédez à vos commandes, devis et commandes groupées.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {form.formState.errors.root && <Alert variant="error">{form.formState.errors.root.message}</Alert>}
          <Field label="Email ou téléphone" htmlFor="identifier" error={form.formState.errors.identifier?.message}>
            <Input id="identifier" autoComplete="username" placeholder="6 94 60 00 07 ou vous@exemple.cm" {...form.register("identifier")} aria-invalid={Boolean(form.formState.errors.identifier)} />
          </Field>
          <Field label="Mot de passe" htmlFor="password" error={form.formState.errors.password?.message}>
            <Input id="password" type="password" autoComplete="current-password" {...form.register("password")} aria-invalid={Boolean(form.formState.errors.password)} />
          </Field>
          <div className="flex justify-end">
            <Link href="/mot-de-passe-oublie" className="text-sm text-primary hover:underline">
              Mot de passe oublié ?
            </Link>
          </div>
          <Button type="submit" className="w-full" size="lg" loading={form.formState.isSubmitting}>
            Se connecter
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Pas encore de compte ?{" "}
            <Link href={`/inscription${params.get("next") ? `?next=${encodeURIComponent(params.get("next") as string)}` : ""}`} className="font-semibold text-primary hover:underline">
              Créer un compte
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
