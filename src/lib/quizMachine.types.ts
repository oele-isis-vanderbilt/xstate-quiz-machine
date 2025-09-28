export enum AttemptEvents {
	RESPONSE = 'response',
	SKIP = 'skip'
}

export interface AttemptResponse<R> {
	correct: boolean;
	payload?: R;
	attemptNumber?: number;
}

export type QuizResponseEvent<E, R> = {
	type: AttemptEvents;
	timestamp: number;
	question: E;
	timeSpentSeconds?: number;
	response?: AttemptResponse<R>;
};

export interface Context<E, R> {
	currentQuestion: E;
	maxAttemptPerQuestion: number;
	currentQuestionIdx: number;
	attemptDuration: number;
	reviewDuration: number;
	timeLeft: number;
	elapsedTime: number;
	stateStartTime: number;
	questions: E[];
	noOfAttempts: number;
	graderFn: (
		question: E,
		response: R
	) => {
		correct: boolean;
		payload?: R;
	};
	questionIdentifierFn: (question: E) => string;
	responseLoggerFn: (question: E, response: R) => void;
	eventsLogger: {
		info: (message: string) => void;
		error: (message: string) => void;
		debug: (message: string) => void;
		warn: (message: string) => void;
	};
	events: QuizResponseEvent<E, R>[];
	stageSummaries: {
		[QuizStates.IN_PROGRESS]: {
			questionsAttempted: number;
			questionsSkipped: number;
			questionsCorrect: number;
			questionsIncorrect: number;
			timeSpentSeconds: number;
		};
		[QuizStates.REVIEWING]: {
			timeSpentSeconds: number;
		};
	};
	attemptStartTime: number;
	skipedQuestions: Map<string, E>;
	regularFlowQuestionIdx: number | null;
	regularFlowQuestion: E | null;
	skippedMode: boolean;
	regularFlowCompleted: boolean;
}

type RequiredContextKeys =
	| 'questions'
	| 'graderFn'
	| 'questionIdentifierFn'
	| 'responseLoggerFn'
	| 'maxAttemptPerQuestion'
	| 'attemptDuration'
	| 'reviewDuration'
	| 'maxAttemptPerQuestion';

type OptionalContextKeys<E, R> = Exclude<keyof Context<E, R>, RequiredContextKeys>;

export type InitialContext<E, R> = Pick<Context<E, R>, RequiredContextKeys> &
	Partial<Pick<Context<E, R>, OptionalContextKeys<E, R>>>;

export enum QuizStates {
	STARTING = 'starting',
	IN_PROGRESS = 'in-progress',
	REVIEWING = 'reviewing',
	COMPLETED = 'completed'
}

export enum TimerActorEvents {
	STOP = 'stop',
	PAUSE = 'pause',
	RESUME = 'resume'
}

export enum Commands {
	START = 'start',
	SUBMIT_ANSWER = 'submit_answer',
	REVIEW = 'review',
	TICK = 'tick',
	SKIP = 'skip',
	TIMEOUT = 'timeout',
	CONFIRM_SKIP = 'confirm_skip',
	REJECT_SKIP = 'reject_skip',
	COMPLETE_REVIEW = 'complete_review',
	GOTO_REVIEW = 'goto_review',
	COMPLETE_ASSESSMENT = 'complete_assessment',
	GOTO_SKIPPED = 'goto_skipped',
	FORCE_REVIEW = 'force_review'
}

export enum InProgressStages {
	WAITING_FOR_ANSWER = 'waiting_for_answer',
	GRADING = 'grading',
	SKIPPING = 'skipping'
}
