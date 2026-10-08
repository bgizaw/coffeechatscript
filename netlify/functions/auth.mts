import type { Config, Context } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { users } from "../../db/schema.js";
import { currentUser, endSession, jsonError, requireUser } from "../../lib/auth.js";
import { revokeGoogle } from "../../lib/google.js";
import { deleteAllResumeFiles } from "../../lib/resumes.js";

export default async (req: Request, context: Context) => {
  const path = new URL(req.url).pathname;

  try {
    if (path.endsWith("/me")) {
      const user = await currentUser(context);
      return Response.json({ authed: Boolean(user), email: user?.email ?? null });
    }

    if (path.endsWith("/logout") && req.method === "POST") {
      await endSession(context);
      return Response.json({ ok: true });
    }

    // Permanently delete the account: profile, searches, drafts, resumes, and Google access.
    if (path.endsWith("/account") && req.method === "DELETE") {
      const user = await requireUser(context);
      if (user instanceof Response) return user;
      await deleteAllResumeFiles(user.id);
      await revokeGoogle(user);
      await db.delete(users).where(eq(users.id, user.id));
      context.cookies.delete({ name: "acc_session", path: "/" });
      return Response.json({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  } catch (err) {
    return jsonError(err);
  }
};

export const config: Config = {
  path: ["/api/auth/me", "/api/auth/logout", "/api/auth/account"],
};
