import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/onboarding",
    "/onboarding/:path*",
    "/login",
    "/signup",
    "/forgot-password",
    "/api/leads/:path*",
    "/api/pipeline/:path*",
    "/api/notifications/:path*",
    "/api/calls/:path*",
    "/api/follow-ups/:path*",
    "/api/follow-up-sequences/:path*",
    "/api/emails/:path*",
    "/api/appointments/:path*",
    "/api/analytics/:path*",
    "/api/team/:path*",
    "/api/ai-agent/:path*",
    "/api/ai/:path*",
    "/api/voice/calls",
    "/api/voice/calls/:path*",
    "/api/lead-capture-keys",
    "/api/lead-capture-keys/:path*",
    "/api/settings/:path*",
    "/api/integrations/:path*",
  ],
};
