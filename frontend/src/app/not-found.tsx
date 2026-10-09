import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-accent text-primary">
        <FileQuestion className="size-7" />
      </div>
      <h1 className="text-2xl font-bold">Page introuvable</h1>
      <p className="max-w-md text-sm text-muted-foreground">La page demandée n&apos;existe pas ou a été déplacée.</p>
      <Button asChild>
        <Link href="/">Retour à l&apos;accueil</Link>
      </Button>
    </div>
  );
}
