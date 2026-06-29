import type {
	AutomaticImmovableAssetInput,
	AutomaticIncomeInput,
	AutomaticMovableAssetInput,
} from '@/src/lib/automatic-iseeu';

/** Lightweight document descriptor persisted with an automatic calculation. */
export interface AutomaticDocumentRef {
	id: string;
	name: string;
	size: number;
	type: string;
	/** Persistent URL when the document lives in the library; absent for
	 * session-only uploads (their blob URLs do not survive a reload). */
	url?: string;
}

export interface AutomaticChatMessage {
	id: string;
	role: 'user' | 'assistant';
	text: string;
	createdAt: string;
}

/** A single clarifying question the agent asks only to disambiguate documents. */
export interface AutomaticClarifyingQuestion {
	id: string;
	/** The question text shown to the user. */
	question: string;
	/** Optional preset answers the user can pick with a single tap. When
	 * present, the user may still type their own answer instead. */
	options?: string[];
	/** Placeholder for the free-text field. */
	placeholder?: string;
}

/** A batch of clarifying questions awaiting the user's answers. The user works
 * through them one at a time; the agent resumes once they are answered. */
export interface AutomaticPendingQuestions {
	id: string;
	questions: AutomaticClarifyingQuestion[];
	createdAt: string;
}

export interface AutomaticIseeuResult {
	referenceYear: number;
	householdSize: number;
	coefficient: number;
	isr: number;
	movableTotalEur: number;
	movableFranchiseEur: number;
	movableIsp: number;
	immovableIsp: number;
	isp: number;
	ise: number;
	iseeu: number;
	ispeu: number;
	calculatedAt: string;
}

interface AutomaticParameterBase {
	id: string;
	label: string;
	source: string;
	sourceDocumentIds: string[];
	savedAt: string;
}

export type AutomaticParameterKind =
	| 'reference_year'
	| 'household_size'
	| 'child_count'
	| 'income'
	| 'movable_asset'
	| 'immovable_asset'
	| 'category_confirmation';

export type AutomaticCalculationParameter =
	| (AutomaticParameterBase & {
			kind: 'reference_year';
			value: number;
	  })
	| (AutomaticParameterBase & {
			kind: 'household_size';
			value: number;
	  })
	| (AutomaticParameterBase & {
			kind: 'child_count';
			value: number;
	  })
	| (AutomaticParameterBase & {
			kind: 'income';
			value: Omit<AutomaticIncomeInput, 'source'>;
	  })
	| (AutomaticParameterBase & {
			kind: 'movable_asset';
			value: Omit<AutomaticMovableAssetInput, 'source'>;
	  })
	| (AutomaticParameterBase & {
			kind: 'immovable_asset';
			value: Omit<AutomaticImmovableAssetInput, 'source'>;
	  })
	| (AutomaticParameterBase & {
			kind: 'category_confirmation';
			value: {
				category:
					| 'household'
					| 'income'
					| 'movable_assets'
					| 'immovable_assets';
				confirmed: true;
			};
	  });

/** Automatic-mode payload stored inside a saved calculation's `data`. */
export interface AutomaticCalculationData {
	documents: AutomaticDocumentRef[];
	messages?: AutomaticChatMessage[];
	parameters?: AutomaticCalculationParameter[];
	/** Clarifying questions the agent is currently waiting on, if any. */
	pendingQuestions?: AutomaticPendingQuestions | null;
	result?: AutomaticIseeuResult;
}
