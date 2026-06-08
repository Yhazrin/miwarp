<script lang="ts">
  import * as api from "$lib/api";
  import { getTransport } from "$lib/transport";

  interface Props {
    size?: "xs" | "sm" | "md" | "lg";
  }

  let { size = "sm" }: Props = $props();

  let avatarPath = $state<string | undefined>(undefined);
  let imgError = $state(false);

  async function load() {
    try {
      const settings = await api.getUserSettings();
      avatarPath = settings?.avatar_path;
      imgError = false;
    } catch {
      avatarPath = undefined;
    }
  }

  $effect(() => {
    load();
    const transport = getTransport();
    const unlisten = transport.listen("user-settings-changed", () => load());
    return () => {
      unlisten.then((fn) => fn());
    };
  });

  const sizeClass = $derived(
    size === "xs"
      ? "h-5 w-5"
      : size === "sm"
        ? "h-6 w-6"
        : size === "md"
          ? "h-8 w-8"
          : "h-10 w-10",
  );
  const iconClass = $derived(
    size === "xs" ? "h-3 w-3" : size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4",
  );

  function toAssetUrl(path: string | undefined): string | undefined {
    if (!path) return undefined;
    if (path.startsWith("http") || path.startsWith("data:") || path.startsWith("asset:"))
      return path;
    return "file://" + path;
  }

  const imgUrl = $derived(toAssetUrl(avatarPath));
</script>

<div
  class="flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground overflow-hidden {sizeClass}"
>
  {#if imgUrl && !imgError}
    <img
      src={imgUrl}
      alt="user avatar"
      class="h-full w-full object-cover"
      onerror={() => (imgError = true)}
    />
  {:else}
    <svg
      class={iconClass}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  {/if}
</div>
