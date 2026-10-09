import { NextResponse, type NextRequest } from "next/server";

/**
 * Redirection rapide vers la connexion lorsque le cookie de session est absent.
 * Les droits (rôles) sont toujours vérifiés par l'API.
 */
export function proxy(request: NextRequest) {
  const session = request.cookies.get("ps_session");
  if (!session) {
    const url = request.nextUrl.clone();
    url.pathname = "/connexion";
    url.search = `?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/espace/:path*", "/admin/:path*"],
};
