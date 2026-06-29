'use client';

import { useCallback, useEffect, useState } from 'react';

import type { DocumentAnalysisStatus } from '@/src/db/schema';
import { fetchDocumentStatuses } from '@/src/lib/document-library';

/**
 * Polls the analysis status of a set of documents so list views can flag the
 * ones that failed to analyze — and therefore can't feed the calculation —
 * without opening each preview. Polls every 4s while any document is still
 * pending or processing, then stops.
 *
 * `refresh()` re-runs the poll on demand, used after a retry kicked off from a
 * preview so the list resumes polling and reflects the new outcome (polling
 * otherwise stays stopped on the terminal `failed` state).
 */
export function useDocumentAnalysisStatuses(ids: string[]): {
	statuses: Record<string, DocumentAnalysisStatus>;
	refresh: () => void;
} {
	const [statuses, setStatuses] = useState<
		Record<string, DocumentAnalysisStatus>
	>({});
	const [nonce, setNonce] = useState(0);

	// Stable key so the effect only re-runs when the set of ids actually changes,
	// not on every render that produces a fresh array.
	const key = ids.join(',');

	useEffect(() => {
		const list = key ? key.split(',') : [];
		if (list.length === 0) {
			setStatuses({});
			return;
		}

		let active = true;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const load = async () => {
			const next = await fetchDocumentStatuses(list);
			if (!active) return;
			setStatuses(next);
			const running = Object.values(next).some(
				(status) => status === 'pending' || status === 'processing',
			);
			if (running) timer = setTimeout(load, 4000);
		};

		void load();
		return () => {
			active = false;
			if (timer) clearTimeout(timer);
		};
	}, [key, nonce]);

	const refresh = useCallback(() => setNonce((value) => value + 1), []);

	return { statuses, refresh };
}
