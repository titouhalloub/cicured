import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/app", "/api/runs"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Signed-in users who hit the landing page go to their dashboard.
  if (pathname === "/" && req.cookies.has("sft_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/app";
    return NextResponse.redirect(url);
  }

  const requiresAuth = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  if (!requiresAuth) return NextResponse.next();

  if (!req.cookies.has("sft_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

