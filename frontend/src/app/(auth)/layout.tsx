import Link from "next/link";
import { Logo } from "@/components/layout/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-white via-[#f3f7ff] to-[#e6eeff]">
      <header className="container-page flex h-16 items-center justify-between">
        <Logo />
        <Link href="/" className="text-sm font-medium text-slate-600 hover:text-primary">
          Retour au site
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
