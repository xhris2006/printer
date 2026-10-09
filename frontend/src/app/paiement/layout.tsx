import { Logo } from "@/components/layout/logo";
import { TestModeBanner } from "@/components/layout/test-mode-banner";

export default function PaymentLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-[#f3f7ff] to-[#e6eeff]">
      <TestModeBanner />
      <header className="container-page flex h-16 items-center">
        <Logo />
      </header>
      <main className="flex justify-center px-4 py-8">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
