import type { NextAuthConfig } from "next-auth";

/**
 * Edge-compatible Auth.js config (no Prisma / Node-only modules).
 * Used by middleware. Full providers live in src/auth.ts.
 */
export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isLoggedIn = Boolean(auth?.user?.id && auth.user.companyId);

      const isAuthPage =
        pathname.startsWith("/login") ||
        pathname.startsWith("/signup") ||
        pathname.startsWith("/forgot-password") ||
        pathname.startsWith("/invite/");
      const isDashboard = pathname.startsWith("/dashboard");
      const isOnboarding = pathname.startsWith("/onboarding");
      const isApi =
        pathname.startsWith("/api/") && !pathname.startsWith("/api/auth");

      if ((isDashboard || isOnboarding || isApi) && !isLoggedIn) return false;
      if (isAuthPage && isLoggedIn && !pathname.startsWith("/invite/")) {
        return Response.redirect(new URL("/dashboard", request.nextUrl));
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.companyId = user.companyId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id && token.role && token.companyId) {
        session.user.id = String(token.id);
        session.user.role = token.role as typeof session.user.role;
        session.user.companyId = String(token.companyId);
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
