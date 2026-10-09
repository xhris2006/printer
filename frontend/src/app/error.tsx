"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-red-50 text-red-600">
        <AlertTriangle className="size-7" />
      </div>
      <h1 className="text-xl font-bold">Une erreur est survenue</h1>
      <p className="max-w-md text-sm text-muted-foreground">Réessayez dans un instant. Si le problème persiste, contactez l&apos;assistance WhatsApp.</p>
      <Button onClick={reset}>Réessayer</Button>
    </div>
  );
}
