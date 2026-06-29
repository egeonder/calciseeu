'use client';

import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent,
} from 'react';
import Fuse from 'fuse.js';
import {
	ArrowClockwiseIcon,
	CheckCircleIcon,
	CheckIcon,
	EyeIcon,
	FileImageIcon,
	FilePdfIcon,
	FolderOpenIcon,
	MagnifyingGlassIcon,
	TrashIcon,
	UploadSimpleIcon,
	WarningCircleIcon,
	XIcon,
} from '@phosphor-icons/react';

import { Alert, AlertDescription, AlertTitle } from '@/src/components/ui/alert';
import { Button } from '@/src/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/src/components/ui/dialog';
import { Input } from '@/src/components/ui/input';
import { Progress } from '@/src/components/ui/progress';
import {
	DOCUMENT_ACCEPT,
	DOCUMENT_ACCEPT_LABEL,
	MAX_DOCUMENT_COUNT,
	MAX_DOCUMENT_SIZE,
} from '@/src/lib/documents';
import {
	deleteDocument,
	fetchDocuments,
	type LibraryDocument,
} from '@/src/lib/document-library';
import { DocumentPreviewDialog } from '@/src/components/document-preview-dialog';
import { useDocumentAnalysisStatuses } from '@/src/hooks/use-document-analysis-statuses';
import {
	formatBytes,
	useFileUpload,
	type FileMetadata,
	type FileWithPreview,
} from '@/src/hooks/use-file-upload';
import { uploadDocument } from '@/src/lib/document-upload';
import { useWindowFileDrop } from '@/src/hooks/use-window-file-drop';
import { PageUploadOverlay } from '@/src/components/page-upload-overlay';
import { LoginPromptDialog } from '@/src/components/login-prompt-dialog';
import type { AutomaticDocumentRef } from '@/src/lib/automatic';
import { useAppSession } from '@/src/lib/session';
import { cn } from '@/lib/utils';

type AutomaticDocumentUploadProps = {
	className?: string;
	onFilesChange?: (files: FileWithPreview[]) => void;
	/** Emits resolved documents (real document ids + preview URLs) whenever the
	 * selection or upload status changes. */
	onDocumentsChange?: (documents: AutomaticDocumentRef[]) => void;
};

type UploadStatus = 'uploading' | 'done' | 'error';

type UploadInfo = {
	status: UploadStatus;
	progress: number;
	documentId?: string;
	error?: string;
};

function isPdf(file: FileWithPreview['file'] | LibraryDocument) {
	return file.type === 'application/pdf';
}

function FileTypeIcon({
	file,
}: {
	file: FileWithPreview['file'] | LibraryDocument;
}) {
	if (isPdf(file)) return <FilePdfIcon weight="duotone" />;
	return <FileImageIcon weight="duotone" />;
}

export function AutomaticDocumentUpload({
	className,
	onFilesChange,
	onDocumentsChange,
}: AutomaticDocumentUploadProps) {
	const { session } = useAppSession();
	const isSignedIn = !!session;
	const [loginPromptOpen, setLoginPromptOpen] = useState(false);
	const [selectedFile, setSelectedFile] = useState<FileWithPreview | null>(
		null,
	);
	const [uploads, setUploads] = useState<Record<string, UploadInfo>>({});

	// Document library picker state.
	const [pickerOpen, setPickerOpen] = useState(false);
	const [library, setLibrary] = useState<LibraryDocument[] | null>(null);
	const [librarySearch, setLibrarySearch] = useState('');
	const [picked, setPicked] = useState<Set<string>>(new Set());

	// Live XMLHttpRequest per local file id, so an in-flight upload can be
	// aborted when the user removes the file before it finishes.
	const xhrRefs = useRef<Map<string, XMLHttpRequest>>(new Map());

	const setUpload = useCallback((id: string, info: UploadInfo) => {
		setUploads((prev) => ({ ...prev, [id]: info }));
	}, []);

	const startUpload = useCallback(
		(item: FileWithPreview) => {
			if (!(item.file instanceof File)) return;
			if (!isSignedIn) {
				setLoginPromptOpen(true);
				return;
			}
			const file = item.file;
			setUpload(item.id, { status: 'uploading', progress: 0 });

			uploadDocument(
				file,
				(progress) =>
					setUpload(item.id, { status: 'uploading', progress }),
				(xhr) => {
					if (xhr) xhrRefs.current.set(item.id, xhr);
					else xhrRefs.current.delete(item.id);
				},
			)
				.then((documentId) =>
					setUpload(item.id, {
						status: 'done',
						progress: 1,
						documentId,
					}),
				)
				.catch((error: unknown) => {
					if (
						error instanceof DOMException &&
						error.name === 'AbortError'
					) {
						return;
					}
					setUpload(item.id, {
						status: 'error',
						progress: 0,
						error:
							error instanceof Error
								? error.message
								: 'Dosya yüklenemedi.',
					});
				});
		},
		[isSignedIn, setUpload],
	);

	const [
		{ files, errors },
		{
			addFiles,
			addExistingFiles,
			removeFile,
			clearFiles,
			openFileDialog,
			getInputProps,
		},
	] = useFileUpload({
		maxFiles: MAX_DOCUMENT_COUNT,
		maxSize: MAX_DOCUMENT_SIZE,
		accept: DOCUMENT_ACCEPT,
		multiple: true,
		onFilesChange,
		onFilesAdded: (added) => added.forEach(startUpload),
	});

	// Dropping files anywhere on the page (outside the sidebar) adds them to
	// the selection and uploads them, just like the drop zone above.
	const requestFileDialog = useCallback(() => {
		if (!isSignedIn) {
			setLoginPromptOpen(true);
			return;
		}
		openFileDialog();
	}, [isSignedIn, openFileDialog]);

	const dragActive = useWindowFileDrop((droppedFiles) => {
		if (!isSignedIn) {
			setLoginPromptOpen(true);
			return;
		}
		addFiles(droppedFiles);
	});

	const totalSize = useMemo(
		() => files.reduce((size, item) => size + item.file.size, 0),
		[files],
	);

	/** Resolves the saved document id for a file, if it has one. */
	const documentIdFor = useCallback(
		(item: FileWithPreview) =>
			item.file instanceof File ? uploads[item.id]?.documentId : item.id,
		[uploads],
	);

	// The saved document id behind the previewed file (a session upload's id is
	// resolved from its upload state; a library document already has one).
	const previewDocumentId = selectedFile
		? documentIdFor(selectedFile)
		: undefined;

	// Poll analysis status for every resolved document so a failed analysis is
	// flagged on its card — letting the user know it can't feed the calculation
	// before they ever open the preview.
	const analysisIds = useMemo(
		() =>
			files
				.map((item) => documentIdFor(item))
				.filter((id): id is string => !!id),
		[files, documentIdFor],
	);
	const { statuses: analysisStatuses, refresh: refreshAnalysisStatuses } =
		useDocumentAnalysisStatuses(analysisIds);

	// Resolved descriptors carrying the *real* document id (not the local file
	// id) and a preview URL, so the overview can rename/preview each document.
	const resolvedDocuments = useMemo<AutomaticDocumentRef[]>(
		() =>
			files.map((item) => ({
				id: documentIdFor(item) ?? item.id,
				name: item.file.name,
				size: item.file.size,
				type: item.file.type,
				url: item.preview,
			})),
		[files, documentIdFor],
	);

	useEffect(() => {
		onDocumentsChange?.(resolvedDocuments);
	}, [resolvedDocuments, onDocumentsChange]);

	/** Document ids already in the current selection (uploaded or picked). */
	const selectedDocumentIds = useMemo(() => {
		const ids = new Set<string>();
		for (const item of files) {
			const id = documentIdFor(item);
			if (id) ids.add(id);
		}
		return ids;
	}, [files, documentIdFor]);

	const deleteRemote = useCallback(async (documentId: string) => {
		await deleteDocument(documentId);
	}, []);

	const handleRemove = useCallback(
		(item: FileWithPreview) => {
			xhrRefs.current.get(item.id)?.abort();
			xhrRefs.current.delete(item.id);

			// Files uploaded in this session are deleted from the library;
			// documents picked from the library are only de-selected.
			if (item.file instanceof File) {
				const documentId = uploads[item.id]?.documentId;
				if (documentId) void deleteRemote(documentId);
			}

			removeFile(item.id);
			setUploads((prev) => {
				const next = { ...prev };
				delete next[item.id];
				return next;
			});
		},
		[deleteRemote, removeFile, uploads],
	);

	const handleClearAll = useCallback(() => {
		for (const item of files) {
			xhrRefs.current.get(item.id)?.abort();
			if (item.file instanceof File) {
				const documentId = uploads[item.id]?.documentId;
				if (documentId) void deleteRemote(documentId);
			}
		}
		xhrRefs.current.clear();
		clearFiles();
		setUploads({});
	}, [clearFiles, deleteRemote, files, uploads]);

	// --- Library picker ----------------------------------------------------

	const openPicker = useCallback(() => {
		if (!isSignedIn) {
			setLoginPromptOpen(true);
			return;
		}
		setPickerOpen(true);
		setLibrarySearch('');
		setPicked(new Set());
		setLibrary(null);
		void fetchDocuments().then(setLibrary);
	}, [isSignedIn]);

	const availableLibrary = useMemo(
		() =>
			library?.filter((doc) => !selectedDocumentIds.has(doc.id)) ?? [],
		[library, selectedDocumentIds],
	);
	const libraryFuse = useMemo(
		() => new Fuse(availableLibrary, { keys: ['name'], threshold: 0.4 }),
		[availableLibrary],
	);
	const visibleLibrary = useMemo(() => {
		const query = librarySearch.trim();
		return query
			? libraryFuse.search(query).map(({ item }) => item)
			: availableLibrary;
	}, [availableLibrary, libraryFuse, librarySearch]);

	const togglePicked = useCallback((id: string) => {
		setPicked((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const confirmPick = useCallback(() => {
		if (!library) return;
		const metas: FileMetadata[] = library
			.filter((doc) => picked.has(doc.id))
			.map((doc) => ({
				id: doc.id,
				name: doc.name,
				size: doc.size,
				type: doc.type,
				url: doc.url,
			}));

		addExistingFiles(metas);
		setUploads((prev) => {
			const next = { ...prev };
			for (const meta of metas) {
				next[meta.id] = {
					status: 'done',
					progress: 1,
					documentId: meta.id,
				};
			}
			return next;
		});
		setPickerOpen(false);
	}, [addExistingFiles, library, picked]);

	const handleKeyboardOpen = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		requestFileDialog();
	};

	return (
		<section className={cn('space-y-5', className)}>
			<div
				role="button"
				tabIndex={0}
				onClick={requestFileDialog}
				onKeyDown={handleKeyboardOpen}
				className={cn(
					'relative overflow-hidden rounded-xl border border-dashed border-border bg-card p-6 text-left outline-none transition-colors hover:border-primary/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 sm:p-8',
				)}
			>
				<input
					{...getInputProps({ 'aria-label': 'Belge seç' })}
					className="sr-only"
				/>
				<div className="flex flex-col gap-5 sm:flex-row items-center">
					<div className="grid size-14 shrink-0 place-items-center rounded-lg border border-border bg-background text-muted-foreground">
						<UploadSimpleIcon className="size-7" />
					</div>
					<div className="min-w-0 flex-1 space-y-1 text-center sm:text-start">
						<h2 className="text-base font-medium">
							CAF belgelerini yükleyin
						</h2>
						<p className="text-sm text-muted-foreground">
							{DOCUMENT_ACCEPT_LABEL} belgelerini buraya
							sürükleyin, dosya seçin ya da daha önce
							yüklediklerinizden seçin.
						</p>
						<p className="text-xs text-muted-foreground">
							Dosya başına {formatBytes(MAX_DOCUMENT_SIZE)} · en
							fazla {MAX_DOCUMENT_COUNT} belge
						</p>
					</div>
					<div className="flex flex-col gap-2 self-start sm:self-center w-full sm:w-auto">
						<Button
							type="button"
							onClick={(event) => {
								event.stopPropagation();
								requestFileDialog();
							}}
						>
							<UploadSimpleIcon /> Dosya seç
						</Button>
						<Button
							type="button"
							variant="outline"
							onClick={(event) => {
								event.stopPropagation();
								openPicker();
							}}
						>
							<FolderOpenIcon /> Belgelerimden seç
						</Button>
					</div>
				</div>
			</div>

			{errors.length > 0 && (
				<Alert variant="destructive">
					<WarningCircleIcon />
					<AlertTitle>Dosya yüklenemedi</AlertTitle>
					<AlertDescription>
						{errors.map((error) => (
							<p key={error}>{error}</p>
						))}
					</AlertDescription>
				</Alert>
			)}

			{files.length > 0 && (
				<div className="space-y-3">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<h3 className="text-sm font-medium">
								Seçili belgeler ({files.length}/
								{MAX_DOCUMENT_COUNT})
							</h3>
							<p className="text-xs text-muted-foreground">
								Toplam {formatBytes(totalSize)}
							</p>
						</div>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={handleClearAll}
						>
							<TrashIcon /> Tümünü temizle
						</Button>
					</div>

					<div className="grid gap-3 md:grid-cols-2">
						{files.map((item) => {
							const upload = uploads[item.id];
							const status = upload?.status ?? 'done';
							const progress = Math.round(
								(upload?.progress ?? 1) * 100,
							);
							const canPreview =
								status === 'done' && !!item.preview;
							const isLibraryDoc = !(item.file instanceof File);
							const docId = documentIdFor(item);
							const analysisFailed =
								status === 'done' &&
								!!docId &&
								analysisStatuses[docId] === 'failed';

							return (
								<article
									key={item.id}
									className="group flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-3 transition-colors hover:border-primary/40"
								>
									<div className="flex min-w-0 items-center gap-3">
										<div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg border bg-background text-primary">
											{!isPdf(item.file) &&
											item.preview ? (
												<img
													src={item.preview}
													alt=""
													className="size-full object-cover"
												/>
											) : (
												<FileTypeIcon
													file={item.file}
												/>
											)}
										</div>
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-medium">
												{item.file.name}
											</p>
											<p className="flex items-center gap-1.5 text-xs text-muted-foreground">
												{formatBytes(item.file.size)}
												{status === 'done' && (
													<CheckCircleIcon
														weight="fill"
														className="text-emerald-500"
													/>
												)}
											</p>
										</div>
										<div className="flex shrink-0 items-center gap-1">
											{status === 'error' && (
												<Button
													type="button"
													variant="ghost"
													size="icon-sm"
													aria-label={`${item.file.name} yeniden dene`}
													onClick={() =>
														startUpload(item)
													}
												>
													<ArrowClockwiseIcon />
												</Button>
											)}
											{canPreview && (
												<Button
													type="button"
													variant="ghost"
													size="icon-sm"
													aria-label={`${item.file.name} önizle`}
													onClick={() =>
														setSelectedFile(item)
													}
												>
													<EyeIcon />
												</Button>
											)}
											<Button
												type="button"
												variant="ghost"
												size="icon-sm"
												aria-label={
													isLibraryDoc
														? `${item.file.name} seçimden çıkar`
														: `${item.file.name} kaldır`
												}
												onClick={() =>
													handleRemove(item)
												}
											>
												<XIcon />
											</Button>
										</div>
									</div>

									{status === 'uploading' && (
										<div className="flex items-center gap-2">
											<Progress
												value={progress}
												className="flex-1"
											/>
											<span className="text-xs tabular-nums text-muted-foreground">
												{progress}%
											</span>
										</div>
									)}
									{status === 'error' && (
										<p className="text-xs text-destructive">
											{upload?.error ??
												'Dosya yüklenemedi.'}
										</p>
									)}
									{analysisFailed && (
										<p className="flex items-center gap-1.5 text-xs text-destructive">
											<WarningCircleIcon
												weight="fill"
												className="shrink-0"
											/>
											Belge analiz edilemedi. Önizleyip
											yeniden deneyin.
										</p>
									)}
								</article>
							);
						})}
					</div>
				</div>
			)}

			{/* Preview dialog */}
			<DocumentPreviewDialog
				document={
					selectedFile && previewDocumentId
						? {
								id: previewDocumentId,
								name: selectedFile.file.name,
								type: selectedFile.file.type,
								url: selectedFile.preview,
							}
						: null
				}
				onOpenChange={(open) => {
					if (!open) setSelectedFile(null);
				}}
				onReanalyzed={refreshAnalysisStatuses}
			/>

			{/* Library picker dialog */}
			<Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
				<DialogContent className="flex max-h-[calc(100dvh-3rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
					<DialogHeader className="border-b px-4 py-3">
						<DialogTitle>Belgelerimden seç</DialogTitle>
					</DialogHeader>
					<div className="border-b p-3">
						<div className="relative">
							<MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
							<Input
								value={librarySearch}
								onChange={(event) =>
									setLibrarySearch(event.currentTarget.value)
								}
								placeholder="Belgelerde ara"
								className="h-9 pl-8"
							/>
						</div>
					</div>
					<div className="min-h-40 flex-1 overflow-y-auto p-2">
						{library === null ? (
							<div className="grid h-40 place-items-center">
								<span
									aria-label="Belgeler yükleniyor"
									className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
								/>
							</div>
						) : visibleLibrary.length === 0 ? (
							<p className="grid h-40 place-items-center px-4 text-center text-sm text-muted-foreground">
								{librarySearch
									? 'Aramanızla eşleşen belge yok.'
									: 'Seçilebilecek başka belge yok.'}
							</p>
						) : (
							<ul className="space-y-1">
								{visibleLibrary.map((doc) => {
									const isPicked = picked.has(doc.id);
									return (
										<li key={doc.id}>
											<button
												type="button"
												onClick={() =>
													togglePicked(doc.id)
												}
												aria-pressed={isPicked}
												className={cn(
													'flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors',
													isPicked
														? 'border-primary bg-primary/5'
														: 'border-transparent hover:bg-muted',
												)}
											>
												<span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md border bg-background text-primary">
													{!isPdf(doc) ? (
														<img
															src={doc.url}
															alt=""
															className="size-full object-cover"
														/>
													) : (
														<FileTypeIcon
															file={doc}
														/>
													)}
												</span>
												<span className="min-w-0 flex-1">
													<span className="block truncate text-sm font-medium">
														{doc.name}
													</span>
													<span className="block text-xs text-muted-foreground">
														{formatBytes(doc.size)}
													</span>
												</span>
												<span
													className={cn(
														'grid size-5 shrink-0 place-items-center rounded-full border transition-colors',
														isPicked
															? 'border-primary bg-primary text-primary-foreground'
															: 'border-muted-foreground/40',
													)}
												>
													{isPicked && (
														<CheckIcon className="size-3" />
													)}
												</span>
											</button>
										</li>
									);
								})}
							</ul>
						)}
					</div>
					<div className="flex items-center justify-between gap-3 border-t p-3">
						<span className="text-xs text-muted-foreground">
							{picked.size} belge seçildi
						</span>
						<div className="flex items-center gap-2">
							<Button
								type="button"
								variant="outline"
								onClick={() => setPickerOpen(false)}
							>
								Vazgeç
							</Button>
							<Button
								type="button"
								disabled={picked.size === 0}
								onClick={confirmPick}
							>
								Ekle{picked.size > 0 ? ` (${picked.size})` : ''}
							</Button>
						</div>
					</div>
				</DialogContent>
			</Dialog>

			<PageUploadOverlay active={dragActive} />

			<LoginPromptDialog
				open={loginPromptOpen}
				onOpenChange={setLoginPromptOpen}
				title="Belge yüklemek için giriş yapın"
				description="Belgelerinizi hesabınıza yüklemek ve otomatik hesaplamada kullanmak için giriş yapmanız gerekir."
			/>
		</section>
	);
}
