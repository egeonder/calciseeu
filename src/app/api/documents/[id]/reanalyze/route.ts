import { and, eq, inArray } from 'drizzle-orm';
import { headers } from 'next/headers';
import { after } from 'next/server';

import { db } from '@/src/db';
import { document } from '@/src/db/schema';
import { auth } from '@/src/lib/auth';
import { runDocumentAnalysis } from '@/src/lib/document-analysis';
import { requireProUser } from '@/src/lib/pro';

/**
 * Re-runs the ISEEU analysis for a document whose previous attempt failed (or
 * completed and the user wants a fresh read). The status is reset to `pending`
 * synchronously so the caller immediately sees the "analyzing" state and can
 * poll, while the model call itself runs in the background via `after()`.
 */
export async function POST(
	_request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const session = await auth.api
		.getSession({ headers: await headers() })
		.catch(() => null);

	if (!session) {
		return Response.json({ error: 'Unauthorized.' }, { status: 401 });
	}

	const proRequired = await requireProUser(session.user.id);
	if (proRequired) return proRequired;

	const { id } = await params;

	// Only re-queue documents that are not already in flight, so a double click
	// can't enqueue the same analysis twice.
	const reset = await db
		.update(document)
		.set({ analysisStatus: 'pending', analysisError: null })
		.where(
			and(
				eq(document.id, id),
				eq(document.userId, session.user.id),
				inArray(document.analysisStatus, ['failed', 'completed']),
			),
		)
		.returning({ id: document.id });

	if (reset.length === 0) {
		// Either the document isn't owned by this user, or its analysis is
		// already pending/processing — nothing more to do.
		const [row] = await db
			.select({ id: document.id })
			.from(document)
			.where(
				and(
					eq(document.id, id),
					eq(document.userId, session.user.id),
				),
			)
			.limit(1);
		if (!row) {
			return Response.json({ error: 'Not found.' }, { status: 404 });
		}
		return Response.json({ ok: true });
	}

	const userId = session.user.id;
	after(() => runDocumentAnalysis(id, userId));

	return Response.json({ ok: true });
}
