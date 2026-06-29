'use client';

import {
	ArrowClockwiseIcon,
	BankIcon,
	CheckCircleIcon,
	HouseLineIcon,
	IdentificationCardIcon,
	InfoIcon,
	MoneyIcon,
	PencilSimpleIcon,
	ReceiptIcon,
	SparkleIcon,
	UsersThreeIcon,
	WarningCircleIcon,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Badge } from '@/src/components/ui/badge';
import { Button } from '@/src/components/ui/button';
import { Spinner } from '@/src/components/ui/spinner';
import type {
	DocumentAnalysis,
	ImmovableAssetFinding,
	IncomeFinding,
	MovableAssetFinding,
} from '@/src/lib/document-analysis';
import type { DocumentAnalysisStatus } from '@/src/db/schema';
import { cn } from '@/lib/utils';

const DOCUMENT_TYPE_LABELS: Record<DocumentAnalysis['documentType'], string> = {
	income: 'Gelir belgesi',
	bank_statement: 'Banka/hesap belgesi',
	investment: 'Yatırım / menkul kıymet',
	real_estate: 'Gayrimenkul belgesi',
	rental: 'Kira belgesi',
	family_status: 'Aile durumu belgesi',
	identity: 'Kimlik belgesi',
	other: 'Diğer belge',
	unknown: 'Belirlenemeyen belge',
};

const INCOME_KIND_LABELS: Record<IncomeFinding['kind'], string> = {
	salary: 'Maaş / ücret',
	pension: 'Emekli aylığı',
	self_employment: 'Serbest meslek / işletme',
	rental: 'Kira geliri',
	benefit: 'Yardım / burs',
	other: 'Diğer gelir',
};

const MOVABLE_KIND_LABELS: Record<MovableAssetFinding['kind'], string> = {
	bank: 'Banka / mevduat hesabı',
	investment: 'Yatırım / menkul kıymet',
	insurance: 'Sigorta birikimi',
	company_share: 'Şirket payı',
	other: 'Diğer taşınır varlık',
};

const IMMOVABLE_KIND_LABELS: Record<ImmovableAssetFinding['kind'], string> = {
	building: 'Bina / konut',
	land: 'Arsa / arazi',
	other: 'Diğer taşınmaz',
};

const CONFIDENCE_LABELS: Record<DocumentAnalysis['confidence'], string> = {
	high: 'Yüksek güven',
	medium: 'Orta güven',
	low: 'Düşük güven',
};

const CONFIDENCE_VARIANTS: Record<
	DocumentAnalysis['confidence'],
	'default' | 'secondary' | 'outline'
> = {
	high: 'default',
	medium: 'secondary',
	low: 'outline',
};

const numberFormatter = new Intl.NumberFormat('tr-TR', {
	maximumFractionDigits: 2,
});

/** Formats an amount in its original currency, falling back gracefully. */
function formatAmount(value: number | null, currency: string | null): string {
	if (value === null || Number.isNaN(value)) return '—';
	if (currency && /^[A-Za-z]{3}$/.test(currency)) {
		try {
			return new Intl.NumberFormat('tr-TR', {
				style: 'currency',
				currency: currency.toUpperCase(),
				maximumFractionDigits: 2,
			}).format(value);
		} catch {
			// Unknown ISO code — fall through to plain number + code.
		}
	}
	const formatted = numberFormatter.format(value);
	return currency ? `${formatted} ${currency}` : formatted;
}

function formatSqm(value: number | null): string | null {
	if (value === null || Number.isNaN(value)) return null;
	return `${numberFormatter.format(value)} m²`;
}

function formatShare(value: number | null): string | null {
	if (value === null || Number.isNaN(value)) return null;
	return `%${numberFormatter.format(value * 100)} pay`;
}

/** A titled group of findings; renders nothing when it has no rows. */
function Section({
	icon,
	title,
	children,
}: {
	icon: ReactNode;
	title: string;
	children: ReactNode;
}) {
	return (
		<section className="space-y-2">
			<h4 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
				{icon}
				{title}
			</h4>
			{children}
		</section>
	);
}

/** One finding card: a primary label, an optional amount, and detail chips. */
function FindingRow({
	title,
	amount,
	details,
}: {
	title: string;
	amount?: string;
	details?: (string | null)[];
}) {
	const shownDetails = (details ?? []).filter((d): d is string => !!d);
	return (
		<div className="rounded-lg border bg-card px-3 py-2">
			<div className="flex items-start justify-between gap-2">
				<p className="text-sm font-medium">{title}</p>
				{amount && (
					<p className="shrink-0 text-sm font-semibold tabular-nums">
						{amount}
					</p>
				)}
			</div>
			{shownDetails.length > 0 && (
				<p className="mt-0.5 text-xs text-muted-foreground">
					{shownDetails.join(' · ')}
				</p>
			)}
		</div>
	);
}

function MetaRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center justify-between gap-2 text-sm">
			<span className="text-muted-foreground">{label}</span>
			<span className="font-medium">{value}</span>
		</div>
	);
}

/** Splits "report.final.pdf" into { base: "report.final", ext: ".pdf" }. */
function splitExtension(name: string): { base: string; ext: string } {
	const dot = name.lastIndexOf('.');
	if (dot <= 0) return { base: name, ext: '' };
	return { base: name.slice(0, dot), ext: name.slice(dot) };
}

type RenamePhase = 'idle' | 'applying' | 'applied' | 'exiting' | 'done';

/**
 * Banner offering the LLM's clearer file-name suggestion. Shows only when the
 * suggestion meaningfully differs from the current name. After applying it
 * plays a brief "applied" animation, then collapses away instead of vanishing.
 */
function RenameSuggestion({
	currentName,
	suggestedName,
	onRename,
}: {
	currentName: string;
	suggestedName: string;
	onRename: (newName: string) => Promise<boolean>;
}) {
	const [phase, setPhase] = useState<RenamePhase>('idle');
	const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

	useEffect(
		() => () => {
			for (const timer of timers.current) clearTimeout(timer);
		},
		[],
	);

	const { base, ext } = splitExtension(currentName);
	// Defensively drop any extension the model may have added, then restore the
	// file's real extension so renaming never changes the type.
	const suggestionBase = suggestedName.trim().replace(/\.[A-Za-z0-9]+$/, '');
	const fullName = `${suggestionBase}${ext}`;

	// Only render when the suggestion is a real, different name. Once we are past
	// 'idle' we keep rendering so the applied animation can finish even though
	// the current name now equals the suggestion.
	const isDistinct =
		!!suggestionBase &&
		suggestionBase.toLocaleLowerCase('tr') !== base.toLocaleLowerCase('tr');
	if (phase === 'idle' && !isDistinct) return null;
	if (phase === 'done') return null;

	const applied = phase === 'applied' || phase === 'exiting';

	const apply = async () => {
		setPhase('applying');
		const ok = await onRename(fullName);
		if (!ok) {
			setPhase('idle');
			return;
		}
		setPhase('applied');
		timers.current.push(setTimeout(() => setPhase('exiting'), 1100));
		timers.current.push(setTimeout(() => setPhase('done'), 1450));
	};

	return (
		<div
			className={cn(
				'overflow-hidden transition-all duration-300 ease-out',
				phase === 'exiting'
					? 'max-h-0 -translate-y-1 opacity-0'
					: 'max-h-40 opacity-100',
			)}
		>
			<div
				className={cn(
					'rounded-lg border p-3 transition-colors duration-300',
					applied
						? 'border-emerald-500/40 bg-emerald-500/5'
						: 'border-primary/30 bg-primary/5',
				)}
			>
				{applied ? (
					<div className="flex items-center gap-2 text-sm font-medium text-emerald-600">
						<CheckCircleIcon weight="fill" className="size-4" />
						Yeniden adlandırıldı
					</div>
				) : (
					<>
						<div className="flex items-center gap-1.5 text-xs font-medium text-primary">
							<SparkleIcon weight="fill" className="size-3.5" />
							Daha açıklayıcı bir ad önerisi
						</div>
						<p
							className="mt-1.5 truncate text-sm font-semibold"
							title={fullName}
						>
							{suggestionBase}
						</p>
						<Button
							type="button"
							size="sm"
							className="mt-2.5 w-full"
							disabled={phase === 'applying'}
							onClick={apply}
						>
							{phase === 'applying' ? (
								<Spinner className="size-4" />
							) : (
								<PencilSimpleIcon />
							)}
							Yeniden adlandır
						</Button>
					</>
				)}
			</div>
		</div>
	);
}

/**
 * Shows the cached ISEEU findings extracted from a document, formatted for the
 * preview. Handles the pending / failed / no-analysis states too. When
 * `currentName` and `onRename` are given and the analysis suggests a clearer
 * name, a rename banner is shown at the top.
 */
export function DocumentAnalysisPanel({
	status,
	analysis,
	currentName,
	onRename,
	onRetry,
	retrying = false,
}: {
	status: DocumentAnalysisStatus;
	analysis: DocumentAnalysis | null;
	currentName?: string;
	onRename?: (newName: string) => Promise<boolean>;
	/** Re-runs the analysis; shown as a retry button when analysis failed. */
	onRetry?: () => void;
	/** Whether a retry is currently in flight. */
	retrying?: boolean;
}) {
	if (
		status === 'pending' ||
		status === 'processing' ||
		(status === 'completed' && !analysis)
	) {
		return (
			<div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
				<Spinner className="size-6 text-primary" />
				<div>
					<p className="text-sm font-medium">Belge analiz ediliyor…</p>
					<p className="mt-1 text-xs text-muted-foreground">
						Gelir, taşınır ve taşınmaz bilgileri çıkarılıyor. Bu işlem
						birkaç saniye sürebilir.
					</p>
				</div>
			</div>
		);
	}

	if (status === 'failed') {
		return (
			<div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
				<WarningCircleIcon className="size-6 text-destructive" />
				<div>
					<p className="text-sm font-medium">Belge analiz edilemedi.</p>
					<p className="mt-1 text-xs text-muted-foreground">
						Bu belge otomatik olarak okunamadı, bu yüzden
						bilgileri hesaplamada kullanılamaz. Yeniden deneyebilir
						veya bilgileri elle girebilirsiniz.
					</p>
				</div>
				{onRetry && (
					<Button
						type="button"
						size="sm"
						variant="outline"
						disabled={retrying}
						onClick={onRetry}
					>
						{retrying ? (
							<Spinner className="size-4" />
						) : (
							<ArrowClockwiseIcon />
						)}
						Yeniden analiz et
					</Button>
				)}
			</div>
		);
	}

	if (!analysis) return null;

	const meta: { label: string; value: string }[] = [];
	if (analysis.personLabel)
		meta.push({ label: 'İlgili kişi', value: analysis.personLabel });
	if (analysis.referenceYear)
		meta.push({ label: 'Referans yılı', value: String(analysis.referenceYear) });
	if (analysis.currency)
		meta.push({ label: 'Para birimi', value: analysis.currency });

	const suggestedName = analysis.suggestedName?.trim();

	return (
		<div className="space-y-6">
			{suggestedName && currentName && onRename && (
				<RenameSuggestion
					currentName={currentName}
					suggestedName={suggestedName}
					onRename={onRename}
				/>
			)}

			<div className="space-y-3">
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant="secondary">
						<IdentificationCardIcon />
						{DOCUMENT_TYPE_LABELS[analysis.documentType]}
					</Badge>
					<Badge variant={CONFIDENCE_VARIANTS[analysis.confidence]}>
						{CONFIDENCE_LABELS[analysis.confidence]}
					</Badge>
				</div>
				{analysis.summary && (
					<p className="text-sm leading-relaxed text-foreground">
						{analysis.summary}
					</p>
				)}
				{meta.length > 0 && (
					<div className="space-y-1 rounded-lg border bg-muted/30 px-3 py-2">
						{meta.map((row) => (
							<MetaRow
								key={row.label}
								label={row.label}
								value={row.value}
							/>
						))}
					</div>
				)}
			</div>

			{analysis.income.length > 0 && (
				<Section icon={<MoneyIcon />} title="Gelir (ISR)">
					<div className="space-y-2">
						{analysis.income.map((item, index) => (
							<FindingRow
								key={index}
								title={item.label ?? INCOME_KIND_LABELS[item.kind]}
								amount={formatAmount(
									item.annualAmount,
									analysis.currency,
								)}
								details={[INCOME_KIND_LABELS[item.kind], 'yıllık']}
							/>
						))}
					</div>
				</Section>
			)}

			{analysis.movableAssets.length > 0 && (
				<Section icon={<BankIcon />} title="Taşınır varlıklar (ISP)">
					<div className="space-y-2">
						{analysis.movableAssets.map((item, index) => (
							<FindingRow
								key={index}
								title={item.label ?? MOVABLE_KIND_LABELS[item.kind]}
								amount={formatAmount(
									item.balanceDec31,
									analysis.currency,
								)}
								details={[
									MOVABLE_KIND_LABELS[item.kind],
									formatShare(item.ownershipShare),
								]}
							/>
						))}
					</div>
				</Section>
			)}

			{analysis.immovableAssets.length > 0 && (
				<Section icon={<HouseLineIcon />} title="Taşınmaz varlıklar (ISP)">
					<div className="space-y-2">
						{analysis.immovableAssets.map((item, index) => (
							<FindingRow
								key={index}
								title={item.label ?? IMMOVABLE_KIND_LABELS[item.kind]}
								details={[
									IMMOVABLE_KIND_LABELS[item.kind],
									formatSqm(item.buildingSqm)
										? `bina ${formatSqm(item.buildingSqm)}`
										: null,
									formatSqm(item.landSqm)
										? `arsa ${formatSqm(item.landSqm)}`
										: null,
									formatShare(item.ownershipShare),
									item.isPrimaryResidence === true
										? 'ana konut'
										: null,
									item.mortgageRemaining !== null
										? `kalan kredi ${formatAmount(item.mortgageRemaining, analysis.currency)}`
										: null,
								]}
							/>
						))}
					</div>
				</Section>
			)}

			{analysis.householdMembers.length > 0 && (
				<Section icon={<UsersThreeIcon />} title="Hane üyeleri">
					<div className="space-y-2">
						{analysis.householdMembers.map((member, index) => (
							<FindingRow
								key={index}
								title={
									member.name ?? member.relation ?? 'Hane üyesi'
								}
								details={[
									member.name ? member.relation : null,
								]}
							/>
						))}
					</div>
				</Section>
			)}

			{analysis.missingInfo.length > 0 && (
				<Section
					icon={<InfoIcon />}
					title="Netleştirilmesi gerekenler"
				>
					<ul className="space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
						{analysis.missingInfo.map((note, index) => (
							<li
								key={index}
								className="flex gap-2 text-xs text-muted-foreground"
							>
								<ReceiptIcon className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
								<span>{note}</span>
							</li>
						))}
					</ul>
				</Section>
			)}
		</div>
	);
}
