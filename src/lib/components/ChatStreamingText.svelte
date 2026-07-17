<script lang="ts">
  import AgentIdentity from "./AgentIdentity.svelte";
  import MarkdownContent from "./MarkdownContent.svelte";

  interface Props {
    text: string;
    agent: string;
    platformId?: string;
    model: string;
  }

  let { text, agent, platformId, model }: Props = $props();
</script>

<!-- Match ChatMessage assistant shell so live streaming does not jump on complete. -->
<div class="w-full">
  <div class="w-full pl-[3.75rem] pr-8 py-4">
    <div class="mb-1.5 flex items-center gap-2">
      <AgentIdentity
        {agent}
        {platformId}
        {model}
        size="md"
        animated={true}
        showName={true}
        showModel={false}
      />
    </div>
    <div class="max-w-64rem min-w-0 text-sm leading-relaxed text-foreground">
      <div class="prose-chat">
        <MarkdownContent {text} streaming={true} lazy={false} />
      </div>
    </div>
  </div>
</div>
