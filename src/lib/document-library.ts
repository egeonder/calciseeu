'use client';

import type { DocumentAnalysis } from '@/src/lib/document-analysis';
import type { DocumentAnalysisStatus } from '@/src/db/schema';

/** A document as seen by the client, with a presigned preview URL. */
export type LibraryDocument = {
	id: string;
	name: string;
	size: number;
	type: string;
	createdAt: string;
	/** Short-lived presigned URL used for preview / download. */
	url: string;
	/** Lifecycle of the document's automatic ISEEU analysis. */
	analysisStatus: DocumentAnalysisStatus;
};

/** Fetches the signed-in user's uploaded documents, newest first. */
export async function fetchDocuments(): Promise<LibraryDocument[]> {
	const response = await fetch('/api/documents').catch(() => null);
	if (!response || !response.ok) return [];
	const { documents } = (await response.json()) as {
		documents?: LibraryDocument[];
	};
	return documents ?? [];
}

/** Fetches a fresh, short-lived presigned preview URL for one document. */
export async function getDocumentUrl(id: string): Promise<string | null> {
	const response = await fetch(
		`/api/documents/${encodeURIComponent(id)}`,
	).catch(() => null);
	if (!response || !response.ok) return null;
	const { url } = (await response.json()) as { url?: string };
	return url ?? null;
}

/**
 * Fetches the analysis status of several documents at once, keyed by id.
 * Returns an empty map on any failure.
 */
export async function fetchDocumentStatuses(
	ids: string[],
): Promise<Record<string, DocumentAnalysisStatus>> {
	if (ids.length === 0) return {};
	const query = encodeURIComponent(ids.join(','));
	const response = await fetch(`/api/documents/statuses?ids=${query}`).catch(
		() => null,
	);
	if (!response || !response.ok) return {};
	const { statuses } = (await response.json()) as {
		statuses?: Record<string, DocumentAnalysisStatus>;
	};
	return statuses ?? {};
}

/**
 * Re-runs the automatic analysis of a document whose previous attempt failed.
 * Returns true once the re-analysis has been queued.
 */
export async function reanalyzeDocument(id: string): Promise<boolean> {
	const response = await fetch(
		`/api/documents/${encodeURIComponent(id)}/reanalyze`,
		{ method: 'POST' },
	).catch(() => null);
	return !!response && response.ok;
}

/** A document with its fresh preview URL and cached LLM analysis. */
export type DocumentDetail = {
	url: string | null;
	analysisStatus: DocumentAnalysisStatus;
	analysis: DocumentAnalysis | null;
	analyzedAt: string | null;
};

/**
 * Fetches a single document's preview URL together with its cached ISEEU
 * analysis, used to show the extracted findings next to the preview.
 */
export async function fetchDocumentDetail(
	id: string,
): Promise<DocumentDetail | null> {
	const response = await fetch(
		`/api/documents/${encodeURIComponent(id)}`,
	).catch(() => null);
	if (!response || !response.ok) return null;
	const data = (await response.json()) as {
		url?: string;
		analysisStatus?: DocumentAnalysisStatus;
		analysis?: DocumentAnalysis | null;
		analyzedAt?: string | null;
	};
	return {
		url: data.url ?? null,
		analysisStatus: data.analysisStatus ?? 'pending',
		analysis: data.analysis ?? null,
		analyzedAt: data.analyzedAt ?? null,
	};
}

/** A saved calculation that references a document. */
export type DocumentUsage = {
	id: string;
	title: string;
};

/**
 * Fetches the saved calculations that reference a document, used to warn the
 * user before deleting it. Returns an empty list on any failure.
 */
export async function fetchDocumentUsage(id: string): Promise<DocumentUsage[]> {
	const response = await fetch(
		`/api/documents/${encodeURIComponent(id)}/usage`,
	).catch(() => null);
	if (!response || !response.ok) return [];
	const { calculations } = (await response.json()) as {
		calculations?: DocumentUsage[];
	};
	return calculations ?? [];
}

/** Renames a document. Returns true on success. */
export async function renameDocument(
	id: string,
	name: string,
): Promise<boolean> {
	const trimmed = name.trim();
	if (!trimmed) return false;
	const response = await fetch(`/api/documents/${encodeURIComponent(id)}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name: trimmed }),
	}).catch(() => null);
	return !!response && response.ok;
}

/** Deletes a document from both R2 and the database. */
export async function deleteDocument(id: string): Promise<boolean> {
	const response = await fetch(`/api/documents/${encodeURIComponent(id)}`, {
		method: 'DELETE',
	}).catch(() => null);
	return !!response && response.ok;
}
