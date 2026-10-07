import type { Config, Context } from "@netlify/functions";
import { desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { emailPatterns } from "../../db/schema.js";
import { jsonError, requireAuth } from "../../lib/auth.js";
import { describePattern } from "../../lib/emailPattern.js";

export default async (req: Request, context: Context) => {
  const denied = requireAuth(context);
  if (denied) return denied;

  try {
    if (req.method === "GET") {
      const rows = await db.select().from(emailPatterns).orderBy(desc(emailPatterns.checkedAt)).limit(200);
      return Response.json(rows.map((r) => ({ ...r, example: r.pattern ? describePattern(r.pattern, r.domain) : null })));
    }
    // Forget a pattern so the next search for that company looks it up again.
    if (req.method === "DELETE" && context.params.domain) {
      await db.delete(emailPatterns).where(eq(emailPatterns.domain, context.params.domain));
      return Response.json({ ok: true });
    }
    return new Response("Method not allowed", { status: 405 });
  } catch (err) {
    return jsonError(err);
  }
};

export const config: Config = {
  path: ["/api/patterns", "/api/patterns/:domain"],
};
