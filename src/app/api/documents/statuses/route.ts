import { and, eq, inArray } from 'drizzle-orm';
import { headers } from 'next/headers';

import { db } from '@/src/db';
import { document, type DocumentAnalysisStatus } from '@/src/db/schema';
import { auth } from '@/src/lib/auth';

/**
 * Returns the analysis status of a set of the signed-in user's documents,
 * keyed by id. Used by list views to flag documents that failed to analyze —
 * and therefore can't feed the calculation — without opening each preview.
 */
export async function GET(request: Request) {
	const session = await auth.api
		.getSession({ headers: await headers() })
		.catch(() => null);

	if (!session) {
		return Response.json({ error: 'Unauthorized.' }, { status: 401 });
	}

	const ids = (new URL(request.url).searchParams.get('ids') ?? '')
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean);

	if (ids.length === 0) {
		return Response.json({ statuses: {} });
	}

	const rows = await db
		.select({ id: document.id, analysisStatus: document.analysisStatus })
		.from(document)
		.where(
			and(
				eq(document.userId, session.user.id),
				inArray(document.id, ids),
			),
		);

	const statuses: Record<string, DocumentAnalysisStatus> = {};
	for (const row of rows) statuses[row.id] = row.analysisStatus;

	return Response.json({ statuses });
}
