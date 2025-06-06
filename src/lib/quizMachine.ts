import { assign, fromCallback, sendTo, setup } from 'xstate';

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
	responseLoggerFn: (question: E, response: R) => void;
	eventsLogger: {
		info: (message: string) => void;
		error: (message: string) => void;
		debug: (message: string) => void;
		warn: (message: string) => void;
	};
	responses: {
		correct: boolean;
		question: E;
		payload?: R;
	}[];
}

export enum QuizStates {
	STARTING = 'starting',
	IN_PROGRESS = 'in-progress',
	REVIEWING = 'reviewing',
	COMPLETED = 'completed'
}

export enum Commands {
	START = 'start',
	SUBMIT_ANSWER = 'submit_answer',
	REVIEW = 'review',
	TICK = 'tick',
	SKIP = 'skip'
}

enum InProgressStages {
	WAITING_FOR_ANSWER = 'waiting_for_answer',
	GRADING = 'grading'
}

// const timeOutGuard = ()

export const createQuizMachine = <E, R>(initialContext: Context<E, R>) => {
	return setup({
		types: {
			context: {} as Context<E, R>,
			events: {} as { type: Commands; response?: R; question?: E }
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
			},
			shouldGoToNextQuestion: ({ context }) => {
				const last = context.responses.at(-1);
				return last?.correct || context.noOfAttempts + 1 >= context.maxAttemptPerQuestion;
			},
			logTransition: ({ context, event }) => {
				context.eventsLogger.info();
			}
		},
		actions: {
			evaluateResponse: assign(({ context, event }) => {
				const response = event.response!;
				const question = event.question || context.currentQuestion;
				const result = context.graderFn(question, response);

				context.responseLoggerFn(question, response);
				const updatedResponses = [...context.responses, { ...result, question }];
				const shoudIncrement =
					context.noOfAttempts + 1 >= context.maxAttemptPerQuestion || result.correct;

				return {
					responses: updatedResponses,
					noOfAttempts: shoudIncrement ? 0 : context.noOfAttempts + 1,
					currentQuestionIdx: shoudIncrement
						? context.currentQuestionIdx + 1
						: context.currentQuestionIdx,
					currentQuestion:
						context.questions[
							shoudIncrement ? context.currentQuestionIdx + 1 : context.currentQuestionIdx
						]
				};
			}),
			incrementQuestion: assign({
				currentQuestionIdx: ({ context }) => context.currentQuestionIdx + 1,
				currentQuestion: ({ context }) => context.questions[context.currentQuestionIdx + 1]
			})
		},
		actors: {
			tickCallback: fromCallback(({ sendBack, receive }) => {
				const interval = setInterval(() => {
					sendBack({ type: Commands.TICK });
				}, 1000);

				receive((event) => {
					if (event.type === 'stop') {
						clearInterval(interval);
					}
				});
				return () => clearInterval(interval);
			})
		}
	}).createMachine({
		id: 'quizMachine',
		initial: QuizStates.STARTING,
		context: initialContext,
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
					id: 'tick',
					src: 'tickCallback'
				},
				initial: InProgressStages.WAITING_FOR_ANSWER,
				states: {
					[InProgressStages.WAITING_FOR_ANSWER]: {
						on: {
							[Commands.SUBMIT_ANSWER]: {
								target: InProgressStages.GRADING
							},
							[Commands.SKIP]: [
								{
									guard: 'questionsExhausted',
									target: `#quizMachine.${QuizStates.REVIEWING}`
								},
								{
									actions: assign({
										currentQuestionIdx: ({ context }) => context.currentQuestionIdx + 1,
										currentQuestion: ({ context }) =>
											context.questions[context.currentQuestionIdx + 1],
										noOfAttempts: ({ context }) => 0
									})
								}
							]
						}
					},
					[InProgressStages.GRADING]: {
						entry: 'evaluateResponse',
						always: [
							{
								guard: 'questionsExhausted',
								target: `#quizMachine.${QuizStates.REVIEWING}`
							},
							{
								target: InProgressStages.WAITING_FOR_ANSWER
							}
						]
					}
				},
				on: {
					[Commands.TICK]: [
						{
							guard: {
								type: 'timeoutExceeded',
								params: { durationKey: 'attemptDuration' }
							},
							target: QuizStates.REVIEWING
						},
						{
							actions: assign({
								timeLeft: ({ context }) => {
									const elapsed = Math.floor((Date.now() - context.stateStartTime) / 1000);
									return Math.max(0, context.attemptDuration - elapsed);
								}
							})
						}
					]
				},
				exit: sendTo('tick', { type: 'stop' })
			},
			[QuizStates.REVIEWING]: {
				invoke: {
					id: 'tick',
					src: 'tickCallback'
				},
				entry: assign({
					stateStartTime: () => Date.now(),
					timeLeft: ({ context }) => context.reviewDuration
				}),
				on: {
					[Commands.TICK]: [
						{
							guard: {
								type: 'timeoutExceeded',
								params: { durationKey: 'attemptDuration' }
							},
							target: QuizStates.COMPLETED
						},
						{
							actions: assign({
								timeLeft: ({ context }) => {
									const elapsed = Math.floor((Date.now() - context.stateStartTime) / 1000);
									return Math.max(0, context.reviewDuration - elapsed);
								}
							})
						}
					]
				},
				exit: sendTo('tick', { type: 'stop' })
			},
			[QuizStates.COMPLETED]: {
				type: 'final'
			}
		}
	});
};
