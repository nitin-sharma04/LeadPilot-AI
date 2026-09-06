import { isDemoModeEnabled } from "@/lib/app-url";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return <LoginForm demoEnabled={isDemoModeEnabled()} />;
}
