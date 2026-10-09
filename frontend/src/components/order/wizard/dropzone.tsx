"use client";

import { useRef, useState } from "react";
import { CloudUpload } from "lucide-react";
import { cn } from "@/lib/utils";

export function Dropzone({ onFiles, accept, maxSizeMb, disabled }: { onFiles: (files: File[]) => void; accept: string[]; maxSizeMb: number; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled) {
          e.preventDefault();
          input.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled && e.dataTransfer.files.length > 0) onFiles(Array.from(e.dataTransfer.files));
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30",
        over ? "border-primary bg-accent" : "border-slate-300 bg-slate-50/60 hover:border-primary/60 hover:bg-accent/40",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <CloudUpload className="size-9 text-primary" aria-hidden />
      <p className="text-sm font-semibold text-slate-800">Cliquez pour téléverser vos fichiers</p>
      <p className="text-xs text-muted-foreground">ou glissez-déposez vos documents ici — plusieurs fichiers à la fois</p>
      <p className="text-xs text-muted-foreground">
        Formats acceptés : {accept.map((a) => a.toUpperCase()).join(", ")} | Taille maximale : {maxSizeMb} Mo par fichier
      </p>
      <input
        ref={input}
        type="file"
        multiple
        className="sr-only"
        accept={accept.map((a) => `.${a}`).join(",")}
        onChange={(e) => {
          if (e.target.files) onFiles(Array.from(e.target.files));
          e.target.value = "";
        }}
        aria-label="Sélectionner des fichiers"
      />
    </div>
  );
}
