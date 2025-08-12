import { describe, expect, it, vi } from 'vitest';
import {
	AttemptEvents,
	Commands,
	createQuizMachine,
	InProgressStages,
	QuizStates
} from './quizMachine';
import type { InitialContext } from './quizMachine';
import { createActor } from 'xstate';
const simpleQuestions = [
	{ id: '1', text: 'What is 2 + 2?', answer: '4' },
	{ id: '2', text: 'What is the capital of France?', answer: 'Paris' },
	{ id: '3', text: 'What is the largest planet in our solar system?', answer: 'Jupiter' }
];

const simulatedDelay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('quiz machine', () => {
	const initialContext: InitialContext<
		{
			id: string;
			text: string;
			answer: string;
		},
		string
	> = {
		questions: simpleQuestions,
		currentQuestionIdx: 0,
		stateStartTime: Date.now(),
		attemptDuration: 60,
		timeLeft: 60,
		events: [],
		responseLoggerFn: vi.fn(),
		currentQuestion: simpleQuestions[2],
		elapsedTime: 0,
		eventsLogger: {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn()
		},
		graderFn: vi.fn(),
		maxAttemptPerQuestion: 2,
		reviewDuration: 30,
		noOfAttempts: 0,
		attemptStartTime: 0,
		questionIdentifierFn: (question) => question.id
	};

	it('should initialize the quiz machine with the correct question', () => {
		const quizMachine = createQuizMachine(initialContext);
		const actor = createActor(quizMachine);
		actor.start();
		actor.send({ type: Commands.START });
		const snapshot = actor.getSnapshot();
		expect(snapshot.context.currentQuestionIdx).toBe(0);
		expect(snapshot.context.currentQuestion.text).toBe('What is 2 + 2?');
		expect(snapshot.context.questions.length).toBe(3);
		expect(snapshot.matches(QuizStates.IN_PROGRESS));
	});

	it('should transition from `IN_PROGRESS` to `REVIEWING` after timeout and `COMPLETED` after timeout for `REVIEWING`', async () => {
		const context = {
			...initialContext,
			attemptDuration: 3,
			reviewDuration: 3
		};
		const quizMachine = createQuizMachine(context);
		const actor = createActor(quizMachine);
		actor.start();
		actor.send({ type: Commands.START });
		await simulatedDelay(1000 * 4); // Simulate time passing
		expect(actor.getSnapshot().value).toBe(QuizStates.REVIEWING);
		await simulatedDelay(1000 * 4); // Simulate time passing for review
		expect(actor.getSnapshot().value).toBe(QuizStates.COMPLETED);
	}, 10000);

	it('should go to `COMPLETED` state after completing reviewing', async () => {
		const context = {
			...initialContext,
			attemptDuration: 3,
			reviewDuration: 100
		};
		const quizMachine = createQuizMachine(context);
		const actor = createActor(quizMachine);
		actor.start();
		actor.send({ type: Commands.START });
		await simulatedDelay(1000 * 4); // Simulate time passing
		expect(actor.getSnapshot().value).toBe(QuizStates.REVIEWING);
		actor.send({ type: Commands.COMPLETE_REVIEW });
		expect(actor.getSnapshot().value).toBe(QuizStates.COMPLETED);
	}, 5000);

	it('should transition to `REVIEWING` state when `GOTO_REVIEW` command is sent', () => {
		const quizMachine = createQuizMachine(initialContext);
		const actor = createActor(quizMachine);
		actor.start();
		actor.send({ type: Commands.GOTO_REVIEW });
		expect(actor.getSnapshot().value).toBe(QuizStates.REVIEWING);
	});

	it('should transition to `COMPLETED` state when `COMPLETE_ASSESSMENT` command is sent', () => {
		const quizMachine = createQuizMachine(initialContext);
		const actor = createActor(quizMachine);
		actor.start();
		actor.send({ type: Commands.COMPLETE_ASSESSMENT });
		expect(actor.getSnapshot().value).toBe(QuizStates.COMPLETED);
	});

	describe('in-progress', () => {
		const quizMachine = createQuizMachine(initialContext);

		it('should handle first correct answer with delays', async () => {
			const actor = createActor(quizMachine);
			actor.start();
			actor.send({ type: Commands.START });
			actor.send({
				type: Commands.SUBMIT_ANSWER,
				response: '4'
			});
			const snapshot = actor.getSnapshot();
			expect(
				snapshot.matches({
					[QuizStates.IN_PROGRESS]: InProgressStages.GRADING
				})
			).toBe(true);
			expect(snapshot.context.noOfAttempts).toBe(1);
			await simulatedDelay(1000);
			const afterGradingSnapshot = actor.getSnapshot();
			expect(
				afterGradingSnapshot.matches({
					[QuizStates.IN_PROGRESS]: InProgressStages.WAITING_FOR_ANSWER
				})
			).toBe(true);
			expect(afterGradingSnapshot.context.timeLeft).to.be.toBeGreaterThanOrEqual(59);
		});

		it('should handle skipped question correctly', async () => {
			const actor = createActor(quizMachine);
			actor.start();
			actor.send({ type: Commands.START });
			actor.send({
				type: Commands.SKIP
			});

			let snapshot = actor.getSnapshot();
			expect(
				snapshot.matches({
					[QuizStates.IN_PROGRESS]: InProgressStages.SKIPPING
				})
			).toBe(true);
			expect(snapshot.context.currentQuestionIdx).toBe(0); // Should still be on the first question

			actor.send({
				type: Commands.CONFIRM_SKIP
			});
			// After confirming skip, it should move to the next question
			snapshot = actor.getSnapshot();

			expect(snapshot.context.currentQuestionIdx).toBe(1); // Should move to the next question
			expect(snapshot.context.currentQuestion.text).toBe('What is the capital of France?');
			expect(
				snapshot.matches({
					[QuizStates.IN_PROGRESS]: InProgressStages.WAITING_FOR_ANSWER
				})
			).toBe(true);
		});

		it('should not increment question index on reject skip', async () => {
			const actor = createActor(quizMachine);
			actor.start();
			actor.send({ type: Commands.START });
			actor.send({
				type: Commands.SKIP
			});

			let snapshot = actor.getSnapshot();
			expect(
				snapshot.matches({
					[QuizStates.IN_PROGRESS]: InProgressStages.SKIPPING
				})
			).toBe(true);
			expect(snapshot.context.currentQuestionIdx).toBe(0); // Should still be on the first question
			expect(snapshot.context.currentQuestion.text).toBe('What is 2 + 2?');
			actor.send({
				type: Commands.REJECT_SKIP
			});
			// After rejecting skip, it should stay on the same question
			snapshot = actor.getSnapshot();
			expect(snapshot.context.currentQuestionIdx).toBe(0); // Should still be on the first question
			expect(snapshot.context.currentQuestion.text).toBe('What is 2 + 2?');
			expect(
				snapshot.matches({
					[QuizStates.IN_PROGRESS]: InProgressStages.WAITING_FOR_ANSWER
				})
			).toBe(true);
		});

		it('shoud go to `REVIEWING` stage after all questions are skipped', async () => {
			const actor = createActor(quizMachine);
			actor.start();
			actor.send({ type: Commands.START });
			for (let i = 0; i < simpleQuestions.length; i++) {
				actor.send({
					type: Commands.SKIP
				});
				actor.send({
					type: Commands.CONFIRM_SKIP
				});
			}
			const snapshot = actor.getSnapshot();
			expect(snapshot.matches(QuizStates.REVIEWING)).toBe(true);
			expect(snapshot.context.currentQuestionIdx).toBe(2); // Should be at the end of the questions
		});

		it('should only allow a predefined number of attempts per question', async () => {
			const context = {
				...initialContext,
				maxAttemptPerQuestion: 2
			};
			const quizMachine = createQuizMachine(context, 1000);
			const actor = createActor(quizMachine);
			actor.start();
			actor.send({ type: Commands.START });
			actor.send({
				type: Commands.SUBMIT_ANSWER,
				response: '5'
			});
			await simulatedDelay(1200); // Simulate time passing for grading
			let snapshot = actor.getSnapshot();
			expect(
				snapshot.matches({
					[QuizStates.IN_PROGRESS]: InProgressStages.WAITING_FOR_ANSWER
				})
			).toBe(true);
			expect(snapshot.context.noOfAttempts).toBe(1);
			expect(snapshot.context.currentQuestionIdx).toBe(0); // Still on the first question

			actor.send({
				type: Commands.SUBMIT_ANSWER,
				response: '6'
			});
			snapshot = actor.getSnapshot();
			expect(snapshot.context.noOfAttempts).toBe(2);
			await simulatedDelay(1200); // Simulate time passing for grading
			snapshot = actor.getSnapshot();
			expect(snapshot.context.currentQuestionIdx).toBe(1); // Still on the first question
			expect(
				snapshot.matches({
					[QuizStates.IN_PROGRESS]: InProgressStages.WAITING_FOR_ANSWER
				})
			).toBe(true);
		});

		it('should pause the timer when in grading stage', async () => {
			const quizMachine = createQuizMachine(initialContext, 1500);
			const actor = createActor(quizMachine);
			actor.start();
			actor.send({ type: Commands.START });
			const initialTimeLeft = actor.getSnapshot().context.timeLeft;
			actor.send({
				type: Commands.SUBMIT_ANSWER,
				response: '5'
			});
			await simulatedDelay(1000);
			const snapshot = actor.getSnapshot();
			expect(
				snapshot.matches({
					[QuizStates.IN_PROGRESS]: InProgressStages.GRADING
				})
			).toBe(true);
			expect(snapshot.context.timeLeft).toBe(initialTimeLeft); // Time should not decrease during grading
		});

		it('should mark skip events correctly', async () => {
			const quizMachine = createQuizMachine(initialContext);
			const actor = createActor(quizMachine);
			actor.start();
			actor.send({ type: Commands.START });
			actor.send({
				type: Commands.SKIP
			});
			actor.send({
				type: Commands.CONFIRM_SKIP
			});
			const snapshot = actor.getSnapshot();
			expect(snapshot.context.events.length).toBe(1);
			expect(snapshot.context.events[0].type).toBe(AttemptEvents.SKIP);
			expect(snapshot.context.events[0].question.id).toBe('1'); // The first question
			expect(snapshot.context.currentQuestionIdx).toBe(1); // Should move to the next question
			expect(snapshot.context.currentQuestion.text).toBe('What is the capital of France?');
		});

		it('should handle record responses correctly', async () => {
			const context: InitialContext<
				{
					id: string;
					text: string;
					answer: string;
				},
				string
			> = {
				...initialContext,
				responseLoggerFn: vi.fn(),
				graderFn: (question, response) => {
					return {
						correct: question.answer === response,
						payload: response
					};
				}
			};
			const quizMachine = createQuizMachine(context);

			const actor = createActor(quizMachine);
			actor.start();
			actor.send({ type: Commands.START });
			actor.send({
				type: Commands.SUBMIT_ANSWER,
				response: '4'
			});
			const snapshot = actor.getSnapshot();
			expect(snapshot.context.events.length).toBe(1);
			expect(snapshot.context.events[0].response?.correct).toBe(true);
			expect(snapshot.context.events[0].type).toBe(AttemptEvents.RESPONSE);
			expect(snapshot.context.events[0].response?.payload).toBe('4');
			expect(snapshot.context.currentQuestion.id).toBe('1'); // The machine hasn't transitioned to the next question yet
			expect(snapshot.context.noOfAttempts).toBe(1);
		});

		it('should not go to reviewing stage if the last question is incorrect at the first attempt', async () => {
			const context: InitialContext<
				{
					id: string;
					text: string;
					answer: string;
				},
				string
			> = {
				...initialContext,
				maxAttemptPerQuestion: 2,
				responseLoggerFn: vi.fn(),
				graderFn: (question, response) => {
					return {
						correct: question.answer === response,
						payload: response
					};
				}
			};
			const quizMachine = createQuizMachine(context);

			const actor = createActor(quizMachine);
			actor.start();
			// Skip the first two questions
			actor.send({ type: Commands.START });
			actor.send({ type: Commands.SKIP });
			actor.send({ type: Commands.CONFIRM_SKIP });
			actor.send({ type: Commands.SKIP });
			actor.send({ type: Commands.CONFIRM_SKIP });
			// Now we are on the last question
			actor.send({ type: Commands.SUBMIT_ANSWER, response: 'Saturn' });
			await simulatedDelay(1000); // Simulate time passing for grading
			const snapshot = actor.getSnapshot();
			expect(snapshot.matches(QuizStates.IN_PROGRESS)).toBe(true);
			actor.send({ type: Commands.SUBMIT_ANSWER, response: 'Pluto' });
			await simulatedDelay(1000); // Simulate time passing for grading
			const afterSecondAttemptSnapshot = actor.getSnapshot();
			expect(afterSecondAttemptSnapshot.matches(QuizStates.REVIEWING)).toBe(true);
		});

		it('should go to reviewing stage if the last question is incorrect after second attempt', async () => {
			const context: InitialContext<
				{
					id: string;
					text: string;
					answer: string;
				},
				string
			> = {
				...initialContext,
				maxAttemptPerQuestion: 2,
				responseLoggerFn: vi.fn(),
				graderFn: (question, response) => {
					return {
						correct: question.answer === response,
						payload: response
					};
				}
			};
			const quizMachine = createQuizMachine(context);

			const actor = createActor(quizMachine);
			actor.start();
			actor.send({ type: Commands.START });
			actor.send({ type: Commands.SKIP });
			actor.send({ type: Commands.CONFIRM_SKIP });
			actor.send({ type: Commands.SKIP });
			actor.send({ type: Commands.CONFIRM_SKIP });
			actor.send({ type: Commands.SUBMIT_ANSWER, response: 'Jupiter' });
			await simulatedDelay(1000);
			actor.send({ type: Commands.SUBMIT_ANSWER, response: 'Saturn' });
			await simulatedDelay(1000); // Simulate time passing for grading
			expect(actor.getSnapshot().matches(QuizStates.REVIEWING)).toBe(true);
		});

		it('should go to reviewing stage if the last question is correct after second attempt', async () => {
			const context: InitialContext<
				{
					id: string;
					text: string;
					answer: string;
				},
				string
			> = {
				...initialContext,
				maxAttemptPerQuestion: 2,
				responseLoggerFn: vi.fn(),
				graderFn: (question, response) => {
					return {
						correct: question.answer === response,
						payload: response
					};
				}
			};
			const quizMachine = createQuizMachine(context);

			const actor = createActor(quizMachine);
			actor.start();
			actor.send({ type: Commands.START });
			actor.send({ type: Commands.SKIP });
			actor.send({ type: Commands.CONFIRM_SKIP });
			actor.send({ type: Commands.SKIP });
			actor.send({ type: Commands.CONFIRM_SKIP });
			actor.send({ type: Commands.SUBMIT_ANSWER, response: 'Saturn' });
			await simulatedDelay(1000);
			actor.send({ type: Commands.SUBMIT_ANSWER, response: 'Jupiter' });
			await simulatedDelay(1000); // Simulate time passing for grading
			expect(actor.getSnapshot().matches(QuizStates.REVIEWING)).toBe(true);
		});

		it('should go to review stage if the last question is skipped', async () => {
			const context: InitialContext<
				{
					id: string;
					text: string;
					answer: string;
				},
				string
			> = {
				...initialContext,
				maxAttemptPerQuestion: 2,
				responseLoggerFn: vi.fn(),
				graderFn: (question, response) => {
					return {
						correct: question.answer === response,
						payload: response
					};
				}
			};
			const quizMachine = createQuizMachine(context);

			const actor = createActor(quizMachine);
			actor.start();
			actor.send({ type: Commands.START });
			actor.send({ type: Commands.SKIP });
			actor.send({ type: Commands.CONFIRM_SKIP });
			actor.send({ type: Commands.SKIP });
			actor.send({ type: Commands.CONFIRM_SKIP });
			actor.send({ type: Commands.SKIP });
			actor.send({ type: Commands.CONFIRM_SKIP });
			expect(actor.getSnapshot().matches(QuizStates.REVIEWING)).toBe(true);
		});
	});
});
