import { assign, fromCallback, sendTo, setup } from 'xstate';
import type { EventObject } from 'xstate';
import type {
	InitialContext,
	Context,
	QuizResponseEvent,
	ContextV2,
	InitialContextV2
} from './quizMachine.types';
import {
	AttemptEvents,
	Commands,
	InProgressStages,
	QuizStates,
	TimerActorEvents
} from './quizMachine.types';

export const createQuizMachineV2 = <E, R>(
	initialContext: InitialContextV2<E, R>,
	delayBetweenAttempts: number = 1000
) => {
	const createContext = (ctx: InitialContextV2<E, R>): ContextV2<E, R> => ({
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
		},
		skipedQuestions: ctx.skipedQuestions || new Map<string, E>(),
		regularFlowQuestionIdx: ctx.regularFlowQuestionIdx || null,
		regularFlowQuestion: ctx.regularFlowQuestion || null,
		skippedMode: ctx.skippedMode || false,
		regularFlowCompleted: ctx.regularFlowCompleted || false
	});

	const getInProgressStageSummary = (context: ContextV2<E, R>) => {
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
			context: {} as ContextV2<E, R>,
			events: {} as {
				type: Commands;
				response?: R;
				question?: E;
				remaining?: number;
				skippedQuestionId?: string;
			}
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
				const remainingAttempts = context.questions.map((fsmQuestion) => {
					return fsmQuestion.attemptsLeft;
				});
				return remainingAttempts.every((attempts) => attempts <= 0);
			},
			isValidSkippedQuestion: ({ context, event }) => {
				const skippedQuestionId = event.skippedQuestionId!;
				const problem = context.questions.find((q) => q.id === skippedQuestionId)!;
				return problem.isSkipped && problem.attemptsLeft > 0;
			},
			regularFlowCompleted: ({ context }) => {
				return context.regularFlowCompleted;
			}
		},
		actions: {
			evaluateResponse: assign(({ context, event }) => {
				const fsmProblem = context.currentQuestion;
				const response = event.response!;
				const timestamp = Date.now();
				const timeSpentSeconds = Math.floor((timestamp - context.attemptStartTime) / 1000);
				const question = event.question || fsmProblem.question;
				const result = context.graderFn(question, response);
				const attemptNumber = fsmProblem.maxAttempts - fsmProblem.attemptsLeft;
				const responseEvent: QuizResponseEvent<E, R> = {
					type: AttemptEvents.RESPONSE,
					timestamp: timestamp,
					question,
					response: { ...result, attemptNumber: attemptNumber },
					timeSpentSeconds: timeSpentSeconds
				};

				context.responseLoggerFn(question, response);
				const updatedResponses = context.events.concat(responseEvent);
				const fsmProblemIdx = context.questions.findIndex((q) => q.question === question);
				const attemptsLeft = result.correct ? 0 : fsmProblem.attemptsLeft - 1;
				const isSkipped = false;

				return {
					events: updatedResponses,
					questions: context.questions.map((problem, idx) => {
						if (idx === fsmProblemIdx) {
							return {
								...problem,
								attemptsLeft: attemptsLeft,
								isSkipped: isSkipped
							};
						}
						return problem;
					})
				};
			}),
			// @ts-ignore
			gotoNextQuestion: assign(({ context }) => {
				const firstNonSkippedQuestionWithAttemptsLeft = context.questions.find(
					(q) => !q.isSkipped && q.attemptsLeft > 0
				);
                console.log('First non skipped question with attempts left:', firstNonSkippedQuestionWithAttemptsLeft);
				if (firstNonSkippedQuestionWithAttemptsLeft) {
                    const currentQuestionIdx = context.questions.findIndex(
                        (q) => q.id === firstNonSkippedQuestionWithAttemptsLeft.id
                    );
					return {
						currentQuestion: firstNonSkippedQuestionWithAttemptsLeft,
                        currentQuestionIdx: currentQuestionIdx
					};
				} else {
					const nextSkippedQuestion = context.questions.find(
						(q) => q.isSkipped && q.attemptsLeft > 0
					);
					if (nextSkippedQuestion) {
						return {
							currentQuestion: nextSkippedQuestion,
							skippedMode: true
						};
					}
				}
			}),
			resetTimeLeft: assign({
				timeLeft: () => 0
			}),
			markQuestionSkipped: assign(({ context, event }) => {
				const skippedQuestionId = event.skippedQuestionId!;
				const problemIdx = context.questions.findIndex((q) => q.id === skippedQuestionId)!;
                const skipEvent = {
                    type: AttemptEvents.SKIP,
                    timestamp: Date.now(),
                    question: context.questions[problemIdx].question
                };
                const updatedEvents = context.events.concat(skipEvent);
				const updatedProblems = context.questions.map((problem, idx) => {
					if (idx === problemIdx) {
						return {
							...problem,
							isSkipped: true
						};
					}
					return problem;
				});
				return {
					questions: updatedProblems,
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
			goToSkippedQuestion: assign(({ context, event }) => {
				const skippedQuestionId = event.skippedQuestionId!;
				const problem = context.questions.find((q) => q.id === skippedQuestionId)!;
				const updatedProblems = context.questions.map((p) => {
					if (p.id === skippedQuestionId) {
						return {
							...p,
							isSkipped: false
						};
					}
					return p;
				});
				return {
					currentQuestion: problem.question,
					questions: updatedProblems,
					skippedMode: true
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
							if (interval) {
								clearInterval(interval);
							}
						} else if (event.type === TimerActorEvents.RESUME) {
							start = Date.now();
							startTimer();
						} else if (event.type === TimerActorEvents.STOP) {
							if (interval) {
								clearInterval(interval);
							}
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
					},
					[Commands.GOTO_REVIEW]: {
						target: QuizStates.REVIEWING
					},
					[Commands.COMPLETE_ASSESSMENT]: {
						target: QuizStates.COMPLETED
					}
				}
			},
			[QuizStates.IN_PROGRESS]: {
				entry: assign({
					stateStartTime: () => Date.now(),
					timeLeft: ({ context }) => context.attemptDuration,
					currentQuestion: ({ context }) =>
						context.questions.find((q) => !q.isSkipped && q.attemptsLeft !== 0)!
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
							},
							[Commands.GOTO_SKIPPED]: {
								guard: 'isValidSkippedQuestion',
								actions: ['goToSkippedQuestion'],
								target: InProgressStages.WAITING_FOR_ANSWER
							},
							[Commands.FORCE_REVIEW]: {
								guard: 'regularFlowCompleted',
								target: `#quizMachine.${QuizStates.REVIEWING}`
							}
						}
					},
					[InProgressStages.SKIPPING]: {
						entry: [sendTo('attemptTick', { type: TimerActorEvents.PAUSE })],
						exit: [sendTo('attemptTick', { type: TimerActorEvents.RESUME })],
						on: {
							[Commands.CONFIRM_SKIP]: [
								{
									actions: ['markQuestionSkipped', 'gotoNextQuestion'],
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
								actions: ['gotoNextQuestion']
							}
						}
					}
				},
				on: {
					[Commands.TICK]: [
						{
							actions: assign({
								timeLeft: ({ event }) => {
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
								timeLeft: ({ event }) => {
									const remaining = event.remaining!;
									return Math.max(0, Math.floor(remaining / 1000));
								}
							})
						}
					],
					[Commands.TIMEOUT]: {
						target: QuizStates.COMPLETED
					},
					[Commands.COMPLETE_REVIEW]: {
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
