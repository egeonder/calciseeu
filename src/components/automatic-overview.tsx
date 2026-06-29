'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
	BrainIcon,
	CaretDownIcon,
	CaretRightIcon,
	ChecksIcon,
	EyeIcon,
	FileImageIcon,
	FilePdfIcon,
	FilesIcon,
	MagnifyingGlassIcon,
	PencilSimpleIcon,
	TrashIcon,
	WarningCircleIcon,
} from '@phosphor-icons/react';
import { DragDropProvider } from '@dnd-kit/react';
import { isSortable, useSortable } from '@dnd-kit/react/sortable';
import Fuse from 'fuse.js';
import { motion } from 'motion/react';
import { toast } from 'sonner';

import { formatBytes } from '@/src/hooks/use-file-upload';
import { useDocumentAnalysisStatuses } from '@/src/hooks/use-document-analysis-statuses';
import { renameDocument } from '@/src/lib/document-library';
import type { DocumentAnalysisStatus } from '@/src/db/schema';
import type { AutomaticDocumentRef } from '@/src/lib/automatic';
import { Button } from './ui/button';
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from './ui/context-menu';
import { DocumentPreviewDialog } from './document-preview-dialog';
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from './ui/collapsible';
import {
	hasAutomaticOverviewContent,
	type AutomaticOverviewRow,
	type AutomaticOverviewSection,
	type OverviewIcon,
} from './automatic-overview-types';
import { cn } from '@/lib/utils';

type RenameDocument = (id: string, name: string) => void;
type RemoveDocument = (id: string) => void;
type ReorderDocuments = (documents: AutomaticDocumentRef[]) => void;

const MAX_VISIBLE_DOCUMENTS = 5;

const icons: Record<OverviewIcon, ReactNode> = {
	documents: <FilesIcon className="size-4" />,
	insights: <BrainIcon className="size-4" />,
	warnings: <WarningCircleIcon className="size-4" />,
	result: <ChecksIcon className="size-4" />,
};

function OverviewRow({ label, value }: AutomaticOverviewRow) {
	return (
		<div className="flex items-start justify-between gap-3 py-1.5 text-sm">
			<span className="min-w-0 text-muted-foreground">{label}</span>
			<span className="max-w-[58%] text-right font-medium text-foreground">
				{value}
			</span>
		</div>
	);
}

function DocumentThumb({
	doc,
	className,
}: {
	doc: AutomaticDocumentRef;
	className?: string;
}) {
	const isPdf = doc.type === 'application/pdf';
	if (!isPdf && doc.url) {
		return <img src={doc.url} alt="" className={className} />;
	}
	return isPdf ? (
		<FilePdfIcon weight="duotone" className="size-4.5" />
	) : (
		<FileImageIcon weight="duotone" className="size-4.5" />
	);
}

function DocumentRow({
	doc,
	analysisStatus,
	onRename,
	onRemove,
	onPreview,
	sortRef,
	dragHandleRef,
	isDragging = false,
}: {
	doc: AutomaticDocumentRef;
	analysisStatus?: DocumentAnalysisStatus;
	onRename?: RenameDocument;
	onRemove?: RemoveDocument;
	onPreview: (doc: AutomaticDocumentRef) => void;
	sortRef?: (element: Element | null) => void;
	dragHandleRef?: (element: Element | null) => void;
	isDragging?: boolean;
}) {
	const [editing, setEditing] = useState(false);

	const commitRename = async (value: string) => {
		setEditing(false);
		const next = value.trim();
		if (!next || next === doc.name || !onRename) return;

		const previous = doc.name;
		onRename(doc.id, next); // optimistic
		const ok = await renameDocument(doc.id, next);
		if (!ok) {
			onRename(doc.id, previous); // revert
			toast.error('Ad değiştirilemedi', {
				description: 'Lütfen tekrar deneyin.',
			});
		}
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger
				render={
					<li
						ref={sortRef}
						className={cn(
							'group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60',
							isDragging && 'z-10 opacity-50',
						)}
					/>
				}
			>
				<div className="flex min-w-0 flex-1 items-center gap-2.5">
					<button
						type="button"
						onClick={() => onPreview(doc)}
						aria-label={`${doc.name} önizle`}
						className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md border bg-background text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
					>
						<DocumentThumb
							doc={doc}
							className="size-full object-cover"
						/>
					</button>

					<div
						className={cn(
							'min-w-0 flex-1',
							dragHandleRef &&
								'cursor-grab active:cursor-grabbing',
						)}
						ref={dragHandleRef}
					>
						{editing ? (
							<input
								autoFocus
								defaultValue={doc.name}
								onFocus={(event) =>
									event.currentTarget.select()
								}
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
								className="w-full rounded-md bg-background px-1.5 py-0.5 text-sm text-foreground outline-none ring-2 ring-ring/50"
							/>
						) : (
							<span
								onDoubleClick={() =>
									onRename && setEditing(true)
								}
								className="block truncate text-sm font-medium select-none"
								title={doc.name}
							>
								{doc.name}
							</span>
						)}
						{analysisStatus === 'failed' ? (
							<span
								className="flex items-center gap-1 text-xs text-destructive"
								title="Belge analiz edilemedi. Önizleyip yeniden analiz edebilirsiniz."
							>
								<WarningCircleIcon
									weight="fill"
									className="size-3.5 shrink-0"
								/>
								Analiz edilemedi
							</span>
						) : (
							<span className="block text-xs text-muted-foreground">
								{formatBytes(doc.size)}
							</span>
						)}
					</div>
				</div>

				{!editing && (
					<div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label={`${doc.name} önizle`}
							onClick={() => onPreview(doc)}
						>
							<EyeIcon />
						</Button>
						{onRename && (
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label={`${doc.name} yeniden adlandır`}
								onClick={() => setEditing(true)}
							>
								<PencilSimpleIcon />
							</Button>
						)}
						{onRemove && (
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label={`${doc.name} kaldır`}
								onClick={() => onRemove(doc.id)}
							>
								<TrashIcon className="text-destructive" />
							</Button>
						)}
					</div>
				)}
			</ContextMenuTrigger>
			<ContextMenuContent className="min-w-44">
				<ContextMenuItem onClick={() => onPreview(doc)}>
					<EyeIcon />
					Önizle
				</ContextMenuItem>
				{onRename && (
					<ContextMenuItem onClick={() => setEditing(true)}>
						<PencilSimpleIcon />
						Yeniden adlandır
					</ContextMenuItem>
				)}
				{onRemove && (
					<>
						<ContextMenuSeparator />
						<ContextMenuItem
							variant="destructive"
							onClick={() => onRemove(doc.id)}
						>
							<TrashIcon />
							Kaldır
						</ContextMenuItem>
					</>
				)}
			</ContextMenuContent>
		</ContextMenu>
	);
}

function SortableDocumentRow({
	doc,
	index,
	analysisStatus,
	onRename,
	onRemove,
	onPreview,
}: {
	doc: AutomaticDocumentRef;
	index: number;
	analysisStatus?: DocumentAnalysisStatus;
	onRename?: RenameDocument;
	onRemove?: RemoveDocument;
	onPreview: (doc: AutomaticDocumentRef) => void;
}) {
	const { handleRef, isDragging, ref } = useSortable({
		id: doc.id,
		index,
	});

	return (
		<DocumentRow
			doc={doc}
			analysisStatus={analysisStatus}
			dragHandleRef={handleRef}
			isDragging={isDragging}
			onPreview={onPreview}
			onRemove={onRemove}
			onRename={onRename}
			sortRef={ref}
		/>
	);
}

function DocumentsList({
	documents,
	onRename,
	onRemove,
	onReorder,
}: {
	documents: AutomaticDocumentRef[];
	onRename?: RenameDocument;
	onRemove?: RemoveDocument;
	onReorder?: ReorderDocuments;
}) {
	const [expanded, setExpanded] = useState(false);
	const [search, setSearch] = useState('');
	const [preview, setPreview] = useState<AutomaticDocumentRef | null>(null);

	// Poll analysis status so attached documents that failed to analyze — and
	// thus can't feed the calculation — are flagged before the user opens them.
	const documentIds = useMemo(
		() => documents.map((document) => document.id),
		[documents],
	);
	const { statuses: analysisStatuses, refresh: refreshAnalysisStatuses } =
		useDocumentAnalysisStatuses(documentIds);

	const documentFuse = useMemo(
		() => new Fuse(documents, { keys: ['name'], threshold: 0.4 }),
		[documents],
	);
	const matchingDocuments = useMemo(() => {
		const query = search.trim();
		return query
			? documentFuse.search(query).map(({ item }) => item)
			: documents;
	}, [documentFuse, documents, search]);
	const hidden = Math.max(
		0,
		matchingDocuments.length - MAX_VISIBLE_DOCUMENTS,
	);
	const visible =
		expanded || search
			? matchingDocuments
			: matchingDocuments.slice(0, MAX_VISIBLE_DOCUMENTS);

	const handleDialogRename = onRename
		? async (id: string, newName: string): Promise<boolean> => {
				const previous =
					documents.find((document) => document.id === id)?.name ??
					'';
				onRename(id, newName); // optimistic list update
				setPreview((current) =>
					current && current.id === id
						? { ...current, name: newName }
						: current,
				);
				const ok = await renameDocument(id, newName);
				if (!ok) {
					onRename(id, previous); // revert
					setPreview((current) =>
						current && current.id === id
							? { ...current, name: previous }
							: current,
					);
					toast.error('Ad değiştirilemedi', {
						description: 'Lütfen tekrar deneyin.',
					});
				}
				return ok;
			}
		: undefined;

	return (
		<>
			<div className="relative mb-2">
				<MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
				<input
					className="h-8 w-full rounded-md border bg-background py-1 pr-2 pl-8 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
					onChange={(event) => setSearch(event.currentTarget.value)}
					placeholder="Belgelerde ara"
					value={search}
				/>
			</div>
			{visible.length > 0 ? (
				<DragDropProvider
					onDragEnd={({ canceled, operation }) => {
						if (
							canceled ||
							!onReorder ||
							!isSortable(operation.source)
						) {
							return;
						}

						const from = operation.source.initialIndex;
						const to = operation.source.index;
						if (from === to || from < 0 || to < 0) return;

						const reorderedMatches = [...visible];
						const [moved] = reorderedMatches.splice(from, 1);
						if (!moved) return;
						reorderedMatches.splice(to, 0, moved);

						const visibleIds = new Set(
							visible.map((document) => document.id),
						);
						let index = 0;
						onReorder(
							documents.map((document) =>
								visibleIds.has(document.id)
									? reorderedMatches[index++]!
									: document,
							),
						);
					}}
				>
					<ul className="-mx-2">
						{visible.map((doc, index) => (
							<SortableDocumentRow
								key={doc.id}
								doc={doc}
								index={index}
								analysisStatus={analysisStatuses[doc.id]}
								onRename={onRename}
								onRemove={onRemove}
								onPreview={setPreview}
							/>
						))}
					</ul>
				</DragDropProvider>
			) : (
				<p className="px-2 py-5 text-center text-sm text-muted-foreground">
					Aramanızla eşleşen belge yok.
				</p>
			)}
			{hidden > 0 && (
				<button
					type="button"
					onClick={() => setExpanded((value) => !value)}
					aria-expanded={expanded}
					className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
				>
					{expanded
						? 'Daha az göster'
						: `${hidden} belge daha göster`}
					<motion.span
						aria-hidden
						initial={false}
						animate={{ rotate: expanded ? 180 : 0 }}
						transition={{
							duration: 0.16,
							ease: [0.23, 1, 0.32, 1],
						}}
					>
						<CaretDownIcon className="size-3.5" />
					</motion.span>
				</button>
			)}

			<DocumentPreviewDialog
				document={preview}
				onOpenChange={(open) => {
					if (!open) setPreview(null);
				}}
				onReanalyzed={refreshAnalysisStatuses}
				onRename={handleDialogRename}
			/>
		</>
	);
}

function OverviewSection({
	section,
	onRenameDocument,
	onRemoveDocument,
	onReorderDocuments,
}: {
	section: AutomaticOverviewSection;
	onRenameDocument?: RenameDocument;
	onRemoveDocument?: RemoveDocument;
	onReorderDocuments?: ReorderDocuments;
}) {
	const [open, setOpen] = useState(section.defaultOpen ?? true);
	const documentCount = section.documents?.length ?? 0;

	if (!section.description && !section.rows?.length && documentCount === 0)
		return null;

	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<section>
				<CollapsibleTrigger className="mb-2.5 flex w-full items-center gap-2 text-left text-sm font-semibold outline-none transition-transform duration-150 ease-out active:scale-[0.99]">
					{icons[section.icon]}
					<span>{section.title}</span>
					{documentCount > 0 && (
						<span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
							{documentCount}
						</span>
					)}
					<motion.span
						aria-hidden
						className="ml-auto text-muted-foreground"
						initial={false}
						animate={{ rotate: open ? 90 : 0 }}
						transition={{
							duration: 0.16,
							ease: [0.23, 1, 0.32, 1],
						}}
					>
						<CaretRightIcon className="size-3.5" />
					</motion.span>
				</CollapsibleTrigger>
				<CollapsibleContent
					keepMounted
					render={
						<motion.div
							className="overflow-hidden"
							initial={false}
							animate={{
								height: open ? 'auto' : 0,
								opacity: open ? 1 : 0,
							}}
							transition={{
								height: {
									duration: 0.2,
									ease: [0.23, 1, 0.32, 1],
								},
								opacity: {
									duration: open ? 0.16 : 0.12,
									ease: 'easeOut',
								},
							}}
						/>
					}
				>
					{documentCount > 0 ? (
						<DocumentsList
							documents={section.documents ?? []}
							onRename={onRenameDocument}
							onRemove={onRemoveDocument}
							onReorder={onReorderDocuments}
						/>
					) : (
						<>
							{section.description && (
								<p className="text-sm leading-relaxed text-muted-foreground">
									{section.description}
								</p>
							)}
							{section.rows?.map((row) => (
								<OverviewRow key={row.label} {...row} />
							))}
						</>
					)}
				</CollapsibleContent>
			</section>
		</Collapsible>
	);
}

export function AutomaticOverview({
	className = '',
	sections,
	onRenameDocument,
	onRemoveDocument,
	onReorderDocuments,
}: {
	className?: string;
	sections: AutomaticOverviewSection[];
	onRenameDocument?: RenameDocument;
	onRemoveDocument?: RemoveDocument;
	onReorderDocuments?: ReorderDocuments;
}) {
	if (!hasAutomaticOverviewContent(sections)) return null;

	return (
		<motion.aside
			className={`overflow-hidden overscroll-contain rounded-2xl border border-border bg-card text-card-foreground ${className}`}
			aria-label="Otomatik hesaplama genel bakış"
			initial={{ opacity: 0, x: 32 }}
			animate={{ opacity: 1, x: 0 }}
			exit={{ opacity: 0, x: 32 }}
			transition={{
				duration: 0.28,
				ease: [0.16, 1, 0.3, 1],
			}}
		>
			<div className="border-b border-border p-4">
				<p className="text-xs font-medium text-muted-foreground">
					Otomatik hesaplama genel bakış
				</p>
			</div>
			<div className="space-y-4 p-4">
				{sections.map((section) => (
					<OverviewSection
						key={section.id}
						section={section}
						onRenameDocument={onRenameDocument}
						onRemoveDocument={onRemoveDocument}
						onReorderDocuments={onReorderDocuments}
					/>
				))}
			</div>
		</motion.aside>
	);
}
