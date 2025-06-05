<script lang="ts">
	import '../app.css';

	const { children } = $props();
</script>

<div class="container mx-auto flex flex-col items-center p-20">
	{@render children()}
</div>
