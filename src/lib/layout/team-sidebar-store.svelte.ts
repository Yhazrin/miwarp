/**
 * team-sidebar-store — owns the sidebar-facing teams panel state: the
 * search query + the derived filtered list of teams.
 *
 * The original +layout.svelte inlined `runSearchQuery` / `teamStoreSearchQuery`
 * / `filteredTeams` alongside runs / folders state that has nothing to do
 * with the teams panel. Pulling the teams-related pieces into a single
 * rune store keeps the derivation co-located with the query.
 *
 * Behaviour-equivalence contract (refactor — no functional change):
 *   - Case-insensitive substring match on team name OR description
 *   - Empty / whitespace-only query → return the full list unchanged
 *
 * The actual TeamStore (from $lib/stores/team-store.svelte) is owned by
 * the layout via context (chat + /teams page share the same instance).
 * This store only owns the search projection.
 */
import type { TeamStore } from "$lib/stores/team-store.svelte";

class TeamSidebarStore {
  teamStoreSearchQuery = $state<string>("");

  /**
   * Project the team store's team list through the search query.
   * Pure derivation — the layout can call this from a `$derived`.
   */
  filteredTeams(teamStore: Pick<TeamStore, "teams">): TeamStore["teams"] {
    const q = this.teamStoreSearchQuery.trim();
    if (!q) return teamStore.teams;
    const needle = q.toLowerCase();
    return teamStore.teams.filter(
      (team) =>
        team.name.toLowerCase().includes(needle) ||
        (team.description?.toLowerCase().includes(needle) ?? false),
    );
  }
}

/** Singleton instance for the layout. */
export const teamSidebarStore = new TeamSidebarStore();
