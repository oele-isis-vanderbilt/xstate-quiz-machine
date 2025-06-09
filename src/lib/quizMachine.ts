import { assign, fromCallback, sendTo, setup } from 'xstate';
import type { EventObject } from 'xstate';

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

type OptionalContextKeys = Exclude<keyof Context<any, any>, RequiredContextKeys>;

export type InitialContext<E, R> = Pick<Context<E, R>, RequiredContextKeys> &
	Partial<Pick<Context<E, R>, OptionalContextKeys>>;

export enum QuizStates {
	STARTING = 'starting',
	IN_PROGRESS = 'in-progress',
	REVIEWING = 'reviewing',
	COMPLETED = 'completed'
}

enum TimerActorEvents {
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
	REJECT_SKIP = 'reject_skip'
}

export enum InProgressStages {
	WAITING_FOR_ANSWER = 'waiting_for_answer',
	GRADING = 'grading',
	SKIPPING = 'skipping'
}

// export const

export const createQuizMachine = <E, R>(
	initialContext: InitialContext<E, R>,
	delayBetweenAttempts: number = 1000
) => {
	const createContext = (ctx: InitialContext<E, R>): Context<E, R> => ({
		attemptDuration: ctx.attemptDuration,
		questions: ctx.questions,
		attemptStartTime: ctx.attemptStartTime || Date.now(),
		currentQuestionIdx: ctx.currentQuestionIdx || 0,
		currentQuestion: ctx.currentQuestion || ctx.questions[0],
		elapsedTime: ctx.elapsedTime || 0,
		stateStartTime: ctx.stateStartTime || Date.now(),
		timeLeft: ctx.timeLeft || ctx.attemptDuration,
		events: ctx.events || [],
		responseLoggerFn: ctx.responseLoggerFn,
		graderFn: ctx.graderFn,
		questionIdentifierFn: ctx.questionIdentifierFn,
		eventsLogger: ctx.eventsLogger || console,
		maxAttemptPerQuestion: ctx.maxAttemptPerQuestion || 1,
		reviewDuration: ctx.reviewDuration || 30,
		noOfAttempts: 0,
		stageSummaries: ctx.stageSummaries || {
			[QuizStates.IN_PROGRESS]: {
				questionsAttempted: 0,
				questionsSkipped: 0,
				questionsCorrect: 0,
				questionsIncorrect: 0,
				timeSpentSeconds: 0
			},
			[QuizStates.REVIEWING]: {
				timeSpentSeconds: 0
			}
		}
	});

	const getInProgressStageSummary = (context: Context<E, R>) => {
		const attempts = context.events.filter((event) => event.type === AttemptEvents.RESPONSE);
		const numberOfUniqueQuestionsAttempted = attempts.reduce((acc, event) => {
			const questionId = context.questionIdentifierFn(event.question);
			acc.add(questionId);
			return acc;
		}, new Set<string>()).size;

		const numberOfUniqueQuestionsIncorrect = attempts
			.filter((attempt) => !attempt.response?.correct)
			.reduce((acc, event) => {
				const questionId = context.questionIdentifierFn(event.question);
				acc.add(questionId);
				return acc;
			}, new Set<string>()).size;

		const numberOfUniqueQuestionsCorrect = attempts
			.filter((attempt) => attempt.response?.correct)
			.reduce((acc, event) => {
				const questionId = context.questionIdentifierFn(event.question);
				acc.add(questionId);
				return acc;
			}, new Set<string>()).size;
		return {
			[QuizStates.IN_PROGRESS]: {
				questionsAttempted: numberOfUniqueQuestionsAttempted,
				questionsSkipped: context.events.filter((event) => event.type === AttemptEvents.SKIP)
					.length,
				questionsCorrect: numberOfUniqueQuestionsCorrect,
				questionsIncorrect: numberOfUniqueQuestionsIncorrect,
				timeSpentSeconds: Math.floor((Date.now() - context.stateStartTime) / 1000)
			}
		};
	};

	const machine = setup({
		types: {
			context: {} as Context<E, R>,
			events: {} as { type: Commands; response?: R; question?: E; remaining?: number }
		},
		delays: {
			delayBetweenAttempts
		},
		guards: {
			timeoutExceeded: (
				{ context },
				params: { durationKey: 'attemptDuration' | 'reviewDuration' }
			) => {
				const elapsed = Math.floor((Date.now() - context.stateStartTime) / 1000);
				return elapsed >= context[params.durationKey];
			},
			questionsExhausted: ({ context }) => {
				return context.currentQuestionIdx + 1 >= context.questions.length;
			}
		},
		actions: {
			evaluateResponse: assign(({ context, event }) => {
				const response = event.response!;
				const timestamp = Date.now();
				const timeSpentSeconds = Math.floor((timestamp - context.attemptStartTime) / 1000);
				const question = event.question || context.currentQuestion;
				const result = context.graderFn(question, response);
				const noOfAttempts = context.noOfAttempts + 1;

				const responseEvent: QuizResponseEvent<E, R> = {
					type: AttemptEvents.RESPONSE,
					timestamp: timestamp,
					question,
					response: { ...result, attemptNumber: noOfAttempts },
					timeSpentSeconds: timeSpentSeconds
				};

				context.responseLoggerFn(question, response);
				const updatedResponses = context.events.concat(responseEvent);
				return {
					events: updatedResponses,
					noOfAttempts: noOfAttempts
				};
			}),
			incrementQuestion: assign({
				currentQuestionIdx: ({ context }) => context.currentQuestionIdx + 1,
				currentQuestion: ({ context }) => context.questions[context.currentQuestionIdx + 1],
				noOfAttempts: ({ context }) => 0
			}),
			resetTimeLeft: assign({
				timeLeft: ({ context }) => 0
			}),
			markQuestionSkipped: assign(({ context, event }) => {
				const timestamp = Date.now();
				const timeSpent = Math.floor((timestamp - context.attemptStartTime) / 1000);
				const updatedEvents = [
					...context.events,
					{
						type: AttemptEvents.SKIP,
						timestamp: Date.now(),
						question: event.question || context.currentQuestion,
						timeSpentSeconds: timeSpent
					}
				];
				return {
					events: updatedEvents
				};
			}),
			setAttemptStartTime: assign({
				attemptStartTime: () => Date.now()
			}),
			summarizeAttemptStage: assign({
				stageSummaries: ({ context }) => {
					return {
						...context.stageSummaries,
						...getInProgressStageSummary(context)
					};
				}
			}),
			summarizeReviewStage: assign({
				stageSummaries: ({ context }) => {
					return {
						...context.stageSummaries,
						[QuizStates.REVIEWING]: {
							timeSpentSeconds: Math.floor((Date.now() - context.stateStartTime) / 1000)
						}
					};
				}
			}),
			conditionalGoToNextQuestion: assign(({ context }) => {
				const lastEvent = context.events.at(-1);
				const shouldIncrement =
					(lastEvent?.type === AttemptEvents.RESPONSE && lastEvent.response?.correct) ||
					context.noOfAttempts + 1 > context.maxAttemptPerQuestion;

				return {
					noOfAttempts: shouldIncrement ? 0 : context.noOfAttempts,
					currentQuestionIdx: shouldIncrement
						? context.currentQuestionIdx + 1
						: context.currentQuestionIdx,
					currentQuestion: shouldIncrement
						? context.questions[context.currentQuestionIdx + 1]
						: context.currentQuestion
				};
			})
		},
		actors: {
			tickCallback: fromCallback<EventObject, { durationSeconds: number }>(
				({ sendBack, receive, input }) => {
					let remaining = input.durationSeconds * 1000;

					let start = Date.now();
					let interval: ReturnType<typeof setInterval> | null = null;

					const startTimer = () => {
						interval = setInterval(() => {
							const now = Date.now();
							remaining -= now - start;
							start = now;
							sendBack({ type: Commands.TICK, remaining });
							if (remaining <= 0) {
								sendBack({ type: Commands.TIMEOUT });
							}
						}, 1000);
					};

					receive((event) => {
						if (event.type === TimerActorEvents.PAUSE) {
							interval && clearInterval(interval);
						} else if (event.type === TimerActorEvents.RESUME) {
							start = Date.now();
							startTimer();
						} else if (event.type === TimerActorEvents.STOP) {
							interval && clearInterval(interval);
						}
					});

					startTimer();
					return () => interval && clearInterval(interval);
				}
			)
		}
	}).createMachine({
		id: 'quizMachine',
		initial: QuizStates.STARTING,
		context: createContext(initialContext),
		states: {
			[QuizStates.STARTING]: {
				on: {
					[Commands.START]: {
						target: QuizStates.IN_PROGRESS
					}
				}
			},
			[QuizStates.IN_PROGRESS]: {
				entry: assign({
					stateStartTime: () => Date.now(),
					timeLeft: ({ context }) => context.attemptDuration,
					currentQuestionIdx: 0,
					currentQuestion: ({ context }) => context.questions[context.currentQuestionIdx]
				}),
				invoke: {
					id: 'attemptTick',
					src: 'tickCallback',
					input: {
						durationSeconds: initialContext.attemptDuration
					}
				},
				initial: InProgressStages.WAITING_FOR_ANSWER,
				states: {
					[InProgressStages.WAITING_FOR_ANSWER]: {
						entry: ['setAttemptStartTime'],
						on: {
							[Commands.SUBMIT_ANSWER]: {
								target: InProgressStages.GRADING
							},
							[Commands.SKIP]: {
								target: InProgressStages.SKIPPING
							}
						}
					},
					[InProgressStages.SKIPPING]: {
						entry: [sendTo('attemptTick', { type: TimerActorEvents.PAUSE })],
						exit: [sendTo('attemptTick', { type: TimerActorEvents.RESUME })],
						on: {
							[Commands.CONFIRM_SKIP]: [
								{
									guard: 'questionsExhausted',
									target: `#quizMachine.${QuizStates.REVIEWING}`
								},
								{
									actions: ['incrementQuestion', 'markQuestionSkipped'],
									target: InProgressStages.WAITING_FOR_ANSWER
								}
							],
							[Commands.REJECT_SKIP]: {
								target: InProgressStages.WAITING_FOR_ANSWER
							}
						}
					},
					[InProgressStages.GRADING]: {
						entry: [sendTo('attemptTick', { type: TimerActorEvents.PAUSE }), 'evaluateResponse'],
						exit: [sendTo('attemptTick', { type: TimerActorEvents.RESUME })],
						always: [
							{
								guard: 'questionsExhausted',
								target: `#quizMachine.${QuizStates.REVIEWING}`
							}
						],
						after: {
							delayBetweenAttempts: {
								target: InProgressStages.WAITING_FOR_ANSWER,
								actions: ['conditionalGoToNextQuestion']
							}
						}
					}
				},
				on: {
					[Commands.TICK]: [
						{
							actions: assign({
								timeLeft: ({ context, event }) => {
									const remaining = event.remaining!;
									return Math.max(0, Math.floor(remaining / 1000));
								}
							})
						}
					],
					[Commands.TIMEOUT]: {
						target: QuizStates.REVIEWING
					}
				},
				exit: [
					sendTo('attemptTick', { type: TimerActorEvents.STOP }),
					'resetTimeLeft',
					'summarizeAttemptStage'
				]
			},
			[QuizStates.REVIEWING]: {
				invoke: {
					id: 'reviewTick',
					src: 'tickCallback',
					input: {
						durationSeconds: initialContext.reviewDuration
					}
				},
				entry: assign({
					stateStartTime: () => Date.now(),
					timeLeft: ({ context }) => context.reviewDuration
				}),
				on: {
					[Commands.TICK]: [
						{
							actions: assign({
								timeLeft: ({ context, event }) => {
									const remaining = event.remaining!;
									return Math.max(0, Math.floor(remaining / 1000));
								}
							})
						}
					],
					[Commands.TIMEOUT]: {
						target: QuizStates.COMPLETED
					}
				},
				exit: [
					sendTo('reviewTick', { type: TimerActorEvents.STOP }),
					'resetTimeLeft',
					'summarizeReviewStage'
				]
			},
			[QuizStates.COMPLETED]: {
				type: 'final'
			}
		}
	});

	return machine;
};
