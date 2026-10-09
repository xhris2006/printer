import { api, ApiError } from "./api";
import type { ApiDocument, UploadTarget } from "./types";

/**
 * Téléversement direct vers le stockage privé (URL signée) avec suivi de progression,
 * puis finalisation : le serveur vérifie le fichier et lance l'analyse asynchrone.
 */
export async function uploadFile(file: File, onProgress: (percent: number) => void, signal?: AbortSignal): Promise<ApiDocument> {
  const { document, upload } = await api<{ document: ApiDocument; upload: UploadTarget }>("/documents/uploads", {
    body: { fileName: file.name, size: file.size, mimeType: file.type || undefined },
  });
  await new Promise<void>((resolve, reject) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(upload.fields)) form.append(k, v);
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method, upload.url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else if (xhr.status === 413) reject(new ApiError(413, "Fichier trop volumineux.", "FILE_TOO_LARGE"));
      else reject(new ApiError(xhr.status, "Le téléversement a échoué. Réessayez.", "UPLOAD_FAILED"));
    };
    xhr.onerror = () => reject(new ApiError(0, "Connexion interrompue pendant le téléversement.", "NETWORK"));
    xhr.onabort = () => reject(new ApiError(0, "Téléversement annulé.", "ABORTED"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
  const done = await api<{ document: ApiDocument }>(`/documents/${document.id}/complete`, { body: {} });
  return done.document;
}

export const ANALYZING_STATUSES = new Set(["PENDING_UPLOAD", "UPLOADED", "ANALYZING"]);
