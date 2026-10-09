export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string = "ERROR",
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, code = "BAD_REQUEST", details?: unknown) =>
  new AppError(400, message, code, details);
export const unauthorized = (message = "Authentification requise.") => new AppError(401, message, "UNAUTHORIZED");
export const forbidden = (message = "Accès refusé.") => new AppError(403, message, "FORBIDDEN");
export const notFound = (message = "Ressource introuvable.") => new AppError(404, message, "NOT_FOUND");
export const conflict = (message: string, code = "CONFLICT") => new AppError(409, message, code);
export const unprocessable = (message: string, code = "UNPROCESSABLE", details?: unknown) =>
  new AppError(422, message, code, details);
export const serviceUnavailable = (message: string, code = "SERVICE_UNAVAILABLE") => new AppError(503, message, code);
