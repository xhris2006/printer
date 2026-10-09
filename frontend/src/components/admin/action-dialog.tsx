"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";

export interface ActionField {
  name: string;
  label: string;
  type?: "text" | "number" | "textarea" | "date" | "select";
  required?: boolean;
  minLength?: number;
  hint?: string;
  defaultValue?: string;
  options?: { value: string; label: string }[];
}

export interface ActionConfig {
  title: string;
  description?: string;
  confirmLabel: string;
  destructive?: boolean;
  fields: ActionField[];
  onSubmit: (values: Record<string, string>) => Promise<void>;
}

/** Boîte de dialogue générique pour les actions d'administration nécessitant une saisie. */
export function ActionDialog({ action, onClose }: { action: ActionConfig | null; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  if (action && key !== action.title) {
    setKey(action.title);
    setValues(Object.fromEntries(action.fields.map((f) => [f.name, f.defaultValue ?? ""])));
  }
  if (!action && key !== null) setKey(null);

  const valid = action?.fields.every((f) => !f.required || (values[f.name] ?? "").trim().length >= (f.minLength ?? 1)) ?? false;

  return (
    <Dialog open={Boolean(action)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {action && (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setLoading(true);
              try {
                await action.onSubmit(values);
                onClose();
              } finally {
                setLoading(false);
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>{action.title}</DialogTitle>
              {action.description && <DialogDescription>{action.description}</DialogDescription>}
            </DialogHeader>
            {action.fields.map((f) => (
              <Field key={f.name} label={f.label} htmlFor={`f-${f.name}`} hint={f.hint}>
                {f.type === "textarea" ? (
                  <Textarea id={`f-${f.name}`} value={values[f.name] ?? ""} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
                ) : f.type === "select" ? (
                  <NativeSelect id={`f-${f.name}`} value={values[f.name] ?? ""} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}>
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <Input id={`f-${f.name}`} type={f.type ?? "text"} value={values[f.name] ?? ""} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} />
                )}
              </Field>
            ))}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Annuler
              </Button>
              <Button type="submit" variant={action.destructive ? "destructive" : "default"} loading={loading} disabled={!valid}>
                {action.confirmLabel}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
