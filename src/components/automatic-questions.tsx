'use client';

import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
	ArrowRightIcon,
	QuestionIcon,
	SkipForwardIcon,
} from '@phosphor-icons/react';

import { Button } from './ui/button';
import { Input } from './ui/input';
import { cn } from '@/lib/utils';
import type { AutomaticClarifyingQuestion } from '@/src/lib/automatic';

export interface ClarifyingAnswer {
	id: string;
	question: string;
	/** The user's answer, or null when the question was skipped. */
	answer: string | null;
}

/**
 * Walks the user through the agent's clarifying questions one at a time. Each
 * question can be answered with a preset option, a free-text answer, or skipped;
 * the next question slides in until the batch is complete, then `onComplete`
 * hands every answer back so the agent can resume.
 */
export function AutomaticQuestions({
	questions,
	onComplete,
	disabled,
}: {
	questions: AutomaticClarifyingQuestion[];
	onComplete: (answers: ClarifyingAnswer[]) => void;
	disabled?: boolean;
}) {
	const [index, setIndex] = useState(0);
	const [draft, setDraft] = useState('');
	const answersRef = useRef<ClarifyingAnswer[]>([]);
	const current = questions[index];

	const advance = (answer: string | null) => {
		if (disabled || !current) return;
		const next = [
			...answersRef.current,
			{ id: current.id, question: current.question, answer },
		];
		answersRef.current = next;
		setDraft('');
		if (index + 1 >= questions.length) {
			onComplete(next);
			return;
		}
		setIndex(index + 1);
	};

	if (!current) return null;

	const trimmedDraft = draft.trim();

	return (
		<div className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
			<div className="mb-3 flex items-center justify-between gap-3">
				<span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
					<QuestionIcon className="size-3.5" weight="duotone" />
					Netleştirelim
				</span>
				<span className="text-xs tabular-nums text-muted-foreground">
					{index + 1}/{questions.length}
				</span>
			</div>

			<div className="mb-4 flex gap-1">
				{questions.map((question, position) => (
					<span
						key={question.id}
						className={cn(
							'h-1 flex-1 rounded-full transition-colors duration-300',
							position <= index ? 'bg-primary' : 'bg-muted',
						)}
					/>
				))}
			</div>

			<AnimatePresence initial={false} mode="wait">
				<motion.div
					key={current.id}
					initial={{ opacity: 0, y: 12 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: -12 }}
					transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
				>
					<p className="text-base font-medium leading-snug text-foreground">
						{current.question}
					</p>

					{current.options && current.options.length > 0 && (
						<div className="mt-3 flex flex-wrap gap-2">
							{current.options.map((option) => (
								<Button
									key={option}
									type="button"
									variant="outline"
									size="sm"
									disabled={disabled}
									onClick={() => advance(option)}
									className="rounded-full"
								>
									{option}
								</Button>
							))}
						</div>
					)}

					<form
						className="mt-3 flex items-center gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							if (trimmedDraft) advance(trimmedDraft);
						}}
					>
						<Input
							value={draft}
							disabled={disabled}
							onChange={(event) => setDraft(event.currentTarget.value)}
							placeholder={
								current.placeholder ??
								(current.options && current.options.length > 0
									? 'Ya da kendi yanıtınızı yazın…'
									: 'Yanıtınızı yazın…')
							}
							autoFocus
						/>
						<Button
							type="submit"
							size="icon"
							disabled={disabled || !trimmedDraft}
							aria-label="Yanıtı gönder"
						>
							<ArrowRightIcon className="size-4" />
						</Button>
					</form>

					<button
						type="button"
						disabled={disabled}
						onClick={() => advance(null)}
						className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
					>
						<SkipForwardIcon className="size-3.5" />
						{index + 1 >= questions.length
							? 'Atla ve devam et'
							: 'Bu soruyu atla'}
					</button>
				</motion.div>
			</AnimatePresence>
		</div>
	);
}
