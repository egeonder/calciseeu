import { and, desc, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { after } from 'next/server';

import { db } from '@/src/db';
import { document } from '@/src/db/schema';
import { auth } from '@/src/lib/auth';
import { runDocumentAnalysis } from '@/src/lib/document-analysis';
import {
	buildDocumentKey,
	duplicateDocumentMessage,
	isValidDocumentHash,
	MAX_DOCUMENT_COUNT,
	validateDocumentInput,
} from '@/src/lib/documents';
import { requireProUser } from '@/src/lib/pro';
import { createDownloadUrl, deleteObject, objectExists } from '@/src/lib/r2';

/** Lists the signed-in user's uploaded documents with fresh preview URLs. */
export async function GET() {
	const session = await auth.api
		.getSession({ headers: await headers() })
		.catch(() => null);

	if (!session) {
		return Response.json({ error: 'Unauthorized.' }, { status: 401 });
	}

	const proRequired = await requireProUser(session.user.id);
	if (proRequired) return proRequired;

	const rows = await db
		.select()
		.from(document)
		.where(eq(document.userId, session.user.id))
		.orderBy(desc(document.createdAt));

	const documents = await Promise.all(
		rows.map(async (row) => ({
			id: row.id,
			name: row.name,
			size: row.size,
			type: row.type,
			createdAt: row.createdAt,
			url: await createDownloadUrl(row.key),
			analysisStatus: row.analysisStatus,
		})),
	);

	return Response.json({ documents });
}

/**
 * Records a document in the database once the browser has finished uploading
 * it to R2. The object key is rebuilt server-side from the user and document
 * id so a client cannot claim a path it does not own.
 */
export async function POST(request: Request) {
	const session = await auth.api
		.getSession({ headers: await headers() })
		.catch(() => null);

	if (!session) {
		return Response.json({ error: 'Unauthorized.' }, { status: 401 });
	}

	const proRequired = await requireProUser(session.user.id);
	if (proRequired) return proRequired;

	const body = (await request.json().catch(() => null)) as {
		id?: unknown;
		name?: unknown;
		size?: unknown;
		type?: unknown;
		hash?: unknown;
	} | null;

	const id = typeof body?.id === 'string' ? body.id : '';
	const name = typeof body?.name === 'string' ? body.name.slice(0, 255) : '';
	const size = typeof body?.size === 'number' ? body.size : Number.NaN;
	const type = typeof body?.type === 'string' ? body.type : '';

	if (!id) {
		return Response.json({ error: 'Missing document id.' }, { status: 400 });
	}

	const validationError = validateDocumentInput({ name, size, type });
	if (validationError) {
		return Response.json({ error: validationError }, { status: 400 });
	}

	if (!isValidDocumentHash(body?.hash)) {
		return Response.json({ error: 'Geçersiz dosya.' }, { status: 400 });
	}
	const hash = body.hash;

	const key = buildDocumentKey(session.user.id, id);

	// Re-check the dedupe constraint here too: two concurrent uploads of the
	// same file can both pass the upload-url check, so the loser is caught at
	// confirm time and its now-orphaned object is removed from R2.
	const [duplicate] = await db
		.select({ id: document.id, name: document.name })
		.from(document)
		.where(
			and(eq(document.userId, session.user.id), eq(document.hash, hash)),
		)
		.limit(1);

	if (duplicate && duplicate.id !== id) {
		await deleteObject(key).catch(() => {});
		return Response.json(
			{ error: duplicateDocumentMessage(duplicate.name), code: 'duplicate' },
			{ status: 409 },
		);
	}

	const count = await db.$count(
		document,
		eq(document.userId, session.user.id),
	);
	if (count >= MAX_DOCUMENT_COUNT) {
		return Response.json(
			{ error: `En fazla ${MAX_DOCUMENT_COUNT} belge yükleyebilirsiniz.` },
			{ status: 409 },
		);
	}

	// Only persist documents that actually made it into the bucket.
	if (!(await objectExists(key))) {
		return Response.json(
			{ error: 'Yükleme tamamlanamadı.' },
			{ status: 400 },
		);
	}

	const inserted = await db
		.insert(document)
		.values({ id, userId: session.user.id, key, name, size, type, hash })
		.onConflictDoNothing()
		.returning({ id: document.id });

	// Analyze the document for ISEEU findings once, in the background, so the
	// upload response is not blocked on the LLM. Only for genuinely new rows.
	if (inserted.length > 0) {
		const userId = session.user.id;
		after(() => runDocumentAnalysis(id, userId));
	}

	const url = await createDownloadUrl(key);

	return Response.json(
		{ document: { id, name, size, type, url } },
		{ status: 201 },
	);
}
