import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Emplacement d'image : affiche la photo fournie (public/images) ou, à défaut,
 * le visuel de remplacement passé en enfant.
 */
export function ImageSlot({ src, alt, className, children, priority }: { src: string | null; alt: string; className?: string; children: React.ReactNode; priority?: boolean }) {
  if (!src) return <div className={className}>{children}</div>;
  return (
    <div className={cn("relative overflow-hidden", className)}>
      <Image src={src} alt={alt} fill priority={priority} sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" />
    </div>
  );
}
