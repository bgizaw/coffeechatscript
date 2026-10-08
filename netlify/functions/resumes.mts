import type { Config, Context } from "@netlify/functions";
import { jsonError, requireUser } from "../../lib/auth.js";
import {
  MAX_RESUMES,
  MAX_RESUME_BYTES,
  createResume,
  deleteResume,
  getResume,
  listResumes,
  publicResume,
  readResumeFile,
  renameResume,
  resumeContentType,
} from "../../lib/resumes.js";
import { updateUser } from "../../lib/settings.js";

export default async (req: Request, context: Context) => {
  const user = await requireUser(context);
  if (user instanceof Response) return user;
  const id = context.params.id ? Number(context.params.id) : null;

  try {
    if (!id && req.method === "GET") {
      return Response.json((await listResumes(user.id)).map(publicResume));
    }

    // Upload: multipart form with `file` and an optional `label`.
    if (!id && req.method === "POST") {
      const form = await req.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File) || !file.size) return Response.json({ error: "Choose a file to upload." }, { status: 400 });
      const contentType = resumeContentType(file.name);
      if (!contentType) return Response.json({ error: "Resumes must be PDF, DOC, or DOCX files." }, { status: 400 });
      if (file.size > MAX_RESUME_BYTES) return Response.json({ error: "Resumes must be 4 MB or smaller." }, { status: 400 });
      const existing = await listResumes(user.id);
      if (existing.length >= MAX_RESUMES) {
        return Response.json({ error: `You can keep up to ${MAX_RESUMES} resumes. Delete one first.` }, { status: 400 });
      }
      const filename = file.name.replace(/[\\/\r\n"]/g, "_").slice(0, 120);
      const label = String(form!.get("label") ?? "").trim().slice(0, 80) || filename.replace(/\.[^.]+$/, "");
      const resume = await createResume(user.id, { label, filename, contentType, data: await file.arrayBuffer() });
      // The first resume becomes the default attachment.
      if (!existing.length) await updateUser(user.id, { defaultResumeId: resume.id });
      return Response.json(publicResume(resume), { status: 201 });
    }

    if (!id || Number.isNaN(id)) return new Response("Not found", { status: 404 });
    const resume = await getResume(user.id, id);
    if (!resume) return Response.json({ error: "Not found" }, { status: 404 });

    // Download / preview
    if (req.method === "GET") {
      const data = await readResumeFile(resume);
      if (!data) return Response.json({ error: "File is missing" }, { status: 404 });
      return new Response(new Uint8Array(data), {
        headers: {
          "Content-Type": resume.contentType,
          "Content-Disposition": `inline; filename="${resume.filename}"`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    if (req.method === "PUT") {
      const body = await req.json();
      const label = String(body.label ?? "").trim().slice(0, 80);
      if (!label) return Response.json({ error: "Name can't be empty." }, { status: 400 });
      return Response.json(publicResume(await renameResume(resume, label)));
    }

    if (req.method === "DELETE") {
      await deleteResume(resume);
      if (user.defaultResumeId === id) await updateUser(user.id, { defaultResumeId: null });
      return Response.json({ ok: true });
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (err) {
    return jsonError(err);
  }
};

export const config: Config = {
  path: ["/api/resumes", "/api/resumes/:id"],
};
