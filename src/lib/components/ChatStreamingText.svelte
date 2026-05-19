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

<div class="w-full animate-fade-in">
  <div class="chat-content-width py-4">
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
    <div class="pl-7 prose-chat">
      <MarkdownContent {text} streaming={true} />
    </div>
  </div>
</div>
