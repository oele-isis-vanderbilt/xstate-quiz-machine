import { assign, fromCallback, sendTo, setup } from 'xstate';
import type { EventObject } from 'xstate';
import type { InitialContext, Context, QuizResponseEvent } from './quizMachine.types';
import {
	AttemptEvents,
	Commands,
	InProgressStages,
	QuizStates,
	TimerActorEvents
} from './quizMachine.types';

const findNumberofAttemptsForQuestion = <E, R>(
	events: QuizResponseEvent<E, R>[],
	questionId: string,
	questionIdentifierFn: (question: E) => string
): number => {
	const questionAttempts = events.filter(
		(event) =>
			event.type === AttemptEvents.RESPONSE && questionIdentifierFn(event.question) === questionId
	);
	return questionAttempts.length;
};

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
		},
		skipedQuestions: ctx.skipedQuestions || new Map<string, E>(),
		regularFlowQuestionIdx: ctx.regularFlowQuestionIdx || null,
		regularFlowQuestion: ctx.regularFlowQuestion || null,
		skippedMode: ctx.skippedMode || false,
		regularFlowCompleted: ctx.regularFlowCompleted || false
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
				const regularFlowCompleted = context.regularFlowCompleted;
				const lastEvent = context.events.at(-1);
				let moreRetriesPossible = false;

				if (lastEvent?.type === AttemptEvents.RESPONSE) {
					const wasCorrect = lastEvent.response?.correct;
					moreRetriesPossible =
						!wasCorrect && context.noOfAttempts + 1 < context.maxAttemptPerQuestion;
				}

				const isLastSkippedQuestionWithNoRetries =
					context.skippedMode && context.skipedQuestions.size === 0 && !moreRetriesPossible;

				const noSkippedQuestionsLeft = !context.skippedMode && context.skipedQuestions.size === 0;

				return (
					regularFlowCompleted && (noSkippedQuestionsLeft || isLastSkippedQuestionWithNoRetries)
				);
			},
			isValidSkippedQuestion: ({ context, event }) => {
				const skippedQuestionId = event.skippedQuestionId!;
				return context.skipedQuestions.has(skippedQuestionId);
			},
			regularFlowCompleted: ({ context }) => {
				return context.regularFlowCompleted;
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
				let regularFlowCompeleted = context.regularFlowCompleted;
				if (context.skippedMode) {
					regularFlowCompeleted = context.regularFlowCompleted;
				} else {
					const wasLastQuestion = context.currentQuestionIdx + 1 === context.questions.length;
					regularFlowCompeleted = result.correct
						? wasLastQuestion
						: wasLastQuestion && noOfAttempts >= context.maxAttemptPerQuestion;
				}
				return {
					events: updatedResponses,
					noOfAttempts: noOfAttempts,
					regularFlowCompleted: regularFlowCompeleted
				};
			}),
			// @ts-ignore
			incrementQuestionAsSkipped: assign(({ context }) => {
				if (context.skippedMode && !context.regularFlowCompleted) {
					const lastRegularFlowQuestionIdx = context.regularFlowQuestionIdx!;
					const lastRegularFlowQuestion = context.regularFlowQuestion!;
					return {
						skippedMode: false,
						regularFlowQuestionIdx: null,
						regularFlowQuestion: null,
						currentQuestionIdx: lastRegularFlowQuestionIdx,
						currentQuestion: lastRegularFlowQuestion,
						noOfAttempts: 0
					};
				} else if (context.skippedMode && context.regularFlowCompleted) {
					const skippedSize = context.skipedQuestions.size;
					if (skippedSize === 0) {
						return {
							currentQuestionIdx: context.currentQuestionIdx,
							currentQuestion: context.currentQuestion,
							noOfAttempts: 0,
							skippedMode: false,
							regularFlowQuestionIdx: null,
							regularFlowQuestion: null,
							regularFlowCompleted: true
						};
					} else {
						const firstSkippedQuestionId = context.skipedQuestions.keys().next().value!;
						const questionToGo = context.skipedQuestions.get(firstSkippedQuestionId)!;
						const skippedQuestionIdx = context.questions.findIndex(
							(q) => context.questionIdentifierFn(q) === firstSkippedQuestionId
						);
						const newSkipedQuestions = new Map(context.skipedQuestions);
						newSkipedQuestions.delete(firstSkippedQuestionId);
						return {
							currentQuestionIdx: skippedQuestionIdx,
							currentQuestion: questionToGo,
							noOfAttempts: findNumberofAttemptsForQuestion(
								context.events,
								firstSkippedQuestionId,
								context.questionIdentifierFn
							),
							skipedQuestions: newSkipedQuestions,
							skippedMode: true,
							regularFlowQuestionIdx: null,
							regularFlowQuestion: null,
							regularFlowCompleted: true
						};
					}
				} else {
					const wasLastQuestion = context.currentQuestionIdx + 1 === context.questions.length;
					if (wasLastQuestion) {
						const firstSkippedQuestionId = context.skipedQuestions.keys().next().value;
						if (firstSkippedQuestionId) {
							const questionToGo = context.skipedQuestions.get(firstSkippedQuestionId)!;
							const skippedQuestionIdx = context.questions.findIndex(
								(q) => context.questionIdentifierFn(q) === firstSkippedQuestionId
							);
							const newSkipedQuestions = new Map(context.skipedQuestions);
							newSkipedQuestions.delete(firstSkippedQuestionId);
							return {
								skippedMode: true,
								currentQuestionIdx: skippedQuestionIdx,
								currentQuestion: questionToGo,
								skipedQuestions: newSkipedQuestions,
								noOfAttempts: findNumberofAttemptsForQuestion(
									context.events,
									firstSkippedQuestionId,
									context.questionIdentifierFn
								),
								regularFlowQuestionIdx: null,
								regularFlowQuestion: null,
								regularFlowCompleted: true
							};
						}
					} else {
						return {
							currentQuestionIdx: context.currentQuestionIdx + 1,
							currentQuestion: context.questions[context.currentQuestionIdx + 1],
							noOfAttempts: 0
						};
					}
				}
			}),
			resetTimeLeft: assign({
				timeLeft: () => 0
			}),
			markQuestionSkipped: assign(({ context, event }) => {
				const timestamp = Date.now();
				const timeSpent = Math.floor((timestamp - context.attemptStartTime) / 1000);
				const newSkipedQuestions = new Map(context.skipedQuestions);
				const questionToSkip = event.question || context.currentQuestion;
				newSkipedQuestions.set(context.questionIdentifierFn(questionToSkip), questionToSkip);
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
					skipedQuestions: newSkipedQuestions,
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
			// @ts-ignore
			conditionalGoToNextQuestion: assign(({ context }) => {
				const lastEvent = context.events.at(-1);
				const shouldIncrement =
					(lastEvent?.type === AttemptEvents.RESPONSE && lastEvent.response?.correct) ||
					context.noOfAttempts >= context.maxAttemptPerQuestion;

				if (context.skippedMode && !context.regularFlowCompleted) {
					return {
						skippedMode: false,
						regularFlowQuestionIdx: null,
						regularFlowQuestion: null,
						currentQuestionIdx: shouldIncrement
							? context.regularFlowQuestionIdx
							: context.currentQuestionIdx,
						currentQuestion: shouldIncrement
							? context.regularFlowQuestion
							: context.currentQuestion,
						noOfAttempts: shouldIncrement ? 0 : context.noOfAttempts
					};
				} else if (context.skippedMode && context.regularFlowCompleted) {
					const skippedSize = context.skipedQuestions.size;
					if (skippedSize === 0) {
						return {
							currentQuestionIdx: context.currentQuestionIdx,
							currentQuestion: context.currentQuestion,
							noOfAttempts: shouldIncrement ? 0 : context.noOfAttempts,
							skippedMode: false,
							regularFlowQuestionIdx: null,
							regularFlowQuestion: null,
							regularFlowCompleted: true
						};
					} else if (shouldIncrement) {
						// Move to next skipped question
						const firstSkippedQuestionId = context.skipedQuestions.keys().next().value!;
						const questionToGo = context.skipedQuestions.get(firstSkippedQuestionId)!;
						const skippedQuestionIdx = context.questions.findIndex(
							(q) => context.questionIdentifierFn(q) === firstSkippedQuestionId
						);
						const newSkipedQuestions = new Map(context.skipedQuestions);
						newSkipedQuestions.delete(firstSkippedQuestionId);

						return {
							currentQuestionIdx: skippedQuestionIdx,
							currentQuestion: questionToGo,
							noOfAttempts: findNumberofAttemptsForQuestion(
								context.events,
								firstSkippedQuestionId,
								context.questionIdentifierFn
							),
							skipedQuestions: newSkipedQuestions,
							skippedMode: true,
							regularFlowQuestionIdx: null,
							regularFlowQuestion: null,
							regularFlowCompleted: true
						};
					} else {
						// Stay on current question
						return {
							currentQuestionIdx: context.currentQuestionIdx,
							currentQuestion: context.currentQuestion,
							noOfAttempts: context.noOfAttempts,
							skipedQuestions: context.skipedQuestions,
							skippedMode: true,
							regularFlowQuestionIdx: null,
							regularFlowQuestion: null,
							regularFlowCompleted: true
						};
					}
				}

				const wasLastQuestion = context.currentQuestionIdx + 1 === context.questions.length;

				if (wasLastQuestion && shouldIncrement && context.skipedQuestions.size > 0) {
					const firstSkippedQuestionId = context.skipedQuestions.keys().next().value!;
					const questionToGo = context.skipedQuestions.get(firstSkippedQuestionId);
					const skippedQuestionIdx = context.questions.findIndex(
						(q) => context.questionIdentifierFn(q) === firstSkippedQuestionId
					);
					const newSkipedQuestions = new Map(context.skipedQuestions);
					newSkipedQuestions.delete(firstSkippedQuestionId);
					return {
						skippedMode: true,
						currentQuestionIdx: skippedQuestionIdx,
						currentQuestion: questionToGo,
						skipedQuestions: newSkipedQuestions,
						regularFlowQuestionIdx: null,
						regularFlowQuestion: null,
						noOfAttempts: findNumberofAttemptsForQuestion(
							context.events,
							firstSkippedQuestionId,
							context.questionIdentifierFn
						),
						regularFlowCompleted: true
					};
				}

				return {
					noOfAttempts: shouldIncrement ? 0 : context.noOfAttempts,
					currentQuestionIdx: shouldIncrement
						? context.currentQuestionIdx + 1
						: context.currentQuestionIdx,
					currentQuestion: shouldIncrement
						? context.questions[context.currentQuestionIdx + 1]
						: context.currentQuestion,
					skippedMode: false,
					regularFlowQuestionIdx: null,
					regularFlowQuestion: null,
					regularFlowCompleted: false
				};
			}),
			goToSkippedQuestion: assign(({ context, event }) => {
				const skippedQuestionId = event.skippedQuestionId!;
				const questionToGo = context.skipedQuestions.get(skippedQuestionId)!;
				const skippedQuestionIdx = context.questions.findIndex(
					(q) => context.questionIdentifierFn(q) === skippedQuestionId
				);
				const newSkipedQuestions = new Map(context.skipedQuestions);
				newSkipedQuestions.delete(skippedQuestionId);

				if (!context.skippedMode) {
					return {
						skippedMode: true,
						skipedQuestions: newSkipedQuestions,
						currentQuestion: questionToGo,
						currentQuestionIdx: skippedQuestionIdx,
						regularFlowQuestionIdx: context.currentQuestionIdx,
						regularFlowQuestion: context.currentQuestion,
						noOfAttempts: findNumberofAttemptsForQuestion(
							context.events,
							skippedQuestionId,
							context.questionIdentifierFn
						)
					};
				} else {
					newSkipedQuestions.set(
						context.questionIdentifierFn(context.currentQuestion),
						context.currentQuestion
					);
					return {
						skippedMode: true,
						skipedQuestions: newSkipedQuestions,
						currentQuestion: questionToGo,
						currentQuestionIdx: skippedQuestionIdx,
						noOfAttempts: findNumberofAttemptsForQuestion(
							context.events,
							skippedQuestionId,
							context.questionIdentifierFn
						)
					};
				}
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
									actions: ['markQuestionSkipped', 'incrementQuestionAsSkipped'],
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
