<script lang="ts">
	import '../app.css';

	const { children } = $props();
</script>

<div class="max-w-8xl mx-auto flex min-h-screen flex-col items-center p-5">
	<h3 class="mb-4 text-2xl font-bold">Xstate + SvelteKit Example with a simple quiz app</h3>
	{@render children()}
</div>
