'use client';

import { useCallback, useEffect, useState } from 'react';

import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/src/components/ui/dialog';
import { DocumentAnalysisPanel } from '@/src/components/document-analysis-panel';
import {
	fetchDocumentDetail,
	reanalyzeDocument,
	type DocumentDetail,
} from '@/src/lib/document-library';
import { cn } from '@/lib/utils';

/** Minimal descriptor needed to preview a document and load its analysis. */
export type PreviewDocument = {
	id: string;
	name: string;
	type: string;
	/** Fallback preview URL (e.g. a session blob) used until a fresh one loads. */
	url?: string | null;
};

/**
 * Shared document preview: the file on one side and its cached ISEEU analysis
 * on the other. Used by the documents library, the automatic upload step, and
 * the automatic overview so all three look and behave the same.
 *
 * Layout: side-by-side on large screens (each pane scrolls independently);
 * stacked on mobile with the analysis below the preview and the whole dialog
 * scrollable.
 */
export function DocumentPreviewDialog({
	document: doc,
	onOpenChange,
	onRename,
	onReanalyzed,
}: {
	document: PreviewDocument | null;
	onOpenChange: (open: boolean) => void;
	/** Renames the document; returns whether it succeeded. Omit to hide rename. */
	onRename?: (id: string, newName: string) => Promise<boolean>;
	/** Called after a failed analysis is re-queued, so callers can refresh any
	 * list status they show alongside the preview. */
	onReanalyzed?: (id: string) => void;
}) {
	const [detail, setDetail] = useState<DocumentDetail | null>(null);
	const [previewLoading, setPreviewLoading] = useState(false);
	const [retrying, setRetrying] = useState(false);
	// Bumped to re-run the loader (and resume polling) after a retry, without
	// resetting the file preview the way opening a new document does.
	const [reloadKey, setReloadKey] = useState(0);

	const docId = doc?.id;

	// Reset the loaded detail + preview spinner whenever a different document
	// opens (but not on a retry-triggered reload).
	useEffect(() => {
		setDetail(null);
		setPreviewLoading(true);
	}, [docId]);

	// Load the fresh preview URL + cached analysis, polling while the analysis
	// is still running. Re-runs on retry via `reloadKey`.
	useEffect(() => {
		if (!docId) return;
		let active = true;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const load = async () => {
			const next = await fetchDocumentDetail(docId);
			if (!active) return;
			setDetail(next);
			if (
				next?.analysisStatus === 'pending' ||
				next?.analysisStatus === 'processing'
			) {
				timer = setTimeout(load, 4000);
			}
		};
		void load();
		return () => {
			active = false;
			if (timer) clearTimeout(timer);
		};
	}, [docId, reloadKey]);

	const handleRetry = useCallback(async () => {
		if (!docId) return;
		setRetrying(true);
		const ok = await reanalyzeDocument(docId);
		setRetrying(false);
		if (!ok) return;
		// Optimistically show the analyzing state and resume polling.
		setDetail((current) =>
			current
				? { ...current, analysisStatus: 'pending', analysis: null }
				: current,
		);
		setReloadKey((key) => key + 1);
		onReanalyzed?.(docId);
	}, [docId, onReanalyzed]);

	const isPdf = doc?.type === 'application/pdf';
	// Prefer the freshly signed URL (persisted ones expire); fall back to any
	// URL the caller already had (a session blob).
	const previewUrl = detail?.url ?? doc?.url ?? null;

	return (
		<Dialog open={!!doc} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-5xl">
				<DialogHeader className="shrink-0 border-b px-4 py-3">
					<DialogTitle className="truncate pr-8">
						{doc?.name}
					</DialogTitle>
				</DialogHeader>

				<div className="flex max-h-[calc(100dvh-8rem)] min-h-0 flex-col overflow-y-auto lg:max-h-[calc(100dvh-7rem)] lg:flex-row lg:overflow-hidden">
					<div className="relative grid min-h-[45dvh] shrink-0 place-items-center bg-muted/40 p-4 lg:min-h-0 lg:flex-1">
						{previewLoading && previewUrl && (
							<span
								aria-label="Önizleme yükleniyor"
								className="absolute size-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
							/>
						)}
						{doc && previewUrl ? (
							isPdf ? (
								<iframe
									title={doc.name}
									src={previewUrl}
									onLoad={() => setPreviewLoading(false)}
									className={cn(
										'h-[50dvh] w-full rounded-lg border bg-background transition-opacity lg:h-[72dvh]',
										previewLoading
											? 'opacity-0'
											: 'opacity-100',
									)}
								/>
							) : (
								<img
									src={previewUrl}
									alt={doc.name}
									onLoad={() => setPreviewLoading(false)}
									className={cn(
										'max-h-[50dvh] max-w-full rounded-lg object-contain transition-opacity lg:max-h-[72dvh]',
										previewLoading
											? 'opacity-0'
											: 'opacity-100',
									)}
								/>
							)
						) : doc && !previewLoading ? (
							<p className="text-sm text-muted-foreground">
								Önizleme kullanılamıyor.
							</p>
						) : null}
					</div>

					<aside className="flex shrink-0 flex-col border-t lg:w-96 lg:min-h-0 lg:border-t-0 lg:border-l lg:overflow-hidden">
						<div className="shrink-0 border-b px-4 py-3">
							<h3 className="text-sm font-semibold">
								Belgeden çıkarılan bilgiler
							</h3>
							<p className="text-xs text-muted-foreground">
								ISEEU hesabı için otomatik okunan veriler.
							</p>
						</div>
						<div className="p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
							<DocumentAnalysisPanel
								status={detail?.analysisStatus ?? 'pending'}
								analysis={detail?.analysis ?? null}
								currentName={doc?.name}
								onRename={
									onRename && doc
										? (newName) => onRename(doc.id, newName)
										: undefined
								}
								onRetry={handleRetry}
								retrying={retrying}
							/>
						</div>
					</aside>
				</div>
			</DialogContent>
		</Dialog>
	);
}
