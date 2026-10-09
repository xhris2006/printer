/** Client HTTP de l'API (même origine via les rewrites Next.js : cookies first-party). */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string = "ERROR",
    public fields: { path: string; message: string }[] = [],
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function api<T>(path: string, options: { method?: Method; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = options.method ?? (options.body !== undefined ? "POST" : "GET");
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: "include",
      cache: "no-store",
      headers: options.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError(0, "Connexion impossible. Vérifiez votre connexion internet et réessayez.", "NETWORK");
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const err = data?.error;
    throw new ApiError(
      response.status,
      err?.message ?? (response.status >= 500 ? "Le service est momentanément indisponible." : "Requête refusée."),
      err?.code,
      err?.fields ?? [],
      err?.details,
    );
  }
  return data as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.fields.length > 0) return `${error.message} ${error.fields.map((f) => f.message).join(" · ")}`;
    return error.message;
  }
  return "Une erreur inattendue est survenue.";
}
