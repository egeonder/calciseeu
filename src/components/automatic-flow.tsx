'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRightIcon, SparkleIcon } from '@phosphor-icons/react';
import { toast } from 'sonner';

import { useStore } from '@/src/lib/store';
import { useAppSession } from '@/src/lib/session';
import {
	setActiveCalculation,
	upsertCalculationLocal,
	refreshCalculations,
} from '@/src/lib/calculations';
import type {
	AutomaticCalculationData,
	AutomaticCalculationParameter,
	AutomaticChatMessage,
	AutomaticDocumentRef,
	AutomaticIseeuResult,
	AutomaticPendingQuestions,
} from '@/src/lib/automatic';
import { formatEur } from '@/src/lib/iseeu';
import { Button } from '@/src/components/ui/button';
import { AutomaticDocumentUpload } from '@/src/components/automatic-document-upload';
import { AutomaticChat } from '@/src/components/automatic-chat';
import { AutomaticOverview } from '@/src/components/automatic-overview';
import { LoginPromptDialog } from '@/src/components/login-prompt-dialog';
import type { AutomaticOverviewSection } from '@/src/components/automatic-overview-types';

const disclaimer = (
	<p className="text-[11px] leading-relaxed text-muted-foreground text-center sm:text-left">
		Bu araç eğitim amaçlıdır ve resmî CAF hesaplamasının yerine geçmez.
		Kurallar yıl ve üniversiteye göre değişebilir; nihai sonuç onaylı CAF
		tarafından belirlenir.
	</p>
);

function LoadingState() {
	return (
		<main className="flex flex-1 items-center justify-center px-4 pt-24 pb-12 sm:px-8">
			<span
				aria-label="Hesaplama yükleniyor"
				className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
			/>
		</main>
	);
}

function formatParameterAmount(value: number, currency: 'EUR' | 'TRY') {
	return new Intl.NumberFormat('tr-TR', {
		style: 'currency',
		currency,
		maximumFractionDigits: 2,
	}).format(value);
}

function formatParameterValue(parameter: AutomaticCalculationParameter) {
	if (parameter.kind === 'reference_year') return String(parameter.value);
	if (parameter.kind === 'household_size') return `${parameter.value} kişi`;
	if (parameter.kind === 'child_count') return `${parameter.value} çocuk`;
	if (parameter.kind === 'category_confirmation') return 'Doğrulandı';
	if (parameter.kind === 'income') {
		return formatParameterAmount(
			parameter.value.annualAmount,
			parameter.value.currency,
		);
	}
	if (parameter.kind === 'movable_asset') {
		const value = parameter.value;
		if (value.kind === 'bank') {
			return `31.12.2024: ${formatParameterAmount(value.balanceDec31 ?? 0, value.currency)}`;
		}
		return formatParameterAmount(value.valueDec31 ?? 0, value.currency);
	}
	const value = parameter.value;
	const base =
		value.kind === 'building'
			? `${value.buildingSqm ?? 0} m²`
			: formatParameterAmount(value.declaredValue ?? 0, value.currency);
	const share = `%${Math.round(value.ownershipShare * 100)}`;
	return `${base} · ${share}${value.isPrimaryResidence ? ' · Ana konut' : ''}`;
}

export function AutomaticFlow() {
	const { state, config } = useStore();
	const { session } = useAppSession();
	const isSignedIn = !!session;
	const router = useRouter();
	const savedId = useSearchParams().get('id');

	const [documents, setDocuments] = useState<AutomaticDocumentRef[]>([]);
	const [initialMessages, setInitialMessages] = useState<
		AutomaticChatMessage[]
	>([]);
	const [initialPendingQuestions, setInitialPendingQuestions] =
		useState<AutomaticPendingQuestions | null>(null);
	const [automaticResult, setAutomaticResult] =
		useState<AutomaticIseeuResult>();
	const [automaticParameters, setAutomaticParameters] = useState<
		AutomaticCalculationParameter[]
	>([]);
	const [started, setStarted] = useState(false);
	const [creating, setCreating] = useState(false);
	const [loadingSaved, setLoadingSaved] = useState(!!savedId);
	const [loginPromptOpen, setLoginPromptOpen] = useState(false);

	// Id we just created locally, so the loader effect doesn't re-fetch (and
	// flash a spinner over) a calculation we already have in memory.
	const justCreated = useRef<string | null>(null);
	const documentsRef = useRef<AutomaticDocumentRef[]>([]);

	useEffect(() => {
		documentsRef.current = documents;
	}, [documents]);

	// Re-open a saved automatic calculation from `?id=`: load its documents and
	// drop straight into the chat interface.
	useEffect(() => {
		if (!savedId) {
			setLoadingSaved(false);
			return;
		}
		if (savedId === justCreated.current) {
			// Wait for the URL replacement to finish before mounting the chat. If
			// the chat mounts earlier, this navigation can unmount it and abort its
			// initial streaming request.
			setStarted(true);
			setLoadingSaved(false);
			return;
		}
		if (!isSignedIn) {
			setLoadingSaved(false);
			setLoginPromptOpen(true);
			return;
		}

		let active = true;
		setLoadingSaved(true);
		void (async () => {
			const response = await fetch(
				`/api/calculations/${encodeURIComponent(savedId)}`,
			).catch(() => null);
			if (!active) return;

			if (response?.ok) {
				const { calculation } = (await response.json()) as {
					calculation?: {
						data?: { automatic?: AutomaticCalculationData };
					};
				};
				const automatic = calculation?.data?.automatic;
				setDocuments(automatic?.documents ?? []);
				setInitialMessages(automatic?.messages ?? []);
				setInitialPendingQuestions(automatic?.pendingQuestions ?? null);
				setAutomaticParameters(automatic?.parameters ?? []);
				setAutomaticResult(automatic?.result);
				setStarted(true);
			}
			setLoadingSaved(false);
		})();

		return () => {
			active = false;
		};
	}, [savedId, isSignedIn]);

	const refreshAutomaticCalculation =
		useCallback(async (): Promise<AutomaticCalculationData | null> => {
			const calculationId = savedId ?? justCreated.current;
			if (!calculationId) return null;
			const response = await fetch(
				`/api/calculations/${encodeURIComponent(calculationId)}`,
			).catch(() => null);
			let automatic: AutomaticCalculationData | null = null;
			if (response?.ok) {
				const { calculation } = (await response.json()) as {
					calculation?: {
						data?: { automatic?: AutomaticCalculationData };
					};
				};
				automatic = calculation?.data?.automatic ?? null;
				setAutomaticParameters(automatic?.parameters ?? []);
				setAutomaticResult(automatic?.result);
			}
			await refreshCalculations();
			return automatic;
		}, [savedId]);

	const canStart = documents.length > 0;

	const persistChatDocuments = useCallback(
		async (nextDocuments: AutomaticDocumentRef[]): Promise<boolean> => {
			const calculationId = savedId ?? justCreated.current;
			if (!calculationId) return false;

			const response = await fetch(
				`/api/calculations/${encodeURIComponent(calculationId)}`,
				{
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						documents: nextDocuments.map(({ id }) => ({ id })),
					}),
				},
			).catch(() => null);
			if (!response?.ok) {
				toast.error('Belgeler kaydedilemedi', {
					description:
						'Sayfayı yenilediğinizde son eklenen belgeler görünmeyebilir.',
				});
				return false;
			}
			return true;
		},
		[savedId],
	);

	// Optimistic (and revert) rename applier for the overview.
	const handleRenameDocument = useCallback(
		(id: string, name: string) => {
			const nextDocuments = documentsRef.current.map((doc) =>
				doc.id === id ? { ...doc, name } : doc,
			);
			documentsRef.current = nextDocuments;
			setDocuments(nextDocuments);
			void persistChatDocuments(nextDocuments);
		},
		[persistChatDocuments],
	);

	// Drops a document from this calculation. The underlying file stays in the
	// user's library (removable for good from the documents page).
	const handleRemoveDocument = useCallback(
		(id: string) => {
			const nextDocuments = documentsRef.current.filter(
				(doc) => doc.id !== id,
			);
			documentsRef.current = nextDocuments;
			setDocuments(nextDocuments);
			setAutomaticParameters([]);
			setAutomaticResult(undefined);
			void persistChatDocuments(nextDocuments);
		},
		[persistChatDocuments],
	);

	const handleReorderDocuments = useCallback(
		(nextDocuments: AutomaticDocumentRef[]) => {
			documentsRef.current = nextDocuments;
			setDocuments(nextDocuments);
			void persistChatDocuments(nextDocuments);
		},
		[persistChatDocuments],
	);

	const handleChatDocumentsUploaded = useCallback(
		async (uploaded: AutomaticDocumentRef[]): Promise<boolean> => {
			const existingIds = new Set(
				documentsRef.current.map((document) => document.id),
			);
			const nextDocuments = [
				...documentsRef.current,
				...uploaded.filter((document) => !existingIds.has(document.id)),
			];
			documentsRef.current = nextDocuments;
			setDocuments(nextDocuments);
			setAutomaticParameters([]);
			setAutomaticResult(undefined);
			return persistChatDocuments(nextDocuments);
		},
		[persistChatDocuments],
	);

	const overviewSections: AutomaticOverviewSection[] = [
		{
			id: 'documents',
			title: 'Belgeler',
			icon: 'documents',
			documents,
		},
		...(automaticParameters.length > 0
			? [
					{
						id: 'parameters',
						title: 'Hesap parametreleri',
						icon: 'insights' as const,
						defaultOpen: true,
						rows: automaticParameters.map((parameter) => ({
							label: parameter.label,
							value: formatParameterValue(parameter),
						})),
					},
				]
			: []),
		...(automaticResult
			? [
					{
						id: 'result',
						title: 'Tahmini sonuç',
						icon: 'result' as const,
						defaultOpen: true,
						rows: [
							{ label: 'ISR', value: formatEur(automaticResult.isr) },
							{ label: 'ISP', value: formatEur(automaticResult.isp) },
							{
								label: 'ISPEU',
								value: formatEur(automaticResult.ispeu),
							},
							{
								label: 'ISEEU',
								value: formatEur(automaticResult.iseeu),
							},
						],
					},
				]
			: []),
	];

	const startCalculation = useCallback(async () => {
		if (creating || documents.length === 0) return;
		if (!isSignedIn) {
			setLoginPromptOpen(true);
			return;
		}
		setCreating(true);

		// Blob URLs do not survive a reload, so don't persist them; the preview
		// is re-fetched from the document id on re-open.
		const persistedDocuments = documents.map((doc) => ({
			...doc,
			url: doc.url && !doc.url.startsWith('blob:') ? doc.url : undefined,
		}));
		const title = `Otomatik hesaplama · ${new Date().toLocaleDateString('tr-TR')}`;

		const response = await fetch('/api/calculations', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				type: 'automatic',
				title,
				iseeu: 0,
				data: {
					state,
					config,
					automatic: { documents: persistedDocuments },
				},
			}),
		}).catch(() => null);

		if (response?.ok) {
			const { id } = (await response.json()) as { id: string };
			justCreated.current = id;
			setInitialMessages([]);
			setInitialPendingQuestions(null);
			setAutomaticParameters([]);
			setAutomaticResult(undefined);
			upsertCalculationLocal({
				id,
				type: 'automatic',
				title,
				iseeu: 0,
				createdAt: new Date().toISOString(),
			});
			setActiveCalculation(id);
			setCreating(false);
			// Reflect the new chat in the URL so a reload re-opens it and the
			// sidebar can mark it active. The saved-id effect mounts the chat only
			// after this navigation has completed.
			router.replace(`/automatic?id=${encodeURIComponent(id)}`);
			return;
		}

		setCreating(false);
		if (response?.status === 401) {
			setLoginPromptOpen(true);
			return;
		}
		toast.error('Hesaplama oluşturulamadı', {
			description: 'Lütfen tekrar deneyin.',
		});
	}, [creating, documents, state, config, isSignedIn, router]);

	if (loadingSaved) {
		return <LoadingState />;
	}

	if (started) {
		const calculationId = savedId ?? justCreated.current;
		return (
			<main className="flex flex-1 gap-6 pt-16 xl:items-start">
				<div className="mx-auto flex w-full flex-col">
					<AutomaticChat
						calculationId={calculationId}
						documents={documents}
						initialMessages={initialMessages}
						initialPendingQuestions={initialPendingQuestions}
						onDocumentsUploaded={handleChatDocumentsUploaded}
						onCalculationUpdated={
							refreshAutomaticCalculation
						}
						className="h-[calc(100dvh-8rem)] xl:h-[calc(100dvh-7rem)] px-4 sm:px-8"
					/>
					<div className="px-4 sm:px-8">{disclaimer}</div>
				</div>

				<div className="hidden w-84 shrink-0 xl:block">
					<AutomaticOverview
						sections={overviewSections}
						onRenameDocument={handleRenameDocument}
						onRemoveDocument={handleRemoveDocument}
						onReorderDocuments={handleReorderDocuments}
						className="fixed top-24 right-8 bottom-6 z-30 w-84 overflow-y-auto"
					/>
				</div>
			</main>
		);
	}

	return (
		<>
			<main className="flex flex-1 items-start gap-6 px-4 pb-32 pt-24 sm:px-8">
				<div className="mx-auto w-full space-y-6">
					<div className="space-y-2">
						<h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
							Belgelerden otomatik hesaplama
						</h1>
						<p className="text-muted-foreground">
							{config.year} · {config.scholarship} için gelir,
							taşınır ve taşınmaz bilgilerini belgelerden çıkaran
							otomatik akış.
						</p>
					</div>

					<AutomaticDocumentUpload onDocumentsChange={setDocuments} />

					{disclaimer}
				</div>
			</main>

			<AnimatePresence>
				{canStart && (
					<motion.footer
						initial={{ y: 24, opacity: 0 }}
						animate={{ y: 0, opacity: 1 }}
						exit={{ y: 24, opacity: 0 }}
						transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
						className="fixed right-0 bottom-0 left-0 z-40 flex items-center justify-between gap-3 border-t bg-transparent px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl sm:px-8 sm:pt-3.5 sm:pb-[calc(0.875rem+env(safe-area-inset-bottom))] md:left-64 md:bg-background/80 lg:left-84"
					>
						<p className="hidden text-sm text-muted-foreground sm:block">
							{documents.length} belge hazır · otomatik
							hesaplamayı başlatın
						</p>
						<Button
							className="min-w-48 max-sm:w-full"
							loading={creating}
							disabled={creating}
							onClick={startCalculation}
						>
							{!creating && <SparkleIcon weight="fill" />}
							{creating
								? 'Hesaplama oluşturuluyor'
								: 'Otomatik hesaplamayı başlat'}
							{!creating && <ArrowRightIcon />}
						</Button>
					</motion.footer>
				)}
			</AnimatePresence>

			<LoginPromptDialog
				open={loginPromptOpen}
				onOpenChange={setLoginPromptOpen}
				title="Otomatik hesaplama için giriş yapın"
				description="Belge yüklemek, yapay zeka ile sohbet etmek ve hesaplamanızı kaydetmek için giriş yapmanız gerekir."
			/>
		</>
	);
}
