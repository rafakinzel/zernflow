import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { decidirAcesso, type Acesso } from "@/lib/auth-policy";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  const isAuthPage = pathname === "/login";
  const isAuthCallback = pathname === "/auth/callback";
  const isDashboard = pathname.startsWith("/dashboard");
  const isApiRoute = pathname.startsWith("/api/");

  // A signed-in session must have passed the authenticator step when one is
  // enrolled, and must not be older than the session limit (lib/auth-policy).
  let acesso: Acesso = "ok";
  if (user) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    acesso = decidirAcesso({
      nivelAtual: aal?.currentLevel ?? null,
      nivelExigido: aal?.nextLevel ?? null,
      autenticadoEm: (aal?.currentAuthenticationMethods ?? []).flatMap((m) =>
        typeof m === "object" && typeof m.timestamp === "number" ? [m.timestamp] : []
      ),
    });
  }

  const withCookies = (response: NextResponse) => {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie.name, cookie.value);
    });
    return response;
  };

  if (isAuthCallback) {
    return supabaseResponse;
  }

  // API routes protect themselves; webhooks, cron and the Central door carry
  // no user session and pass untouched. A user session that has not passed
  // the code step, or has expired, gets nothing from the API.
  if (isApiRoute) {
    if (user && acesso !== "ok") {
      return withCookies(
        NextResponse.json(
          { error: acesso === "expirou" ? "Session expired" : "Authenticator code required" },
          { status: 401 }
        )
      );
    }
    return supabaseResponse;
  }

  if (user && acesso === "expirou") {
    await supabase.auth.signOut();
    if (isAuthPage) return supabaseResponse;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "?expirou=1";
    return withCookies(NextResponse.redirect(url));
  }

  if (user && acesso === "falta_codigo") {
    if (isAuthPage) return supabaseResponse;
    if (isDashboard) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "?codigo=1";
      return withCookies(NextResponse.redirect(url));
    }
  }

  // Redirect logged-in users away from auth pages to dashboard
  if (user && isAuthPage && acesso === "ok") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    const redirectResponse = NextResponse.redirect(url);
    // Forward any refreshed session cookies
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, cookie.value);
    });
    return redirectResponse;
  }

  // Redirect unauthenticated users trying to access dashboard to login
  if (!user && isDashboard) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const redirectResponse = NextResponse.redirect(url);
    // Forward any refreshed session cookies
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, cookie.value);
    });
    return redirectResponse;
  }

  return supabaseResponse;
}
