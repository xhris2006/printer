"use client";

import Link from "next/link";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { site } from "@/config/site";
import { whatsappLink } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/feedback";

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ message: string; emailEnabled: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      setResult(await api<{ message: string; emailEnabled: boolean }>("/auth/forgot-password", { body: { identifier } }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Mot de passe oublié</CardTitle>
        <CardDescription>Recevez un lien sécurisé pour choisir un nouveau mot de passe.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {result ? (
          <>
            <Alert variant={result.emailEnabled ? "success" : "info"}>{result.message}</Alert>
            {!result.emailEnabled && (
              <Button asChild className="w-full" variant="success">
                <a href={whatsappLink(site.whatsapp, `Bonjour, j'ai oublié mon mot de passe. Mon identifiant : ${identifier}`)} target="_blank" rel="noopener noreferrer">
                  Contacter l&apos;assistance WhatsApp
                </a>
              </Button>
            )}
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {error && <Alert variant="error">{error}</Alert>}
            <Field label="Email ou téléphone" htmlFor="identifier">
              <Input id="identifier" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required minLength={3} />
            </Field>
            <Button type="submit" className="w-full" loading={loading}>
              Envoyer le lien
            </Button>
          </form>
        )}
        <p className="text-center text-sm">
          <Link href="/connexion" className="text-primary hover:underline">
            Retour à la connexion
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
