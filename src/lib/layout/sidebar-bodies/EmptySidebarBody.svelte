<!--
  EmptySidebarBody — placeholder shown by SidebarContentPanel while the
  route-specific body chunk is being fetched. Tiny, no deps, no layout
  shift (a single inline spinner that matches Spinner's "sm" footprint).
-->
<script lang="ts">
  // No props. Rendered by SidebarContentPanel as the in-flight fallback
  // before the matched body's chunk resolves.
</script>

<div class="flex-1" aria-hidden="true"></div>
