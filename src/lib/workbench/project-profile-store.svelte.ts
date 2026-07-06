/**
 * ProjectProfileStore — workbench control-panel data source.
 *
 * Owns the per-project "profile" payload for the currently selected
 * workbench project:
 *   - `ProjectMetadata`     (stack detector + npm/make commands + doc excerpts)
 *   - `ProjectGitStatus`    (branch / ahead-behind / dirty count / last commit)
 *   - `ProjectNotes`        (user-edited scratchpad saved to ~/.miwarp/...)
 *
 * The workbench `+page.svelte` mounts this store once and binds `$state`
 * fields straight into the ControlPanel template. `load(cwd)` fans out the
 * three IPCs in parallel so a slow `git status` doesn't block the doc
 * excerpts (or vice versa).
 *
 * Why a singleton: the workbench route is the only consumer; multiple
 * subscribers inside the same route should share one fetch and one
 * `notesDirty` draft buffer.
 */

import * as api from "$lib/api";
import type { ProjectGitStatus, ProjectMetadata, ProjectNotes } from "$lib/types";
import { dbg } from "$lib/utils/debug";

class ProjectProfileStore {
  profile: ProjectMetadata | null = $state(null);
  gitStatus: ProjectGitStatus | null = $state(null);
  notes: string = $state("");
  notesDirty: string = $state("");
  notesModifiedAt: string | null = $state(null);
  loadingProfile: boolean = $state(false);
  loadingGit: boolean = $state(false);
  loadingNotes: boolean = $state(false);

  /** cwd of the last successful `load()`. Used to short-circuit duplicate
   *  calls and to detect a project switch (which requires `reset()` first). */
  private lastLoadedCwd: string = "";

  /** True when the local draft differs from the last-saved snapshot. */
  notesIsDirty = $derived(this.notesDirty !== this.notes);

  /**
   * Fetch profile + git + notes for `cwd` in parallel, then commit the
   * results into state in one synchronous batch.
   *
   * If `cwd` differs from the previous target, we reset first so the UI
   * never sees profile data bleed across project switches.
   */
  async load(cwd: string): Promise<void> {
    if (this.lastLoadedCwd && this.lastLoadedCwd !== cwd) {
      dbg("project-profile", "load: cwd changed, resetting", {
        from: this.lastLoadedCwd,
        to: cwd,
      });
      this.reset();
    }
    this.lastLoadedCwd = cwd;

    this.loadingProfile = true;
    this.loadingGit = true;
    this.loadingNotes = true;
    dbg("project-profile", "load: start", { cwd });

    const [profileResult, gitResult, notesResult] = await Promise.allSettled([
      api.listProjectMetadata(cwd),
      api.listProjectGitStatus(cwd),
      api.readProjectNotes(cwd),
    ]);

    // Each slot commits independently — one failed IPC must not block the
    // other two from rendering. Callers can still tell loading=true → false
    // per slot via the three `loading*` flags.
    if (profileResult.status === "fulfilled") {
      this.profile = profileResult.value;
    } else {
      dbg("project-profile", "load: profile failed", String(profileResult.reason));
      this.profile = null;
    }
    this.loadingProfile = false;

    if (gitResult.status === "fulfilled") {
      this.gitStatus = gitResult.value;
    } else {
      dbg("project-profile", "load: git failed", String(gitResult.reason));
      this.gitStatus = null;
    }
    this.loadingGit = false;

    if (notesResult.status === "fulfilled") {
      const snapshot: ProjectNotes = notesResult.value;
      this.notes = snapshot.content;
      // Adopt the saved content as the draft too — we only diverge from
      // `notes` once the user starts editing in the textarea.
      this.notesDirty = snapshot.content;
      this.notesModifiedAt = snapshot.modifiedAt;
    } else {
      dbg("project-profile", "load: notes failed", String(notesResult.reason));
      this.notes = "";
      this.notesDirty = "";
      this.notesModifiedAt = null;
    }
    this.loadingNotes = false;

    dbg("project-profile", "load: done", {
      cwd,
      hasProfile: !!this.profile,
      isGitRepo: this.gitStatus?.isGitRepo ?? false,
      notesLen: this.notes.length,
    });
  }

  /**
   * Persist `notesDirty` for `cwd` and roll the saved snapshot forward.
   * No-op when there is no cwd to write against (caller must invoke
   * `load(cwd)` first).
   */
  async saveNotes(cwd: string): Promise<void> {
    if (!cwd) return;
    dbg("project-profile", "saveNotes: start", {
      cwd,
      len: this.notesDirty.length,
    });
    await api.writeProjectNotes(cwd, this.notesDirty);
    this.notes = this.notesDirty;
    // Backend doesn't echo back the new mtime — stamp it client-side so the
    // UI can show "saved just now" without a follow-up read.
    this.notesModifiedAt = new Date().toISOString();
    dbg("project-profile", "saveNotes: done", { modifiedAt: this.notesModifiedAt });
  }

  /** Clear every field. Called on project switch and on route teardown. */
  reset(): void {
    this.profile = null;
    this.gitStatus = null;
    this.notes = "";
    this.notesDirty = "";
    this.notesModifiedAt = null;
    this.loadingProfile = false;
    this.loadingGit = false;
    this.loadingNotes = false;
    this.lastLoadedCwd = "";
  }
}

export const projectProfileStore = new ProjectProfileStore();

// Re-export the class so unit tests can instantiate a fresh store without
// touching the shared singleton.
export { ProjectProfileStore as ProjectProfileStoreClass };
