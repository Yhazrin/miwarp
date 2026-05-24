<script lang="ts">
  import type { LinkType } from "$lib/link-detector";
  import { getIcon } from "$lib/icons";

  let { url, type = "web", label }: { url: string; type?: LinkType; label?: string } = $props();

  const TYPE_LABELS = {
    web: "Web link",
    "local-file": "Local file",
    "local-folder": "Local folder",
  };

  const TYPE_ICONS = {
    web: getIcon("globe"),
    "local-file": getIcon("fileText"),
    "local-folder": getIcon("folderOpen"),
  };

  const openIcon = getIcon("chevronRight");

  function trimMiddle(value: string, max = 58): string {
    if (value.length <= max) return value;
    const head = Math.ceil((max - 3) * 0.58);
    const tail = max - 3 - head;
    return `${value.slice(0, head)}...${value.slice(-tail)}`;
  }

  function stripLineColumnSuffix(value: string): string {
    return value.replace(/:(\d+)(?::\d+)?$/, "");
  }

  function normalizeLocalTarget(value: string): string {
    const withoutLine = stripLineColumnSuffix(value);
    if (!withoutLine.startsWith("file://")) return withoutLine;
    try {
      return decodeURIComponent(new URL(withoutLine).pathname);
    } catch {
      return withoutLine.replace(/^file:\/\/\/?/i, "/");
    }
  }

  function getOpenTarget(): string {
    if (type === "web") return url;
    return normalizeLocalTarget(url);
  }

  function getWebMeta(value: string): string {
    try {
      const parsed = new URL(value);
      const path = parsed.pathname === "/" ? "" : parsed.pathname;
      return trimMiddle(`${parsed.host}${path}${parsed.search}`, 64);
    } catch {
      return trimMiddle(value, 64);
    }
  }

  function getLocalName(value: string): string {
    const cleaned = normalizeLocalTarget(value).replace(/[\\/]+$/, "");
    const lastSlash = Math.max(cleaned.lastIndexOf("/"), cleaned.lastIndexOf("\\"));
    return lastSlash >= 0 ? cleaned.slice(lastSlash + 1) || cleaned : cleaned;
  }

  function getTitle(): string {
    const cleanLabel = label?.trim();
    if (cleanLabel && cleanLabel !== url) return trimMiddle(cleanLabel, 46);
    if (type === "web") {
      try {
        return new URL(url).hostname.replace(/^www\./, "");
      } catch {
        return trimMiddle(url, 46);
      }
    }
    return trimMiddle(getLocalName(url), 46);
  }

  function getMeta(): string {
    if (type === "web") return getWebMeta(url);
    return trimMiddle(normalizeLocalTarget(url), 68);
  }

  async function handleClick() {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(getOpenTarget());
    } catch {
      // Fallback to window.open
      window.open(getOpenTarget(), "_blank");
    }
  }
</script>

<button
  type="button"
  class="link-card group"
  onclick={handleClick}
  data-type={type}
  title={url}
  aria-label="Open {TYPE_LABELS[type]}: {url}"
>
  <div class="link-card-icon" aria-hidden="true">
    {@html TYPE_ICONS[type]}
  </div>
  <span class="link-card-content">
    <span class="link-card-title">{getTitle()}</span>
    <span class="link-card-meta">{getMeta()}</span>
  </span>
  <span class="link-card-action" aria-hidden="true">
    {@html openIcon}
  </span>
</button>

<style>
  :global(.link-card-icon svg),
  :global(.link-card-action svg) {
    width: 100%;
    height: 100%;
  }
</style>
