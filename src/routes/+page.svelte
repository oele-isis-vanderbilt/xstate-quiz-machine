<script lang="ts">
	import { createQuizMachine } from '$lib';
	import {
		AttemptEvents,
		Commands,
		InProgressStages,
		QuizStates,
		type QuizResponseEvent
	} from '$lib/quizMachine.types';
	import { Button, Popover } from 'flowbite-svelte';
	import { useActor } from '@xstate/svelte';
	import type { SimpleQuestion } from '$lib/types';
	import type { SnapshotFrom } from 'xstate';
	import { Confetti } from 'svelte-confetti';

	const logger = {
		debug: (message: string) => {
			const formattedMessage = `[DEBUG] - ${new Date().toISOString()}: ${message}`;
			console.debug(formattedMessage);
		},
		info: (message: string) => {
			const formattedMessage = `[INFO] - ${new Date().toISOString()}: ${message}`;
			console.info(formattedMessage);
		},
		warn: (message: string) => {
			const formattedMessage = `[WARN] - ${new Date().toISOString()}: ${message}`;
			console.warn(formattedMessage);
		},
		error: (message: string) => {
			const formattedMessage = `[ERROR] - ${new Date().toISOString()}: ${message}`;
			console.error(formattedMessage);
		}
	};

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

	const friendlyDateTime = (timestamp: number): string => {
		const date = new Date(timestamp);
		return date.toLocaleString('en-US', {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	};
	const quizMachine = createQuizMachine<SimpleQuestion, string>(
		{
			attemptDuration: 200,
			reviewDuration: 60,
			maxAttemptPerQuestion: 3,
			questions: questions,
			eventsLogger: logger,
			responseLoggerFn: (question, response) => {
				logger.info(
					`Response for question "${question.question}" recorded: ${JSON.stringify(response)}`
				);
			},
			questionIdentifierFn: (question: SimpleQuestion) => question.id,
			graderFn: (question: SimpleQuestion, response: string) => {
				return {
					correct: question.answer === response,
					payload: response,
					explanation: question.explaination
				};
			}
		},
		500
	);

	const { snapshot, send } = useActor(quizMachine);

	function contextJSON(stateSnapshot: SnapshotFrom<typeof quizMachine>): string {
		return JSON.stringify(
			{
				currentState: stateSnapshot.value,
				currentQuestionIdx: stateSnapshot.context.currentQuestionIdx,
				attemptDuration: stateSnapshot.context.attemptDuration,
				reviewDuration: stateSnapshot.context.reviewDuration,
				timeLeft: stateSnapshot.context.timeLeft,
				maxAttemptPerQuestion: stateSnapshot.context.maxAttemptPerQuestion,
				attemptCount: stateSnapshot.context.noOfAttempts,
				skippedMode: stateSnapshot.context.skippedMode,
				skipedQuestions: Array.from(stateSnapshot.context.skipedQuestions.keys()),
				regularFlowIndex: stateSnapshot.context.regularFlowQuestionIdx,
				regularFlowCompleted: stateSnapshot.context.regularFlowCompleted
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

	function responseJSON(event: QuizResponseEvent<SimpleQuestion, string>): string {
		return JSON.stringify(
			{
				event: event.type,
				timestamp: friendlyDateTime(event.timestamp),
				question: event.question.question,
				response: event.response?.payload,
				correct: event.response?.correct,
				timespent: event.timeSpentSeconds
			},
			null,
			2
		);
	}

	let timerText = $derived.by(() => {
		const timeLeft = $snapshot.context.timeLeft;
		if (timeLeft <= 0) {
			return 'Time is up!';
		}
		const minutes = Math.floor(timeLeft / 60);
		const seconds = timeLeft % 60;
		return `${minutes}m ${seconds}s`;
	});

	let selectedOptions = $state<string[]>([]);

	function isOptionSelected(option: string): boolean {
		return selectedOptions.includes(option);
	}

	function isGrading(): boolean {
		return $snapshot.matches({ [QuizStates.IN_PROGRESS]: InProgressStages.GRADING });
	}

	function isSkipping(): boolean {
		return $snapshot.matches({ [QuizStates.IN_PROGRESS]: InProgressStages.SKIPPING });
	}

	function canForceReview(): boolean {
		return $snapshot.context.regularFlowCompleted;
	}

	function isCorrectSelection(option: string): boolean {
		return !!(
			isGrading() &&
			$snapshot.context.events.at(-1)?.response?.correct &&
			$snapshot.context.currentQuestion.answer === option
		);
	}

	let isPopOverOpen = $state(false);

	$effect(() => {
		if (isSkipping() && isPopOverOpen === false) {
			isPopOverOpen = true;
		}
	});
</script>

<div class="mx-auto flex w-full flex-row gap-2 p-5">
	<div class="flex h-full w-1/2 flex-col rounded-lg bg-gray-100 p-2 shadow-sm">
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
		{#if $snapshot.matches(QuizStates.REVIEWING) || $snapshot.matches(QuizStates.IN_PROGRESS)}
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
					{#each $snapshot.context.currentQuestion.options as option, index (index)}
						<Button
							outline={isOptionSelected(option) ? false : true}
							color={isOptionSelected(option) && !isCorrectSelection(option) ? 'red' : 'green'}
							class={['w-full']}
							disabled={isGrading() || isSkipping() || isOptionSelected(option)}
							onclick={() => {
								selectedOptions = [...selectedOptions, option];
								send({
									type: Commands.SUBMIT_ANSWER,
									question: $snapshot.context.currentQuestion,
									response: option
								});
							}}
						>
							{#if isCorrectSelection(option)}
								<Confetti />
							{/if}
							{option}
						</Button>
					{/each}
				</div>
				<div class="mt-4">
					<Button
						disabled={isSkipping() || isGrading()}
						color="blue"
						id="skip-button"
						class="w-full"
						onclick={() =>
							send({
								type: Commands.SKIP
							})}
					>
						Skip to Next Question
					</Button>
					<Popover
						triggeredBy="#skip-button"
						trigger="click"
						title="Skip to the Next Question"
						placement="top"
						bind:isOpen={isPopOverOpen}
					>
						<div class="ms-3 text-sm font-normal">
							<Button
								size="xs"
								onclick={() => {
									send({
										type: Commands.CONFIRM_SKIP
									});
									isPopOverOpen = false;
								}}>Yes</Button
							>
							<Button
								size="xs"
								onclick={() => {
									send({
										type: Commands.REJECT_SKIP
									});
									isPopOverOpen = false;
								}}>No</Button
							>
						</div>
					</Popover>
				</div>
				{#if canForceReview()}
					<div class="mt-2">
						<Button
							disabled={isSkipping() || isGrading()}
							color="blue"
							id="skip-button"
							class="w-full"
							onclick={() =>
								send({
									type: Commands.FORCE_REVIEW
								})}
						>
							To Go Review
						</Button>
					</div>
				{/if}
			</div>
		{/if}
		{#if $snapshot.matches(QuizStates.REVIEWING)}
			<pre class="overflow-x-auto rounded-md bg-white p-3 text-sm text-gray-800"><code
					>{JSON.stringify($snapshot.context.stageSummaries, null, 2)}</code
				></pre>
		{/if}
	</div>
	<div class="flex w-1/2 flex-col rounded-lg bg-gray-100 p-2 shadow-sm">
		<h1 class="mb-4 text-3xl font-bold">Timer</h1>
		<!-- Huge Timer in between -->
		<div class="flex h-full items-center justify-center text-6xl font-bold">
			{#if $snapshot.matches(QuizStates.IN_PROGRESS)}
				{timerText}
			{:else if $snapshot.matches(QuizStates.REVIEWING)}
				{timerText}
			{:else if $snapshot.matches(QuizStates.COMPLETED)}
				Quiz Completed!
			{:else}
				Waiting to start...
			{/if}
		</div>
	</div>
</div>

<div class="mx-auto flex h-1/2 w-full flex-row items-stretch gap-2 p-5">
	<div class="w-1/3 rounded-lg bg-gray-100 p-4 shadow-sm">
		<h1 class="mb-4 text-3xl font-bold">FSM</h1>
		<pre class="overflow-x-auto rounded-md bg-white p-3 text-sm text-gray-800"><code
				>{contextJSON($snapshot)}</code
			></pre>
	</div>
	<div class="flex max-h-96 w-1/3 flex-col rounded-lg bg-gray-100 p-2 shadow-sm">
		<h1 class="mb-4 text-3xl font-bold">Responses</h1>
		<div class="flex-1 overflow-y-auto">
			{#each $snapshot.context.events.toSorted((a, b) => b.timestamp - a.timestamp) as event, index (index)}
				<div class="w-full rounded-lg p-4 shadow-sm">
					<pre
						class={[
							'overflow-x-auto rounded-md p-3 text-sm',
							event.type === AttemptEvents.SKIP && 'bg-gray-700 text-white',
							event.response?.correct && 'bg-green-900 text-white',
							event.response && event.response.correct === false && 'bg-red-900 text-white'
						]}><code>{responseJSON(event)}</code></pre>
				</div>
			{/each}
		</div>
	</div>
	<div class="flex max-h-96 w-1/3 flex-col rounded-lg bg-gray-100 p-2 shadow-sm">
		<h1 class="mb-4 text-3xl font-bold">Skipped Problems</h1>
		<div class="flex-1 overflow-y-auto">
			{#if $snapshot.context.skipedQuestions.size === 0}
				<div class="rounded-lg bg-white p-4 shadow-sm">
					<p class="text-sm text-gray-500">No problems skipped yet</p>
				</div>
			{:else}
				{#each Array.from($snapshot.context.skipedQuestions.entries()) as [questionId, question] (questionId)}
					<div class="mb-2 rounded-lg bg-white p-4 shadow-sm">
						<div class="mb-2">
							<span class="text-xs font-semibold text-gray-600">ID: {questionId}</span>
						</div>
						<p class="text-sm font-medium text-gray-800">{question.question}</p>
						<div class="mt-2 grid grid-cols-2 gap-1">
							{#each question.options as option}
								<div class="rounded border bg-gray-100 p-1 text-xs">
									{option}
								</div>
							{/each}
						</div>
						<button
							class="mt-2 text-sm text-blue-500 underline hover:text-blue-700"
							onclick={() =>
								send({
									type: Commands.GOTO_SKIPPED,
									skippedQuestionId: questionId
								})}
						>
							Go to Problem
						</button>
					</div>
				{/each}
			{/if}
		</div>
	</div>
</div>
