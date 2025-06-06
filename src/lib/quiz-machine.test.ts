import { describe, expect, it, vi } from 'vitest';
import { Commands, createQuizMachine, QuizStates } from './quizMachine';
import type { Context } from './quizMachine';
import { createActor } from 'xstate';
let simpleQuestions = [
	{ id: '1', text: 'What is 2 + 2?', answer: '4' },
	{ id: '2', text: 'What is the capital of France?', answer: 'Paris' },
	{ id: '3', text: 'What is the largest planet in our solar system?', answer: 'Jupiter' }
];

describe('quiz machine', () => {
	const initialContext: Context<
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
		responses: [],
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
		noOfAttempts: 0
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
		expect(snapshot.value).toBe(QuizStates.IN_PROGRESS);
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
		await new Promise((resolve) => setTimeout(resolve, 1000 * 4)); // Simulate time passing
		expect(actor.getSnapshot().value).toBe(QuizStates.REVIEWING);
		await new Promise((resolve) => setTimeout(resolve, 1000 * 4)); // Simulate time passing
		expect(actor.getSnapshot().value).toBe(QuizStates.COMPLETED);
	}, 10000);
});
