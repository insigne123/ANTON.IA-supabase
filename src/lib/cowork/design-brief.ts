import { z } from 'zod';

/**
 * What the coordinator asks the Designer for (Plan 12, 3b): `artifact.create` with a brief. The
 * Designer writes the code of an artifact (designer.ts) and the server puts the data in, from the
 * tables named here (artifact-data.ts): the model never writes a figure.
 */

/** The data an artifact can draw from, each one read by the server for the person's organization. */
export const COWORK_ARTIFACT_TABLES = ['pipeline', 'contacts', 'activity', 'campaigns', 'opportunities'] as const;
export type CoworkArtifactTableName = typeof COWORK_ARTIFACT_TABLES[number];

export const coworkDesignBriefSchema = z.object({
  /** The artifact's title as the person will see it: what, for whom or which period («Pipeline de octubre»). */
  title: z.string().trim().min(3).max(90),
  /** What it must let the person see or decide, and how it is laid out, in plain words. */
  goal: z.string().trim().min(10).max(900),
  /** The tables it draws from (1 to 3). */
  tables: z.array(z.enum(COWORK_ARTIFACT_TABLES)).min(1).max(3),
  /** To change an artifact already made in this conversation: its file name (artifact-….html); null for a new one. */
  previous: z.string().trim().regex(/^artifact-[a-z0-9-]{1,60}-v\d{1,3}\.html$/).nullable(),
  /** The change the person asked for, or the error to fix, when previous is set; null otherwise. */
  change: z.string().trim().max(600).nullable(),
}).strict();
export type CoworkDesignBrief = z.infer<typeof coworkDesignBriefSchema>;

/** The file name of an artifact: its key (from the title) and its version. */
export function coworkArtifactFileName(key: string, version: number) {
  return `artifact-${key}-v${version}.html`;
}

/** A stable key from a title: lowercase words without accents, joined by dashes, at most 48 characters. */
export function coworkArtifactKey(title: string) {
  const key = title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/g, '');
  return key || 'artefacto';
}

/** The key and version of an artifact file name, or null for any other file. */
export function coworkArtifactFileParts(name: string): { key: string; version: number } | null {
  const match = /^artifact-([a-z0-9-]{1,60})-v(\d{1,3})\.html$/.exec(name);
  return match ? { key: match[1], version: Number(match[2]) } : null;
}

/** What a code artifact records in its artifact.created event, beside the file name and size. */
export type CoworkCodeArtifactPayload = {
  name: string; path: string; size: number; kind: 'code'; title: string; key: string; version: number;
  /** The tables it read, with how many rows each, for the card and the panel. */
  tables: Array<{ name: CoworkArtifactTableName; label: string; rows: number; truncated: boolean }>;
};
