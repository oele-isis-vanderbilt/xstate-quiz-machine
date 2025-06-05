<script lang="ts">
	import { createQuizMachine } from '$lib';
	import { Commands, QuizStates, type Context } from '$lib/quizMachine';
	import { Button, review } from 'flowbite-svelte';
	import { useActor, useSelector } from '@xstate/svelte';
	import type { SimpleQuestion } from '$lib/types';
	import type { MachineSnapshot, SnapshotFrom } from 'xstate';

	let questions: SimpleQuestion[] = [
		{
			id: '1',
			question: 'What is the capital of France?',
			options: ['Paris', 'London', 'Berlin', 'Madrid'],
			answer: 'Paris',
			explaination: 'Paris is the capital city of France, known for its art, fashion, and culture.'
		},
		{
			id: '2',
			question: 'What is 2 + 2?',
			options: ['3', '4', '5', '6'],
			answer: '4',
			explaination: '2 + 2 equals 4, a basic arithmetic operation.'
		},
		{
			id: '3',
			question: 'What is the largest planet in our solar system?',
			options: ['Earth', 'Mars', 'Jupiter', 'Saturn'],
			answer: 'Jupiter',
			explaination:
				'Jupiter is the largest planet in our solar system, known for its Great Red Spot and many moons.'
		},
		{
			id: '4',
			question: 'What is the boiling point of water?',
			options: ['100°C', '90°C', '80°C', '110°C'],
			answer: '100°C',
			explaination: 'Water boils at 100 degrees Celsius at standard atmospheric pressure.'
		},
		{
			id: '5',
			question: 'What is the chemical symbol for gold?',
			options: ['Au', 'Ag', 'Fe', 'Hg'],
			answer: 'Au',
			explaination: 'The chemical symbol for gold is Au, derived from the Latin word "aurum".'
		},
		{
			id: '6',
			question: 'What is the largest mammal?',
			options: ['Elephant', 'Blue Whale', 'Giraffe', 'Hippopotamus'],
			answer: 'Blue Whale',
			explaination:
				'The blue whale is the largest mammal, reaching lengths of up to 100 feet and weighing as much as 200 tons.'
		}
	];
	const quizMachine = createQuizMachine<SimpleQuestion, string>({
		questions,
		attemptDuration: 300,
		currentQuestion: questions[0],
		timeLeft: 300,
		reviewDuration: 300,
		currentQuestionIdx: 0,
		elapsedTime: 0,
		noOfAttempts: 0,
		graderFn: (question, response) => {
			console.log(`Grading question ${question.question} with response:`, response);
			return {
				correct: question.answer === response,
				payload: response
			};
		},
		eventsLoggerFn: (event) => {
			console.log('Event:', event);
		},
		maxAttemptPerQuestion: 3,
		responseLoggerFn: (question, response) => {
			console.log(`Response for question ${question.id}:`, response);
		},
		responses: [],
		stateStartTime: Date.now()
	});

	const { snapshot, send, actorRef } = useActor(quizMachine);

	function contextJSON(stateSnapshot: SnapshotFrom<typeof quizMachine>): string {
		return JSON.stringify(
			{
				currentState: stateSnapshot.value,
				currentQuestionIdx: stateSnapshot.context.currentQuestionIdx,
				attemptDuration: stateSnapshot.context.attemptDuration,
				reviewDuration: stateSnapshot.context.reviewDuration,
				timeLeft: stateSnapshot.context.timeLeft,
				maxAttemptPerQuestion: stateSnapshot.context.maxAttemptPerQuestion,
				attemptCount: stateSnapshot.context.noOfAttempts
			},
			null,
			2
		);
	}

	function getDisplayText(stateSnapshot: SnapshotFrom<typeof quizMachine>): string {
		if (stateSnapshot.matches(QuizStates.REVIEWING)) {
			return 'Reviewing your answers...';
		} else if (stateSnapshot.matches(QuizStates.IN_PROGRESS)) {
			return 'Answer the current question!';
		}

		return 'Quiz completed! Review your answers.';
	}

	function responseJSON(response: {
		correct: boolean;
		question: SimpleQuestion;
		payload?: string | undefined;
	}): string {
		return JSON.stringify(
			{
				question: response.question.question,
				response: response.payload,
				correct: response.correct
			},
			null,
			2
		);
	}
</script>

<div class="mx-auto flex w-full flex-row gap-2 p-5">
	<div class="flex w-1/2 flex-col rounded-lg bg-gray-100 p-2 shadow-sm">
		<h1 class="mb-4 text-3xl font-bold">Quiz App</h1>
		{#if $snapshot.value === QuizStates.STARTING}
			<Button
				onclick={() =>
					send({
						type: Commands.START
					})}
				class="w-32"
			>
				Start Quiz
			</Button>
		{/if}
		{#if $snapshot.matches(QuizStates.REVIEWING) || $snapshot.matches(QuizStates.COMPLETED)}
			<div class="flex w-full flex-col gap-2 bg-gray-400 p-2">
				Time Left: {$snapshot.context.timeLeft} seconds | {getDisplayText($snapshot)}
			</div>
		{/if}
		{#if $snapshot.matches(QuizStates.IN_PROGRESS)}
			<div class="flex w-full flex-col gap-2">
				<div class="rounded-lg bg-white p-4 shadow-md">
					<h2 class="text-xl font-semibold">
						Question {$snapshot.context.currentQuestionIdx + 1}:
					</h2>
					<p class="mt-2">{$snapshot.context.currentQuestion.question}</p>
				</div>
				<div class="mt-4 grid grid-cols-2 gap-2">
					{#each $snapshot.context.currentQuestion.options as option}
						<Button
							outline
							color="green"
							class="w-full"
							onclick={() => {
								send({
									type: Commands.SUBMIT_ANSWER,
									question: $snapshot.context.currentQuestion,
									response: option
								});
							}}
						>
							{option}
						</Button>
					{/each}
				</div>
				<div class="mt-4">
					<Button
						color="blue"
						class="w-full"
						onclick={() =>
							send({
								type: Commands.SKIP
							})}
					>
						Skip to Next Question
					</Button>
				</div>
			</div>
		{/if}
	</div>

	<div class="w-1/2 rounded-lg bg-gray-100 p-4 shadow-sm">
		<h1 class="mb-4 text-3xl font-bold">FSM</h1>
		<pre class="overflow-x-auto rounded-md bg-white p-3 text-sm text-gray-800"><code
				>{contextJSON($snapshot)}</code
			></pre>
	</div>
</div>
<h1 class="mb-4 text-3xl font-bold">Responses</h1>

<div class="mx-auto flex w-full flex-row gap-2 p-5">
	<div class="flex max-h-96 w-full flex-col overflow-y-auto rounded-lg bg-gray-100 p-2 shadow-sm">
		{#each $snapshot.context.responses as response, _}
			<div class="w-full rounded-lg p-4 shadow-sm">
				<pre
					class={[
						'overflow-x-auto rounded-md p-3 text-sm ',
						response.correct ? 'bg-green-900 text-white' : 'bg-red-900 text-white'
					]}><code>{responseJSON(response)}</code></pre>
			</div>
		{/each}
	</div>
</div>
