import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/auth"];

/**
 * Presence-only gate (Spec §6): the `sft_session` cookie is httpOnly and this
 * middleware never reads its value. Real verification happens when the API
 * answers 401 and `lib/api.ts` redirects to /login.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }
  const cookie = req.cookies.get("sft_session");
  if (!cookie) {
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
