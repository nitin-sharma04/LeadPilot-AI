import { auth } from "@/auth";
import { AppError } from "@/lib/errors";
import type { UserRole } from "@prisma/client";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  companyId: string;
  image?: string | null;
};

export async function requireSession(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id || !session.user.companyId) {
    throw new AppError("Unauthorized", 401);
  }

  return {
    id: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? "",
    role: session.user.role,
    companyId: session.user.companyId,
    image: session.user.image,
  };
}
