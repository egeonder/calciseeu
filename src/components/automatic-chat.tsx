'use client';

import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ChangeEvent,
} from 'react';
import { nanoid } from 'nanoid';
import type { ChatStatus } from 'ai';
import Fuse from 'fuse.js';
import {
	CheckIcon,
	FilePdfIcon,
	FolderOpenIcon,
	MagnifyingGlassIcon,
	UploadSimpleIcon,
	WarningIcon,
} from '@phosphor-icons/react';
import { PaperclipIcon } from 'lucide-react';
import { toast } from 'sonner';

import { MessageResponse } from './ai-elements/message';
import { Marker, MarkerContent } from './ui/marker';
import { Message, MessageContent } from './ui/message';
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from './ui/message-scroller';
import {
	PromptInput,
	PromptInputBody,
	PromptInputButton,
	PromptInputFooter,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
	type PromptInputMessage,
} from './ai-elements/prompt-input';
import { Shimmer } from './ai-elements/shimmer';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { cn } from '@/lib/utils';
import {
	AutomaticQuestions,
	type ClarifyingAnswer,
} from './automatic-questions';
import type {
	AutomaticCalculationData,
	AutomaticChatMessage,
	AutomaticDocumentRef,
	AutomaticPendingQuestions,
} from '@/src/lib/automatic';
import {
	fetchDocuments,
	type LibraryDocument,
} from '@/src/lib/document-library';
import { uploadDocument } from '@/src/lib/document-upload';
import {
	DOCUMENT_ACCEPT,
	MAX_DOCUMENT_COUNT,
	validateDroppedFiles,
} from '@/src/lib/documents';
import { formatBytes } from '@/src/hooks/use-file-upload';
import { LoginPromptDialog } from '@/src/components/login-prompt-dialog';
import { useAppSession } from '@/src/lib/session';

type AutomaticAgentEvent = 'documents_changed';

const AUTOMATIC_START_MESSAGE =
	'ISEEU hesaplaması için belgelerimi yükledim. Belgelerimi inceleyip otomatik hesaplamayı başlatabilirsin.';

export function AutomaticChat({
	calculationId,
	documents,
	initialMessages,
	initialPendingQuestions,
	onDocumentsUploaded,
	onCalculationUpdated,
	className,
}: {
	calculationId: string | null;
	documents: AutomaticDocumentRef[];
	initialMessages: AutomaticChatMessage[];
	initialPendingQuestions?: AutomaticPendingQuestions | null;
	onDocumentsUploaded: (
		documents: AutomaticDocumentRef[],
	) => Promise<boolean>;
	onCalculationUpdated?: () => Promise<AutomaticCalculationData | null> | void;
	className?: string;
}) {
	const { session } = useAppSession();
	const isSignedIn = !!session;
	const [loginPromptOpen, setLoginPromptOpen] = useState(false);
	const [messages, setMessages] =
		useState<AutomaticChatMessage[]>(initialMessages);
	const [pendingQuestions, setPendingQuestions] =
		useState<AutomaticPendingQuestions | null>(
			initialPendingQuestions ?? null,
		);
	const [input, setInput] = useState('');
	const [status, setStatus] = useState<ChatStatus>('ready');
	const [uploadingDocuments, setUploadingDocuments] = useState(false);
	const [pickerOpen, setPickerOpen] = useState(false);
	const [library, setLibrary] = useState<LibraryDocument[] | null>(null);
	const [librarySearch, setLibrarySearch] = useState('');
	const [picked, setPicked] = useState<Set<string>>(new Set());
	// Documents added to the chat after the latest agent turn started. They are
	// not part of the current calculation until a recalculation that began after
	// they were added completes.
	const [pendingDocuments, setPendingDocuments] = useState<
		AutomaticDocumentRef[]
	>([]);
	const [recalculatingPending, setRecalculatingPending] = useState(false);
	const documentInputRef = useRef<HTMLInputElement>(null);
	const initialRequestStarted = useRef(false);
	const abortController = useRef<AbortController | null>(null);
	const statusRef = useRef<ChatStatus>('ready');
	const pendingDocumentsRef = useRef<AutomaticDocumentRef[]>([]);

	useEffect(() => {
		pendingDocumentsRef.current = pendingDocuments;
	}, [pendingDocuments]);
	const selectedDocumentIds = useMemo(
		() => new Set(documents.map((document) => document.id)),
		[documents],
	);
	const availableLibrary = useMemo(
		() =>
			library?.filter(
				(document) => !selectedDocumentIds.has(document.id),
			) ?? [],
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

	useEffect(
		() => () => {
			abortController.current?.abort();
		},
		[],
	);

	// Pull the latest saved calculation and surface any clarifying questions the
	// agent persisted during the turn.
	const syncCalculation = useCallback(
		async (): Promise<AutomaticCalculationData | null> => {
			const automatic = await onCalculationUpdated?.();
			if (!automatic) return null;
			setPendingQuestions(automatic.pendingQuestions ?? null);
			return automatic;
		},
		[onCalculationUpdated],
	);

	const streamAssistant = useCallback(
		async (
			userMessage?: AutomaticChatMessage,
			event?: AutomaticAgentEvent,
		) => {
			if (!isSignedIn) {
				setLoginPromptOpen(true);
				return;
			}
			if (!calculationId) {
				toast.error('Sohbet başlatılamadı', {
					description: 'Otomatik hesaplama önce kaydedilmelidir.',
				});
				return;
			}

			statusRef.current = 'submitted';
			setStatus('submitted');
			const controller = new AbortController();
			abortController.current = controller;
			const assistantId = nanoid();
			let assistantText = '';
			let assistantAdded = false;
			// Any turn re-examines the full attached document set, so a turn that
			// starts while documents are pending incorporates them on completion.
			const clearsPendingDocuments = pendingDocumentsRef.current.length > 0;

			try {
				const response = await fetch('/api/automatic/chat', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						calculationId,
						event: event ?? null,
						message: userMessage
							? { id: userMessage.id, text: userMessage.text }
							: null,
					}),
					signal: controller.signal,
				});
				if (response.status === 401) {
					setLoginPromptOpen(true);
					return;
				}
				if (!response.ok || !response.body) {
					const payload = (await response.json().catch(() => null)) as {
						error?: string;
					} | null;
					throw new Error(payload?.error ?? 'Yanıt alınamadı.');
				}

				statusRef.current = 'streaming';
				setStatus('streaming');
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					assistantText += decoder.decode(value, { stream: true });
					if (!assistantAdded) {
						assistantAdded = true;
						setMessages((previous) => [
							...previous,
							{
								id: assistantId,
								role: 'assistant',
								text: assistantText,
								createdAt: new Date().toISOString(),
							},
						]);
					} else {
						setMessages((previous) =>
							previous.map((message) =>
								message.id === assistantId
									? { ...message, text: assistantText }
									: message,
							),
						);
					}
				}
				assistantText += decoder.decode();
				const automatic = await syncCalculation();
				const hasPendingQuestions =
					(automatic?.pendingQuestions?.questions.length ?? 0) > 0;
				if (!assistantText.trim() && !hasPendingQuestions) {
					throw new Error('Boş yanıt alındı.');
				}
				if (clearsPendingDocuments) setPendingDocuments([]);
			} catch (error) {
				if (controller.signal.aborted) return;
				toast.error('ISEEU asistanı yanıt veremedi', {
					description:
						error instanceof Error
							? error.message
							: 'Lütfen tekrar deneyin.',
				});
			} finally {
				if (abortController.current === controller) {
					abortController.current = null;
				}
				statusRef.current = 'ready';
				setStatus('ready');
			}
		},
		[calculationId, isSignedIn, syncCalculation],
	);

	useEffect(() => {
		if (initialRequestStarted.current || !calculationId) return;

		const startMessageId = `automatic-start-${calculationId}`;
		const existingStartMessage = initialMessages.find(
			(message) => message.id === startMessageId && message.role === 'user',
		);
		if (
			initialMessages.length > 0 &&
			(!existingStartMessage ||
				initialMessages.some((message) => message.role === 'assistant'))
		) {
			return;
		}

		// In development, Strict Mode immediately cleans up and re-runs effects.
		// Deferring the bootstrap lets that first cleanup cancel the scheduled
		// work instead of aborting a request and leaving only its optimistic UI.
		const timeout = window.setTimeout(() => {
			if (initialRequestStarted.current) return;
			initialRequestStarted.current = true;
			const userMessage: AutomaticChatMessage =
				existingStartMessage ?? {
					id: startMessageId,
					role: 'user',
					text: AUTOMATIC_START_MESSAGE,
					createdAt: new Date().toISOString(),
				};
			if (!existingStartMessage) {
				setMessages((previous) =>
					previous.some((message) => message.id === startMessageId)
						? previous
						: [...previous, userMessage],
				);
			}
			void streamAssistant(userMessage);
		}, 0);

		return () => window.clearTimeout(timeout);
	}, [calculationId, initialMessages, streamAssistant]);

	// Flag newly added documents as not yet part of the calculation instead of
	// recalculating automatically; the user triggers the recalculation from the
	// warning banner when the agent is idle.
	const markDocumentsPending = useCallback(
		(added: AutomaticDocumentRef[]) => {
			if (added.length === 0) return;
			setPendingDocuments((previous) => {
				const seen = new Set(previous.map((document) => document.id));
				return [
					...previous,
					...added.filter((document) => !seen.has(document.id)),
				];
			});
		},
		[],
	);

	const recalculateWithPendingDocuments = useCallback(async () => {
		if (statusRef.current !== 'ready') return;
		setRecalculatingPending(true);
		await streamAssistant(undefined, 'documents_changed');
		setRecalculatingPending(false);
	}, [streamAssistant]);

	// Parameter tools persist while the model is still working. Poll the saved
	// calculation during a turn so newly confirmed rows appear in the overview
	// without waiting for the final assistant text.
	useEffect(() => {
		if (status === 'ready' || !onCalculationUpdated) return;
		const interval = setInterval(() => {
			void syncCalculation();
		}, 1500);
		return () => clearInterval(interval);
	}, [onCalculationUpdated, syncCalculation, status]);

	const submitUserMessage = useCallback(
		(rawText: string) => {
			const text = rawText.trim();
			if (!text || statusRef.current !== 'ready' || !calculationId) return;
			if (!isSignedIn) {
				setLoginPromptOpen(true);
				return;
			}

			const userMessage: AutomaticChatMessage = {
				id: nanoid(),
				role: 'user',
				text,
				createdAt: new Date().toISOString(),
			};
			setMessages((prev) => [...prev, userMessage]);
			setInput('');
			void streamAssistant(userMessage);
		},
		[calculationId, isSignedIn, streamAssistant],
	);

	const handleSubmit = useCallback(
		(message: PromptInputMessage) => {
			if (status !== 'ready') return;
			submitUserMessage(message.text ?? '');
		},
		[status, submitUserMessage],
	);

	// Collapse the agent's clarifying questions into one message so it can resume
	// with every answer (or an explicit skip) in context.
	const handleQuestionsComplete = useCallback(
		(answers: ClarifyingAnswer[]) => {
			setPendingQuestions(null);
			const lines = answers
				.map(
					({ question, answer }) =>
						`- ${question}: ${answer ?? '(atlandı)'}`,
				)
				.join('\n');
			submitUserMessage(`Netleştirme sorularına yanıtlarım:\n${lines}`);
		},
		[submitUserMessage],
	);

	const handleDocumentSelection = useCallback(
		async (event: ChangeEvent<HTMLInputElement>) => {
			if (!isSignedIn) {
				event.currentTarget.value = '';
				setLoginPromptOpen(true);
				return;
			}
			const selected = event.currentTarget.files
				? [...event.currentTarget.files]
				: [];
			event.currentTarget.value = '';

			const { accepted, errors } = validateDroppedFiles(
				selected,
				documents.length,
			);
			if (errors.length > 0) {
				toast.error('Bazı belgeler eklenemedi', {
					description: errors.join(' '),
				});
			}
			if (accepted.length === 0) return;

			setUploadingDocuments(true);
			const uploaded = await Promise.all(
				accepted.map(
					async (file): Promise<AutomaticDocumentRef | null> => {
						const toastId = toast.loading('Belge yükleniyor…', {
							description: file.name,
						});
						try {
							const id = await uploadDocument(
								file,
								() => {},
								() => {},
							);
							toast.success('Belge yüklendi', {
								id: toastId,
								description: file.name,
							});
							return {
								id,
								name: file.name,
								size: file.size,
								type: file.type,
							};
						} catch (error) {
							toast.error('Belge yüklenemedi', {
								id: toastId,
								description:
									error instanceof Error
										? error.message
										: 'Lütfen tekrar deneyin.',
							});
							return null;
						}
					},
				),
			);
			setUploadingDocuments(false);

			const uploadedDocuments = uploaded.filter(
				(document): document is AutomaticDocumentRef =>
					document !== null,
			);
			if (uploadedDocuments.length > 0) {
				const persisted = await onDocumentsUploaded(uploadedDocuments);
				if (persisted) markDocumentsPending(uploadedDocuments);
			}
		},
		[
			documents.length,
			onDocumentsUploaded,
			markDocumentsPending,
			isSignedIn,
		],
	);

	const openLibraryPicker = useCallback(() => {
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

	const togglePicked = useCallback(
		(id: string) => {
			setPicked((previous) => {
				const next = new Set(previous);
				if (next.has(id)) {
					next.delete(id);
					return next;
				}
				if (documents.length + next.size >= MAX_DOCUMENT_COUNT) {
					toast.error('Belge sınırına ulaşıldı', {
						description: `En fazla ${MAX_DOCUMENT_COUNT} belge ekleyebilirsiniz.`,
					});
					return next;
				}
				next.add(id);
				return next;
			});
		},
		[documents.length],
	);

	const confirmLibrarySelection = useCallback(async () => {
		if (!library) return;
		const selected = library
			.filter(
				(document) =>
					picked.has(document.id) &&
					!selectedDocumentIds.has(document.id),
			)
			.map(({ id, name, size, type, url }) => ({
				id,
				name,
				size,
				type,
				url,
			}));
		if (selected.length === 0) return;

		const persisted = await onDocumentsUploaded(selected);
		if (!persisted) return;
		setPickerOpen(false);
			toast.success('Belgeler eklendi', {
			description: `${selected.length} belge bu hesaplamaya eklendi.`,
		});
		markDocumentsPending(selected);
	}, [
		library,
		onDocumentsUploaded,
		picked,
		markDocumentsPending,
		selectedDocumentIds,
	]);

	const waiting = status === 'submitted';
	const showQuestions =
		status === 'ready' &&
		!!pendingQuestions &&
		pendingQuestions.questions.length > 0;

	return (
		<div
			className={cn(
				'flex min-h-0 flex-col overflow-hidden pb-2',
				className,
			)}
		>
			<MessageScrollerProvider autoScroll defaultScrollPosition="end">
				<MessageScroller className="min-h-0 flex-1">
					<MessageScrollerViewport>
						<MessageScrollerContent className="py-8">
							{messages.map((message) => (
								<MessageScrollerItem
									key={message.id}
									messageId={message.id}
								>
									<Message
										align={
											message.role === 'user'
												? 'end'
												: 'start'
										}
									>
										<MessageContent
											className={cn(
												message.role === 'user' &&
													'w-fit rounded-lg bg-secondary px-4 py-3 text-foreground',
											)}
										>
											<MessageResponse>
												{message.text}
											</MessageResponse>
										</MessageContent>
									</Message>
								</MessageScrollerItem>
							))}
							{waiting && (
								<MessageScrollerItem>
									<Marker>
									<MarkerContent>
										<Shimmer className="text-sm">
											{messages.length === 0
												? 'Belgeler inceleniyor…'
												: 'Yanıt hazırlanıyor…'}
										</Shimmer>
										</MarkerContent>
									</Marker>
								</MessageScrollerItem>
							)}
						</MessageScrollerContent>
					</MessageScrollerViewport>
					<MessageScrollerButton />
				</MessageScroller>
			</MessageScrollerProvider>

			<div>
				<input
					accept={DOCUMENT_ACCEPT}
					className="hidden"
					disabled={uploadingDocuments}
					multiple
					onChange={handleDocumentSelection}
					ref={documentInputRef}
					type="file"
				/>
				{pendingDocuments.length > 0 && !recalculatingPending && (
					<div className="mb-2 flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm dark:border-amber-400/30 dark:bg-amber-400/10">
						<WarningIcon
							className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
							weight="fill"
						/>
						<div className="min-w-0 flex-1">
							<p className="text-foreground">
								<span className="font-medium">
									{pendingDocuments
										.map((document) => document.name)
										.join(', ')}
								</span>{' '}
								şu anki hesaplamada henüz kullanılmıyor.
							</p>
							{status !== 'ready' && (
								<p className="mt-0.5 text-xs text-muted-foreground">
									Yeni belgeleriniz bir sonraki hesaplamada
									kullanılacak.
								</p>
							)}
						</div>
						{status === 'ready' && (
							<Button
								className="shrink-0"
								onClick={recalculateWithPendingDocuments}
								size="sm"
								type="button"
							>
								Yeniden hesapla
							</Button>
						)}
					</div>
				)}
				{showQuestions && pendingQuestions ? (
					<AutomaticQuestions
						key={pendingQuestions.id}
						questions={pendingQuestions.questions}
						onComplete={handleQuestionsComplete}
					/>
				) : (
					<PromptInput onSubmit={handleSubmit}>
						<PromptInputBody>
							<PromptInputTextarea
								value={input}
								onChange={(event) =>
									setInput(event.currentTarget.value)
								}
								placeholder="Belgeleriniz hakkında bir şey sorun ya da bilgi ekleyin…"
							/>
						</PromptInputBody>
						<PromptInputFooter>
							<PromptInputTools>
								<DropdownMenu>
									<DropdownMenuTrigger
										render={
											<PromptInputButton
												aria-label="Belge ekle"
												disabled={uploadingDocuments}
											>
												<PaperclipIcon size={16} />
											</PromptInputButton>
										}
									></DropdownMenuTrigger>
									<DropdownMenuContent
										align="start"
										className="w-56"
									>
										<DropdownMenuItem
											onClick={() => {
												if (!isSignedIn) {
													setLoginPromptOpen(true);
													return;
												}
												documentInputRef.current?.click();
											}}
										>
											<UploadSimpleIcon /> Yeni belge yükle
										</DropdownMenuItem>
										<DropdownMenuItem
											onClick={openLibraryPicker}
										>
											<FolderOpenIcon /> Belgelerimden seç
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</PromptInputTools>
							<PromptInputSubmit
								status={status}
								disabled={status !== 'ready' || !calculationId}
							/>
						</PromptInputFooter>
					</PromptInput>
				)}

				<Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
					<DialogContent className="flex max-h-[calc(100dvh-3rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
						<DialogHeader className="border-b px-4 py-3">
							<DialogTitle>Belgelerimden seç</DialogTitle>
						</DialogHeader>
						<div className="border-b p-3">
							<div className="relative">
								<MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
								<Input
									className="h-9 pl-8"
									onChange={(event) =>
										setLibrarySearch(
											event.currentTarget.value,
										)
									}
									placeholder="Belgelerde ara"
									value={librarySearch}
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
									{visibleLibrary.map((document) => {
										const isPicked = picked.has(
											document.id,
										);
										const isPdf =
											document.type === 'application/pdf';
										return (
											<li key={document.id}>
												<button
													aria-pressed={isPicked}
													className={cn(
														'flex w-full items-center gap-3 rounded-lg border p-2 text-left transition-colors',
														isPicked
															? 'border-primary bg-primary/5'
															: 'border-transparent hover:bg-muted',
													)}
													onClick={() =>
														togglePicked(
															document.id,
														)
													}
													type="button"
												>
													<span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md border bg-background text-primary">
														{!isPdf ? (
															<img
																alt=""
																className="size-full object-cover"
																src={
																	document.url
																}
															/>
														) : (
															<FilePdfIcon
																className="size-4.5"
																weight="duotone"
															/>
														)}
													</span>
													<span className="min-w-0 flex-1">
														<span className="block truncate text-sm font-medium">
															{document.name}
														</span>
														<span className="block text-xs text-muted-foreground">
															{formatBytes(
																document.size,
															)}
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
									onClick={() => setPickerOpen(false)}
									type="button"
									variant="outline"
								>
									Vazgeç
								</Button>
								<Button
									disabled={picked.size === 0}
									onClick={confirmLibrarySelection}
									type="button"
								>
									Ekle
									{picked.size > 0 ? ` (${picked.size})` : ''}
								</Button>
							</div>
						</div>
					</DialogContent>
				</Dialog>

				<LoginPromptDialog
					open={loginPromptOpen}
					onOpenChange={setLoginPromptOpen}
					title="ISEEU asistanını kullanmak için giriş yapın"
					description="Yapay zeka ile sohbet etmek ve sohbete belge eklemek için giriş yapmanız gerekir."
				/>
			</div>
		</div>
	);
}
