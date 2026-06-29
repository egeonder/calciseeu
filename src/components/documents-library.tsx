'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Fuse from 'fuse.js';
import {
	ArrowClockwiseIcon,
	ArrowsDownUpIcon,
	CheckIcon,
	EyeIcon,
	FileImageIcon,
	FilePdfIcon,
	FunnelSimpleIcon,
	MagnifyingGlassIcon,
	PencilSimpleIcon,
	TrashIcon,
	UploadSimpleIcon,
	WarningCircleIcon,
	XIcon,
} from '@phosphor-icons/react';
import { toast } from 'sonner';

import { Sidebar } from '@/src/components/sidebar';
import { PageUploadOverlay } from '@/src/components/page-upload-overlay';
import { Button } from '@/src/components/ui/button';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/src/components/ui/alert-dialog';
import { Input } from '@/src/components/ui/input';
import {
	Menu,
	MenuContent,
	MenuItem,
	MenuTrigger,
} from '@/src/components/ui/menu';
import { Progress } from '@/src/components/ui/progress';
import { TooltipProvider } from '@/src/components/ui/tooltip';
import { StoreProvider } from '@/src/lib/store';
import {
	deleteDocument,
	fetchDocuments,
	fetchDocumentUsage,
	renameDocument,
	type DocumentUsage,
	type LibraryDocument,
} from '@/src/lib/document-library';
import { DocumentPreviewDialog } from '@/src/components/document-preview-dialog';
import { useDocumentAnalysisStatuses } from '@/src/hooks/use-document-analysis-statuses';
import { uploadDocument } from '@/src/lib/document-upload';
import { DOCUMENT_ACCEPT, validateDroppedFiles } from '@/src/lib/documents';
import { useWindowFileDrop } from '@/src/hooks/use-window-file-drop';
import { formatBytes } from '@/src/hooks/use-file-upload';
import { LoginPromptDialog } from '@/src/components/login-prompt-dialog';
import { useAppSession } from '@/src/lib/session';
import { cn } from '@/lib/utils';

type TypeFilter = 'all' | 'pdf' | 'image';
type SortKey = 'date' | 'name' | 'size';
type SortDir = 'asc' | 'desc';

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
	{ value: 'all', label: 'Tüm belgeler' },
	{ value: 'pdf', label: 'Yalnızca PDF' },
	{ value: 'image', label: 'Yalnızca görseller' },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
	{ value: 'date', label: 'Yüklenme tarihi' },
	{ value: 'name', label: 'İsim' },
	{ value: 'size', label: 'Boyut' },
];

const dateFormatter = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' });

function isPdf(doc: LibraryDocument) {
	return doc.type === 'application/pdf';
}

/** A document that is mid-upload (or failed) before it joins the library. */
type PendingUpload = {
	localId: string;
	file: File;
	progress: number;
	status: 'uploading' | 'error';
	error?: string;
};

/** Card shown for an in-progress or failed upload, with progress and retry. */
function PendingCard({
	pending,
	onRetry,
	onDismiss,
}: {
	pending: PendingUpload;
	onRetry: (pending: PendingUpload) => void;
	onDismiss: (localId: string) => void;
}) {
	const progress = Math.round(pending.progress * 100);
	const isError = pending.status === 'error';

	return (
		<article className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-3">
			<div className="flex min-w-0 items-center gap-3">
				<div className="grid size-12 shrink-0 place-items-center rounded-lg border bg-background text-primary">
					{pending.file.type === 'application/pdf' ? (
						<FilePdfIcon weight="duotone" />
					) : (
						<FileImageIcon weight="duotone" />
					)}
				</div>
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-medium">
						{pending.file.name}
					</p>
					<p className="text-xs text-muted-foreground">
						{formatBytes(pending.file.size)}
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					{isError && (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label={`${pending.file.name} yeniden dene`}
							onClick={() => onRetry(pending)}
						>
							<ArrowClockwiseIcon />
						</Button>
					)}
					{isError && (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label={`${pending.file.name} kaldır`}
							onClick={() => onDismiss(pending.localId)}
						>
							<XIcon />
						</Button>
					)}
				</div>
			</div>
			{isError ? (
				<p className="text-xs text-destructive">
					{pending.error ?? 'Dosya yüklenemedi.'}
				</p>
			) : (
				<div className="flex items-center gap-2">
					<Progress value={progress} className="flex-1" />
					<span className="text-xs tabular-nums text-muted-foreground">
						{progress}%
					</span>
				</div>
			)}
		</article>
	);
}

/** A single document: preview, rename (button / double-click), or delete. */
function DocumentCard({
	doc,
	analysisStatus,
	onRenamed,
	onDeleted,
	onPreview,
}: {
	doc: LibraryDocument;
	/** Live analysis status, overriding the snapshot loaded with the list. */
	analysisStatus: LibraryDocument['analysisStatus'];
	onRenamed: (id: string, name: string) => void;
	onDeleted: (id: string) => void;
	onPreview: (doc: LibraryDocument) => void;
}) {
	const [editing, setEditing] = useState(false);
	const [removeOpen, setRemoveOpen] = useState(false);
	// null while the usage lookup is in flight; the array once it resolves.
	const [usage, setUsage] = useState<DocumentUsage[] | null>(null);

	const openRemove = () => {
		setRemoveOpen(true);
		setUsage(null);
		void fetchDocumentUsage(doc.id).then(setUsage);
	};

	const commitRename = async (value: string) => {
		setEditing(false);
		const next = value.trim();
		if (!next || next === doc.name) return;

		const previous = doc.name;
		onRenamed(doc.id, next); // optimistic
		const ok = await renameDocument(doc.id, next);
		if (!ok) {
			onRenamed(doc.id, previous); // revert
			toast.error('Ad değiştirilemedi', {
				description: 'Lütfen tekrar deneyin.',
			});
		}
	};

	return (
		<>
			<article className="group flex min-w-0 items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:border-primary/40">
				<button
					type="button"
					onClick={() => onPreview(doc)}
					aria-label={`${doc.name} önizle`}
					className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg border bg-background text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
				>
					{!isPdf(doc) ? (
						<img
							src={doc.url}
							alt=""
							className="size-full object-cover"
						/>
					) : (
						<FilePdfIcon weight="duotone" />
					)}
				</button>

				<div className="min-w-0 flex-1">
					{editing ? (
						<input
							autoFocus
							defaultValue={doc.name}
							onFocus={(event) => event.currentTarget.select()}
							onBlur={(event) =>
								commitRename(event.currentTarget.value)
							}
							onKeyDown={(event) => {
								if (event.key === 'Enter') {
									event.preventDefault();
									void commitRename(
										event.currentTarget.value,
									);
								} else if (event.key === 'Escape') {
									event.preventDefault();
									setEditing(false);
								}
							}}
							className="w-full rounded-md bg-muted px-2 py-1 text-sm text-foreground outline-none ring-2 ring-ring/50"
						/>
					) : (
						<p
							onDoubleClick={() => setEditing(true)}
							className="truncate text-sm font-medium select-none"
							title={doc.name}
						>
							{doc.name}
						</p>
					)}
					<p className="text-xs text-muted-foreground">
						{formatBytes(doc.size)} ·{' '}
						{dateFormatter.format(new Date(doc.createdAt))}
					</p>
					{analysisStatus === 'failed' && (
						<p className="mt-0.5 flex items-center gap-1 text-xs text-destructive">
							<WarningCircleIcon
								weight="fill"
								className="size-3.5 shrink-0"
							/>
							Belge analiz edilemedi
						</p>
					)}
				</div>

				<div className="flex shrink-0 items-center gap-1">
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label={`${doc.name} önizle`}
						onClick={() => onPreview(doc)}
					>
						<EyeIcon />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label={`${doc.name} yeniden adlandır`}
						onClick={() => setEditing(true)}
					>
						<PencilSimpleIcon />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label={`${doc.name} sil`}
						onClick={openRemove}
					>
						<TrashIcon className="text-destructive" />
					</Button>
				</div>
			</article>

			<AlertDialog
				open={removeOpen}
				onOpenChange={(open) => {
					setRemoveOpen(open);
					if (!open) setUsage(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Belgeyi sil?</AlertDialogTitle>
						<AlertDialogDescription>
							“{doc.name}” kalıcı olarak silinecek. Bu işlem geri
							alınamaz.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{usage && usage.length > 0 && (
						<div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
							<p className="font-medium text-destructive">
								Bu belge {usage.length} kayıtlı hesaplamada
								kullanılıyor. Silerseniz şu hesaplamalar
								etkilenecek:
							</p>
							<ul className="mt-2 list-disc space-y-0.5 pl-5 text-muted-foreground">
								{usage.map((calc) => (
									<li key={calc.id} className="truncate">
										{calc.title}
									</li>
								))}
							</ul>
						</div>
					)}
					<AlertDialogFooter>
						<AlertDialogCancel size="default" variant="outline">
							Vazgeç
						</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={async () => {
								const ok = await deleteDocument(doc.id);
								if (!ok) {
									toast.error('Belge silinemedi', {
										description: 'Lütfen tekrar deneyin.',
									});
									return;
								}
								setRemoveOpen(false);
								onDeleted(doc.id);
								toast.success('Belge silindi');
							}}
						>
							Evet, sil
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

function FilterMenu({
	value,
	onChange,
}: {
	value: TypeFilter;
	onChange: (value: TypeFilter) => void;
}) {
	const active = TYPE_FILTERS.find((item) => item.value === value);
	return (
		<Menu>
			<MenuTrigger
				render={
					<Button variant="outline" size="sm" className="gap-1.5 h-8">
						<FunnelSimpleIcon />
						<span className="truncate">{active?.label}</span>
					</Button>
				}
			/>
			<MenuContent className="min-w-48">
				{TYPE_FILTERS.map((item) => (
					<MenuItem
						key={item.value}
						onClick={() => onChange(item.value)}
					>
						<CheckIcon
							className={cn(
								'size-4',
								item.value === value
									? 'opacity-100'
									: 'opacity-0',
							)}
						/>
						{item.label}
					</MenuItem>
				))}
			</MenuContent>
		</Menu>
	);
}

function SortMenu({
	sortKey,
	sortDir,
	onChangeKey,
	onToggleDir,
}: {
	sortKey: SortKey;
	sortDir: SortDir;
	onChangeKey: (value: SortKey) => void;
	onToggleDir: () => void;
}) {
	const active = SORT_OPTIONS.find((item) => item.value === sortKey);
	return (
		<div className="flex items-center gap-1">
			<Menu>
				<MenuTrigger
					render={
						<Button
							variant="outline"
							size="sm"
							className="gap-1.5 h-8"
						>
							<ArrowsDownUpIcon />
							<span className="truncate">{active?.label}</span>
						</Button>
					}
				/>
				<MenuContent className="min-w-44">
					{SORT_OPTIONS.map((item) => (
						<MenuItem
							key={item.value}
							onClick={() => onChangeKey(item.value)}
						>
							<CheckIcon
								className={cn(
									'size-4',
									item.value === sortKey
										? 'opacity-100'
										: 'opacity-0',
								)}
							/>
							{item.label}
						</MenuItem>
					))}
				</MenuContent>
			</Menu>
			<Button
				variant="outline"
				size="sm"
				onClick={onToggleDir}
				className="h-8"
				aria-label={
					sortDir === 'asc' ? 'Artan sıralama' : 'Azalan sıralama'
				}
			>
				{sortDir === 'asc' ? 'A→Z' : 'Z→A'}
			</Button>
		</div>
	);
}

function DocumentsContent() {
	const { session } = useAppSession();
	const isSignedIn = !!session;
	const [loginPromptOpen, setLoginPromptOpen] = useState(false);
	const [documents, setDocuments] = useState<LibraryDocument[] | null>(null);
	const [search, setSearch] = useState('');
	const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
	const [sortKey, setSortKey] = useState<SortKey>('date');
	const [sortDir, setSortDir] = useState<SortDir>('desc');

	const [preview, setPreview] = useState<LibraryDocument | null>(null);
	const [pending, setPending] = useState<PendingUpload[]>([]);
	const fileInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!isSignedIn) {
			setDocuments([]);
			setLoginPromptOpen(true);
			return;
		}
		let active = true;
		void fetchDocuments().then((docs) => {
			if (active) setDocuments(docs);
		});
		return () => {
			active = false;
		};
	}, [isSignedIn]);

	const startDocUpload = (file: File) => {
		if (!isSignedIn) {
			setLoginPromptOpen(true);
			return;
		}
		const localId = crypto.randomUUID();
		setPending((prev) => [
			{ localId, file, progress: 0, status: 'uploading' },
			...prev,
		]);

		uploadDocument(
			file,
			(progress) =>
				setPending((prev) =>
					prev.map((item) =>
						item.localId === localId ? { ...item, progress } : item,
					),
				),
			() => {},
		)
			.then(() => {
				setPending((prev) =>
					prev.filter((item) => item.localId !== localId),
				);
				void fetchDocuments().then(setDocuments);
			})
			.catch((error: unknown) => {
				setPending((prev) =>
					prev.map((item) =>
						item.localId === localId
							? {
									...item,
									status: 'error',
									error:
										error instanceof Error
											? error.message
											: 'Dosya yüklenemedi.',
								}
							: item,
					),
				);
			});
	};

	const handleDropFiles = (files: File[]) => {
		if (!isSignedIn) {
			setLoginPromptOpen(true);
			return;
		}
		const existingCount = (documents?.length ?? 0) + pending.length;
		const { accepted, errors } = validateDroppedFiles(files, existingCount);
		if (errors.length > 0) {
			toast.error('Bazı dosyalar yüklenemedi', {
				description: errors[0],
			});
		}
		accepted.forEach(startDocUpload);
	};

	const retryUpload = (item: PendingUpload) => {
		setPending((prev) => prev.filter((p) => p.localId !== item.localId));
		startDocUpload(item.file);
	};

	const dismissUpload = (localId: string) =>
		setPending((prev) => prev.filter((p) => p.localId !== localId));

	const dragActive = useWindowFileDrop(handleDropFiles);

	const renameLocal = (id: string, name: string) =>
		setDocuments((prev) =>
			prev
				? prev.map((doc) => (doc.id === id ? { ...doc, name } : doc))
				: prev,
		);

	const removeLocal = (id: string) =>
		setDocuments((prev) =>
			prev ? prev.filter((doc) => doc.id !== id) : prev,
		);

	const filteredByType = useMemo(() => {
		if (!documents) return [];
		return documents.filter((doc) => {
			if (typeFilter === 'pdf' && !isPdf(doc)) return false;
			if (typeFilter === 'image' && !doc.type.startsWith('image/'))
				return false;
			return true;
		});
	}, [documents, typeFilter]);
	const documentFuse = useMemo(
		() => new Fuse(filteredByType, { keys: ['name'], threshold: 0.4 }),
		[filteredByType],
	);

	const visible = useMemo(() => {
		const query = search.trim();
		const filtered = query
			? documentFuse.search(query).map(({ item }) => item)
			: filteredByType;

		const direction = sortDir === 'asc' ? 1 : -1;
		return [...filtered].sort((a, b) => {
			if (sortKey === 'name') {
				return a.name.localeCompare(b.name, 'tr') * direction;
			}
			if (sortKey === 'size') {
				return (a.size - b.size) * direction;
			}
			return (
				(new Date(a.createdAt).getTime() -
					new Date(b.createdAt).getTime()) *
				direction
			);
		});
	}, [documentFuse, filteredByType, search, sortKey, sortDir]);

	const total = documents?.length ?? 0;

	// Live analysis statuses, so a freshly uploaded document flips to "failed"
	// (or away from it after a retry) without needing a manual refresh.
	const documentIds = useMemo(
		() => documents?.map((doc) => doc.id) ?? [],
		[documents],
	);
	const { statuses: liveStatuses, refresh: refreshStatuses } =
		useDocumentAnalysisStatuses(documentIds);

	let body: ReactNode;
	if (documents === null) {
		body = (
			<div className="grid h-60 place-items-center">
				<span
					aria-label="Belgeler yükleniyor"
					className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
				/>
			</div>
		);
	} else if (total === 0) {
		body =
			pending.length > 0 ? null : (
				<>
					<div className="rounded-xl border border-dashed bg-card p-10 text-center">
						<p className="text-sm font-medium">
							Henüz belge yüklemediniz.
						</p>
						<p className="mt-1 text-sm text-muted-foreground">
							Belgelerinizi buraya sürükleyip bırakın ya da “Belge
							yükle” ile seçin.
						</p>
					</div>
					<Button
						type="button"
						className="shrink-0 self-start w-full"
						onClick={() => {
							if (!isSignedIn) {
								setLoginPromptOpen(true);
								return;
							}
							fileInputRef.current?.click();
						}}
					>
						<UploadSimpleIcon /> Belge yükle
					</Button>
				</>
			);
	} else if (visible.length === 0) {
		body = (
			<p className="rounded-xl border border-dashed bg-card p-10 text-center text-sm text-muted-foreground">
				Filtrelerinizle eşleşen belge yok.
			</p>
		);
	} else {
		body = (
			<div className="grid gap-3 md:grid-cols-2">
				{visible.map((doc) => (
					<DocumentCard
						key={doc.id}
						doc={doc}
						analysisStatus={liveStatuses[doc.id] ?? doc.analysisStatus}
						onRenamed={renameLocal}
						onDeleted={removeLocal}
						onPreview={setPreview}
					/>
				))}
			</div>
		);
	}

	return (
		<div className="mx-auto flex min-h-dvh flex-col">
			<div className="fixed top-0 right-0 left-0 z-40 border-b bg-background px-8 py-4 md:left-64 lg:left-84">
				<span className="ml-6 md:ml-0 text-sm font-medium">
					Yüklenen belgeler
				</span>
			</div>

			<main className="flex flex-1 flex-col px-4 py-8 sm:px-8 mt-16">
				<div className="mx-auto w-full space-y-6">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div className="space-y-2">
							<h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
								Belgeleriniz
							</h1>
							<p className="text-muted-foreground">
								Yüklediğiniz CAF belgelerini görüntüleyin,
								yeniden adlandırın, önizleyin veya silin.
								Dosyaları sayfanın herhangi bir yerine
								sürükleyerek de yükleyebilirsiniz.
							</p>
						</div>
						<input
							ref={fileInputRef}
							type="file"
							multiple
							accept={DOCUMENT_ACCEPT}
							className="sr-only"
							aria-label="Belge yükle"
							onChange={(event) => {
								if (!isSignedIn) {
									event.currentTarget.value = '';
									setLoginPromptOpen(true);
									return;
								}
								const list = event.currentTarget.files;
								if (list && list.length > 0) {
									handleDropFiles(Array.from(list));
								}
								event.currentTarget.value = '';
							}}
						/>
					</div>

					{total > 0 && (
						<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div className="relative flex-1">
								<MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
								<Input
									value={search}
									onChange={(event) =>
										setSearch(event.currentTarget.value)
									}
									placeholder="Belge ara"
									className="pl-8"
								/>
							</div>
							<div className="flex items-center gap-2">
								<FilterMenu
									value={typeFilter}
									onChange={setTypeFilter}
								/>
								<SortMenu
									sortKey={sortKey}
									sortDir={sortDir}
									onChangeKey={setSortKey}
									onToggleDir={() =>
										setSortDir((dir) =>
											dir === 'asc' ? 'desc' : 'asc',
										)
									}
								/>
							</div>
						</div>
					)}

					{pending.length > 0 && (
						<div className="grid gap-3 md:grid-cols-2">
							{pending.map((item) => (
								<PendingCard
									key={item.localId}
									pending={item}
									onRetry={retryUpload}
									onDismiss={dismissUpload}
								/>
							))}
						</div>
					)}

					{body}
				</div>
			</main>

			<DocumentPreviewDialog
				document={preview}
				onOpenChange={(open) => {
					if (!open) setPreview(null);
				}}
				onReanalyzed={refreshStatuses}
				onRename={async (id, newName) => {
					const previous = preview?.name ?? '';
					renameLocal(id, newName); // optimistic
					setPreview((p) => (p ? { ...p, name: newName } : p));
					const ok = await renameDocument(id, newName);
					if (!ok) {
						renameLocal(id, previous); // revert
						setPreview((p) =>
							p ? { ...p, name: previous } : p,
						);
						toast.error('Ad değiştirilemedi', {
							description: 'Lütfen tekrar deneyin.',
						});
					}
					return ok;
				}}
			/>

			<PageUploadOverlay active={dragActive} />

			<LoginPromptDialog
				open={loginPromptOpen}
				onOpenChange={setLoginPromptOpen}
				title="Belgelerinizi görmek için giriş yapın"
				description="Belge yüklemek ve hesabınıza daha önce yüklediğiniz belgeleri yönetmek için giriş yapmanız gerekir."
			/>
		</div>
	);
}

/** Documents library page, wrapped in the shared app shell (sidebar + store). */
export function DocumentsLibrary() {
	return (
		<TooltipProvider delay={200}>
			<StoreProvider>
				<div className="min-h-dvh">
					<Sidebar />
					<div className="min-w-0 md:pl-64 lg:pl-84">
						<DocumentsContent />
					</div>
				</div>
			</StoreProvider>
		</TooltipProvider>
	);
}
