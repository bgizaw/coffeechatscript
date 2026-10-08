import { getStore } from "@netlify/blobs";
import { and, asc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { resumes } from "../db/schema.js";

export const MAX_RESUME_BYTES = 4 * 1024 * 1024;
export const MAX_RESUMES = 10;

const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export type Resume = typeof resumes.$inferSelect;

const store = () => getStore("resumes");

/** Returns the MIME type for an allowed resume filename, or null. */
export function resumeContentType(filename: string) {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return TYPES[ext] ?? null;
}

export function publicResume(r: Resume) {
  return { id: r.id, label: r.label, filename: r.filename, size: r.size, createdAt: r.createdAt };
}

export function listResumes(userId: number) {
  return db.select().from(resumes).where(eq(resumes.userId, userId)).orderBy(asc(resumes.createdAt));
}

export async function getResume(userId: number, id: number) {
  const [row] = await db.select().from(resumes).where(and(eq(resumes.id, id), eq(resumes.userId, userId)));
  return row ?? null;
}

export async function createResume(userId: number, file: { label: string; filename: string; contentType: string; data: ArrayBuffer }) {
  const blobKey = `${userId}/${randomUUID()}`;
  await store().set(blobKey, file.data);
  const [row] = await db
    .insert(resumes)
    .values({ userId, label: file.label, filename: file.filename, contentType: file.contentType, size: file.data.byteLength, blobKey })
    .returning();
  return row;
}

export async function renameResume(r: Resume, label: string) {
  const [row] = await db.update(resumes).set({ label }).where(eq(resumes.id, r.id)).returning();
  return row;
}

export async function readResumeFile(r: Resume) {
  const data = await store().get(r.blobKey, { type: "arrayBuffer" });
  return data ? Buffer.from(data) : null;
}

export async function deleteResume(r: Resume) {
  await db.delete(resumes).where(eq(resumes.id, r.id));
  await store().delete(r.blobKey);
}

/** Removes every stored resume file for a user (their DB rows cascade when the account is deleted). */
export async function deleteAllResumeFiles(userId: number) {
  const rows = await listResumes(userId);
  await Promise.all(rows.map((r) => store().delete(r.blobKey)));
}
