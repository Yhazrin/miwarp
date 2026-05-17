<script lang="ts">
  import { onMount } from "svelte";
  import * as api from "$lib/api";
  import type { UserSettings, RemoteHost, RemoteTestResult, SshKeyInfo } from "$lib/types";
  import Card from "$lib/components/Card.svelte";
  import Button from "$lib/components/Button.svelte";
  import { t } from "$lib/i18n/index.svelte";
  import { dbg, dbgWarn } from "$lib/utils/debug";
  import { splitPath } from "$lib/utils/format";
  import { IS_WINDOWS } from "$lib/utils/platform";

  let {
    initialHosts = [],
    onHostsChange,
  }: {
    initialHosts?: RemoteHost[];
    onHostsChange?: (hosts: RemoteHost[]) => void;
  } = $props();

  // ── Remote host state ──
  let remoteHosts = $state<RemoteHost[]>(initialHosts);
  let editingRemote = $state<RemoteHost | null>(null);
  let remoteFormName = $state("");
  let remoteFormHost = $state("");
  let remoteFormUser = $state("");
  let remoteFormPort = $state(22);
  let remoteFormKeyPath = $state("");
  let remoteFormRemoteCwd = $state("");
  let remoteFormClaudePath = $state("");
  let remoteFormForwardKey = $state(false);
  let remoteTesting = $state(false);
  let remoteTestResult = $state<RemoteTestResult | null>(null);
  let remoteSaving = $state(false);
  let remoteSaved = $state(false);
  let remoteFormTouched = $state(false);
  let currentUsername = $state("");

  // ── SSH Key wizard state ──
  type SshKeyStep =
    | "idle"
    | "checking"
    | "no_key"
    | "has_key"
    | "pub_missing"
    | "generating"
    | "done"
    | "error";
  let sshKeyStep = $state<SshKeyStep>("idle");
  let sshKeyInfo = $state<SshKeyInfo | null>(null);
  let sshKeyError = $state("");
  let sshCopied = $state(false);
  let sshVerifying = $state(false);
  let wizardKeyPath = $derived(sshKeyInfo?.key_path ?? "");

  function notifyChange() {
    onHostsChange?.(remoteHosts);
  }

  function shellQuote(s: string): string {
    return "'" + s.replace(/'/g, "'\\''") + "'";
  }

  function pwshQuote(s: string): string {
    return "'" + s.replace(/'/g, "''") + "'";
  }

  onMount(async () => {
    // Detect current username for form placeholders
    try {
      const p = await import("@tauri-apps/api/path");
      const home = await p.homeDir();
      const parts = splitPath(home.replace(/[/\\]+$/, ""));
      currentUsername = parts[parts.length - 1] || "";
    } catch {
      // ignore
    }

    // Load remote hosts from settings
    try {
      const settings = await api.getUserSettings();
      remoteHosts = settings.remote_hosts ?? [];
      notifyChange();
    } catch (e) {
      dbgWarn("settings", "failed to load remote hosts", e);
    }
  });

  function resetRemoteForm() {
    editingRemote = null;
    remoteFormName = "";
    remoteFormHost = "";
    remoteFormUser = "";
    remoteFormPort = 22;
    remoteFormKeyPath = "";
    remoteFormRemoteCwd = "";
    remoteFormClaudePath = "";
    remoteFormForwardKey = false;
    remoteTestResult = null;
    remoteFormTouched = false;
  }

  function editRemoteHost(host: RemoteHost) {
    editingRemote = host;
    remoteFormName = host.name;
    remoteFormHost = host.host;
    remoteFormUser = host.user;
    remoteFormPort = host.port;
    remoteFormKeyPath = host.key_path ?? "";
    remoteFormRemoteCwd = host.remote_cwd ?? "";
    remoteFormClaudePath = host.remote_claude_path ?? "";
    remoteFormForwardKey = host.forward_api_key;
    remoteTestResult = null;
  }

  async function saveRemoteHost(keepForm = false) {
    if (!remoteFormName.trim() || !remoteFormHost.trim() || !remoteFormUser.trim()) {
      remoteFormTouched = true;
      return;
    }
    remoteSaving = true;
    try {
      const newHost: RemoteHost = {
        name: remoteFormName.trim(),
        host: remoteFormHost.trim(),
        user: remoteFormUser.trim(),
        port: remoteFormPort || 22,
        key_path: remoteFormKeyPath.trim() || undefined,
        remote_cwd: remoteFormRemoteCwd.trim() || undefined,
        remote_claude_path: remoteFormClaudePath.trim() || undefined,
        forward_api_key: remoteFormForwardKey,
      };

      const updated = editingRemote
        ? remoteHosts.map((h) => (h.name === editingRemote!.name ? newHost : h))
        : [...remoteHosts, newHost];

      await api.updateUserSettings({ remote_hosts: updated } as Partial<UserSettings>);
      remoteHosts = updated;
      notifyChange();
      if (keepForm) {
        // Switch to edit mode so subsequent saves update instead of duplicate
        editingRemote = newHost;
      } else {
        resetRemoteForm();
      }
      remoteSaved = true;
      setTimeout(() => (remoteSaved = false), 2000);
      dbg("settings", "remote host saved", newHost.name);
    } catch (e) {
      dbgWarn("settings", "save remote host failed", e);
    } finally {
      remoteSaving = false;
    }
  }

  async function deleteRemoteHost(name: string) {
    const updated = remoteHosts.filter((h) => h.name !== name);
    try {
      await api.updateUserSettings({ remote_hosts: updated } as Partial<UserSettings>);
      remoteHosts = updated;
      notifyChange();
      if (editingRemote?.name === name) resetRemoteForm();
      dbg("settings", "remote host deleted", name);
    } catch (e) {
      dbgWarn("settings", "delete remote host failed", e);
    }
  }

  async function testRemoteConnection() {
    if (!remoteFormHost.trim() || !remoteFormUser.trim()) {
      remoteFormTouched = true;
      return;
    }
    remoteTesting = true;
    remoteTestResult = null;
    try {
      remoteTestResult = await api.testRemoteHost(
        remoteFormHost.trim(),
        remoteFormUser.trim(),
        remoteFormPort || undefined,
        remoteFormKeyPath.trim() || undefined,
        remoteFormClaudePath.trim() || undefined,
      );
      dbg("settings", "remote test result", remoteTestResult);
      // Auto-save on successful SSH connection (keep form visible for user to review)
      if (remoteTestResult.ssh_ok && remoteFormName && remoteFormHost && remoteFormUser) {
        await saveRemoteHost(true);
      }
    } catch (e) {
      remoteTestResult = { ssh_ok: false, cli_found: false, error: String(e) };
      dbgWarn("settings", "remote test error", e);
    } finally {
      remoteTesting = false;
    }
  }

  function buildCopyCommand(keyInfo: SshKeyInfo, host: string, user: string, port: number): string {
    if (IS_WINDOWS) {
      const pubPath = pwshQuote(keyInfo.key_path_expanded + ".pub");
      const target = pwshQuote(`${user}@${host}`);
      const remoteScript = pwshQuote(
        "mkdir -p ~/.ssh && chmod 700 ~/.ssh && " +
          "touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && " +
          'key=$(cat) && (grep -qxF "$key" ~/.ssh/authorized_keys 2>/dev/null || ' +
          'echo "$key" >> ~/.ssh/authorized_keys)',
      );
      return `Get-Content -LiteralPath ${pubPath} -Raw | ssh -p ${port} ${target} ${remoteScript}`;
    }
    const keyArg = shellQuote(keyInfo.key_path_expanded);
    const pubArg = shellQuote(keyInfo.key_path_expanded + ".pub");
    const target = `${shellQuote(user)}@${shellQuote(host)}`;

    if (keyInfo.ssh_copy_id_available) {
      return `ssh-copy-id -i ${keyArg} -p ${port} ${target}`;
    }
    const remoteScript =
      "mkdir -p ~/.ssh && chmod 700 ~/.ssh && " +
      "touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && " +
      'key=$(cat) && (grep -qxF "$key" ~/.ssh/authorized_keys 2>/dev/null || ' +
      'echo "$key" >> ~/.ssh/authorized_keys)';
    return `cat ${pubArg} | ssh -p ${port} ${target} ${shellQuote(remoteScript)}`;
  }

  function buildRebuildPubKeyCommand(keyInfo: SshKeyInfo): string {
    if (IS_WINDOWS) {
      const keyPath = pwshQuote(keyInfo.key_path_expanded);
      const pubPath = pwshQuote(keyInfo.key_path_expanded + ".pub");
      return `ssh-keygen -y -f ${keyPath} | Out-File -Encoding ascii ${pubPath}`;
    }
    const keyArg = shellQuote(keyInfo.key_path_expanded);
    return `ssh-keygen -y -f ${keyArg} > ${shellQuote(keyInfo.key_path_expanded + ".pub")}`;
  }

  async function startSshKeyWizard() {
    sshKeyStep = "checking";
    sshKeyError = "";
    sshCopied = false;
    try {
      const info = await api.checkSshKey();
      sshKeyInfo = info;
      dbg("settings", "ssh key check", info);
      if (info.exists && info.pub_exists) {
        sshKeyStep = "has_key";
      } else if (info.exists && !info.pub_exists) {
        sshKeyStep = "pub_missing";
      } else {
        sshKeyStep = "no_key";
      }
    } catch (e) {
      sshKeyError = String(e);
      sshKeyStep = "error";
      dbgWarn("settings", "ssh key check failed", e);
    }
  }

  async function generateSshKey() {
    sshKeyStep = "generating";
    sshKeyError = "";
    try {
      const info = await api.generateSshKey();
      sshKeyInfo = info;
      sshKeyStep = "has_key";
      dbg("settings", "ssh key generated", info);
    } catch (e) {
      sshKeyError = String(e);
      sshKeyStep = "error";
      dbgWarn("settings", "ssh key generation failed", e);
    }
  }

  async function verifySshConnection() {
    if (!sshKeyInfo || !remoteFormHost || !remoteFormUser) return;
    sshVerifying = true;
    try {
      const result = await api.testRemoteHost(
        remoteFormHost.trim(),
        remoteFormUser.trim(),
        remoteFormPort || undefined,
        wizardKeyPath || undefined,
        remoteFormClaudePath.trim() || undefined,
      );
      dbg("settings", "ssh verify result", result);
      if (result.ssh_ok) {
        remoteFormKeyPath = wizardKeyPath;
        sshKeyStep = "done";
      } else {
        sshKeyError = result.error ?? "";
        sshKeyStep = "has_key"; // stay on has_key so user can retry
      }
      remoteTestResult = result;
    } catch (e) {
      sshKeyError = String(e);
      dbgWarn("settings", "ssh verify failed", e);
    } finally {
      sshVerifying = false;
    }
  }

  function closeSshWizard() {
    sshKeyStep = "idle";
    sshKeyError = "";
    sshCopied = false;
    sshVerifying = false;
  }
</script>

<Card class="p-6 space-y-5">
  <div class="flex items-start justify-between">
    <div>
      <p class="text-sm font-medium">{t("settings_remote_title")}</p>
      <p class="text-xs text-muted-foreground mt-0.5">
        {t("settings_remote_desc")}
      </p>
    </div>
    {#if remoteSaved}
      <span class="text-xs text-emerald-500 flex items-center gap-1 animate-fade-in">
        <svg
          class="h-3 w-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg
        >
        {t("settings_general_saved")}
      </span>
    {/if}
  </div>

  <!-- Existing hosts list -->
  {#if remoteHosts.length > 0}
    <div class="space-y-2">
      {#each remoteHosts as host (host.name)}
        <div
          class="flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-border"
        >
          <div>
            <p class="text-sm font-medium">{host.name}</p>
            <p class="text-xs text-muted-foreground">
              {host.user}@{host.host}{host.port !== 22 ? `:${host.port}` : ""}
            </p>
            {#if host.remote_cwd}
              <p class="text-xs text-muted-foreground">cwd: {host.remote_cwd}</p>
            {/if}
          </div>
          <div class="flex gap-2">
            <button
              class="text-xs px-2 py-1 rounded hover:bg-accent text-muted-foreground"
              onclick={() => editRemoteHost(host)}>{t("settings_remote_edit")}</button
            >
            <button
              class="text-xs px-2 py-1 rounded hover:bg-destructive/10 text-destructive"
              onclick={() => deleteRemoteHost(host.name)}>{t("settings_remote_delete")}</button
            >
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <p class="text-xs text-muted-foreground italic">{t("settings_remote_noHosts")}</p>
  {/if}

  <!-- Add / Edit form -->
  <div class="border border-border rounded-lg p-4 space-y-3">
    <p class="text-sm font-medium">
      {editingRemote
        ? t("settings_remote_editHost", { name: editingRemote.name })
        : t("settings_remote_addHost")}
    </p>

    <div class="grid grid-cols-2 gap-3">
      <label class="block">
        <span class="text-xs text-muted-foreground block mb-1">{t("settings_remote_name")} *</span>
        <input
          type="text"
          bind:value={remoteFormName}
          placeholder="mac-mini"
          class="w-full text-sm px-2 py-1.5 rounded border bg-background {remoteFormTouched &&
          !remoteFormName.trim()
            ? 'border-red-500'
            : 'border-input'}"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground block mb-1">{t("settings_remote_host")} *</span>
        <input
          type="text"
          bind:value={remoteFormHost}
          placeholder="macmini.local"
          class="w-full text-sm px-2 py-1.5 rounded border bg-background {remoteFormTouched &&
          !remoteFormHost.trim()
            ? 'border-red-500'
            : 'border-input'}"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground block mb-1">{t("settings_remote_user")} *</span>
        <input
          type="text"
          bind:value={remoteFormUser}
          placeholder={currentUsername || "username"}
          class="w-full text-sm px-2 py-1.5 rounded border bg-background {remoteFormTouched &&
          !remoteFormUser.trim()
            ? 'border-red-500'
            : 'border-input'}"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground block mb-1">{t("settings_remote_port")}</span>
        <input
          type="number"
          bind:value={remoteFormPort}
          placeholder="22"
          class="w-full text-sm px-2 py-1.5 rounded border border-input bg-background"
        />
      </label>
      <div class="col-span-2">
        <span class="text-xs text-muted-foreground block mb-1">{t("settings_remote_keyPath")}</span>
        <div class="flex gap-2">
          <input
            type="text"
            aria-label={t("settings_remote_keyPath")}
            bind:value={remoteFormKeyPath}
            placeholder="~/.ssh/id_ed25519"
            class="flex-1 text-sm px-2 py-1.5 rounded border border-input bg-background"
          />
          {#if sshKeyStep === "idle"}
            <button
              class="shrink-0 text-xs px-2 py-1.5 rounded border border-input hover:bg-accent transition-colors text-muted-foreground"
              onclick={startSshKeyWizard}
            >
              {t("settings_remote_setupSshKey")}
            </button>
          {/if}
        </div>

        <!-- SSH Key Wizard inline panel -->
        {#if sshKeyStep !== "idle"}
          <div class="mt-2 rounded-lg border border-border p-3 space-y-2 text-xs bg-muted/30">
            {#if sshKeyStep === "checking"}
              <div class="flex items-center gap-2 text-muted-foreground">
                <div
                  class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent"
                ></div>
                {t("settings_remote_sshKeyChecking")}
              </div>
            {:else if sshKeyStep === "no_key"}
              <p class="text-muted-foreground">{t("settings_remote_sshKeyNotFound")}</p>
              <button
                class="rounded border px-3 py-1.5 text-xs hover:bg-accent transition-colors"
                onclick={generateSshKey}
              >
                {t("settings_remote_sshKeyGenerate")}
              </button>
            {:else if sshKeyStep === "generating"}
              <div class="flex items-center gap-2 text-muted-foreground">
                <div
                  class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent"
                ></div>
                {t("settings_remote_sshKeyGenerating")}
              </div>
            {:else if sshKeyStep === "pub_missing" && sshKeyInfo}
              <p class="text-amber-400">
                {t(
                  IS_WINDOWS
                    ? "settings_remote_sshKeyPubMissing_win"
                    : "settings_remote_sshKeyPubMissing",
                )}
              </p>
              <div class="flex items-center gap-2">
                <code
                  class="flex-1 rounded bg-muted px-2 py-1.5 font-mono text-[11px] break-all select-all"
                >
                  {buildRebuildPubKeyCommand(sshKeyInfo)}
                </code>
                <button
                  class="shrink-0 rounded border px-2 py-1 text-[10px] hover:bg-accent transition-colors"
                  onclick={async () => {
                    await navigator.clipboard.writeText(buildRebuildPubKeyCommand(sshKeyInfo!));
                    sshCopied = true;
                    setTimeout(() => (sshCopied = false), 2000);
                  }}
                >
                  {sshCopied ? t("settings_remote_sshKeyCopied") : t("common_copy")}
                </button>
              </div>
              <p class="text-muted-foreground text-[10px]">
                After running the command, click "Setup SSH Key" again.
              </p>
              <button
                class="text-[10px] text-muted-foreground hover:underline"
                onclick={closeSshWizard}
              >
                {t("settings_remote_sshKeyClose")}
              </button>
            {:else if sshKeyStep === "has_key" && sshKeyInfo}
              <p class="text-emerald-500">
                {t("settings_remote_sshKeyFound", { keyType: sshKeyInfo.key_type })}
                <span class="text-muted-foreground ml-1 font-mono">{sshKeyInfo.key_path}</span>
              </p>

              {#if remoteFormHost && remoteFormUser}
                <p class="text-muted-foreground">
                  {t(
                    IS_WINDOWS
                      ? "settings_remote_sshKeyCopyCmd_win"
                      : "settings_remote_sshKeyCopyCmd",
                  )}
                </p>
                <div class="flex items-center gap-2">
                  <code
                    class="flex-1 rounded bg-muted px-2 py-1.5 font-mono text-[11px] break-all select-all"
                  >
                    {buildCopyCommand(
                      sshKeyInfo,
                      remoteFormHost.trim(),
                      remoteFormUser.trim(),
                      remoteFormPort || 22,
                    )}
                  </code>
                  <button
                    class="shrink-0 rounded border px-2 py-1 text-[10px] hover:bg-accent transition-colors"
                    onclick={async () => {
                      await navigator.clipboard.writeText(
                        buildCopyCommand(
                          sshKeyInfo!,
                          remoteFormHost.trim(),
                          remoteFormUser.trim(),
                          remoteFormPort || 22,
                        ),
                      );
                      sshCopied = true;
                      setTimeout(() => (sshCopied = false), 2000);
                    }}
                  >
                    {sshCopied ? t("settings_remote_sshKeyCopied") : t("common_copy")}
                  </button>
                </div>

                <div class="flex items-center gap-2 mt-1">
                  <button
                    class="rounded border px-3 py-1.5 text-xs hover:bg-accent transition-colors"
                    disabled={sshVerifying}
                    onclick={verifySshConnection}
                  >
                    {sshVerifying
                      ? t("settings_remote_sshKeyVerifying")
                      : t("settings_remote_sshKeyVerify")}
                  </button>
                  <button
                    class="text-[10px] text-muted-foreground hover:underline"
                    onclick={closeSshWizard}
                  >
                    {t("settings_remote_sshKeyClose")}
                  </button>
                </div>

                {#if sshKeyError && sshKeyStep === "has_key"}
                  <p class="text-red-400 text-[11px]">
                    {t(
                      IS_WINDOWS
                        ? "settings_remote_sshKeyFailed_win"
                        : "settings_remote_sshKeyFailed",
                    )}
                  </p>
                {/if}
              {:else}
                <p class="text-muted-foreground text-[10px]">
                  Fill in Host and User above, then come back to copy the install command.
                </p>
                <button
                  class="text-[10px] text-muted-foreground hover:underline"
                  onclick={closeSshWizard}
                >
                  {t("settings_remote_sshKeyClose")}
                </button>
              {/if}
            {:else if sshKeyStep === "done"}
              <p class="text-emerald-500">{t("settings_remote_sshKeySuccess")}</p>
              <button
                class="text-[10px] text-muted-foreground hover:underline"
                onclick={closeSshWizard}
              >
                {t("settings_remote_sshKeyClose")}
              </button>
            {:else if sshKeyStep === "error"}
              <p class="text-red-400">
                {t("settings_remote_sshKeyGenError", { error: sshKeyError })}
              </p>
              <button
                class="text-[10px] text-muted-foreground hover:underline"
                onclick={closeSshWizard}
              >
                {t("settings_remote_sshKeyClose")}
              </button>
            {/if}
          </div>
        {/if}
      </div>
      <label class="block">
        <span class="text-xs text-muted-foreground block mb-1"
          >{t("settings_remote_remoteCwd")}</span
        >
        <input
          type="text"
          bind:value={remoteFormRemoteCwd}
          placeholder={currentUsername ? "~/projects" : "~/projects"}
          class="w-full text-sm px-2 py-1.5 rounded border border-input bg-background"
        />
      </label>
      <label class="block">
        <span class="text-xs text-muted-foreground block mb-1"
          >{t("settings_remote_claudePath")}</span
        >
        <input
          type="text"
          bind:value={remoteFormClaudePath}
          placeholder="claude (default)"
          class="w-full text-sm px-2 py-1.5 rounded border border-input bg-background"
        />
      </label>
      <div class="flex items-end">
        <label class="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" bind:checked={remoteFormForwardKey} class="rounded" />
          {t("settings_remote_forwardKey")}
        </label>
      </div>
    </div>

    {#if remoteFormForwardKey}
      <div
        class="flex items-start gap-2 p-2 rounded bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-600 dark:text-yellow-400"
      >
        <span class="shrink-0 mt-0.5">&#9888;</span>
        <span>{t("settings_remote_forwardKeyWarning")}</span>
      </div>
    {/if}

    <!-- Test + Save buttons -->
    <div class="flex gap-2 items-center">
      <Button variant="secondary" size="sm" disabled={remoteTesting} onclick={testRemoteConnection}>
        {remoteTesting ? t("settings_remote_testing") : t("settings_remote_testConnection")}
      </Button>
      <Button size="sm" disabled={remoteSaving} onclick={() => saveRemoteHost()}>
        {remoteSaving
          ? t("settings_remote_saving")
          : editingRemote
            ? t("settings_remote_update")
            : t("settings_remote_add")}
      </Button>
      {#if editingRemote}
        <button class="text-xs text-muted-foreground hover:underline" onclick={resetRemoteForm}
          >{t("settings_remote_cancel")}</button
        >
      {/if}
    </div>

    <!-- Test result -->
    {#if remoteTestResult}
      <div
        class="text-xs space-y-1 p-2 rounded border {remoteTestResult.ssh_ok
          ? 'border-green-500/30 bg-green-500/5'
          : 'border-red-500/30 bg-red-500/5'}"
      >
        <p>
          {t("settings_remote_sshLabel")}
          {remoteTestResult.ssh_ok ? t("settings_remote_connected") : t("settings_remote_failed")}
        </p>
        {#if remoteTestResult.ssh_ok}
          <p>
            {t("settings_remote_cliLabel")}
            {remoteTestResult.cli_found
              ? t("settings_remote_found")
              : t("settings_remote_notFound")}
          </p>
          {#if remoteTestResult.cli_version}
            <p>
              {t("settings_remote_version", { version: remoteTestResult.cli_version })}
            </p>
          {/if}
          {#if remoteTestResult.cli_path}
            <p>{t("settings_remote_path", { path: remoteTestResult.cli_path })}</p>
          {/if}
          {#if remoteTestResult.ssh_ok && !remoteTestResult.cli_found}
            <div class="mt-1.5 p-2 rounded bg-amber-500/10 border border-amber-500/20 space-y-1">
              <p class="text-amber-400">{t("settings_remote_cliNotFoundHint")}</p>
              <code class="block rounded bg-muted px-2 py-1 font-mono text-[11px] select-all"
                >which claude</code
              >
              <p class="text-muted-foreground">{t("settings_remote_cliNotFoundHint2")}</p>
            </div>
          {/if}
        {/if}
        {#if remoteTestResult.error}
          <p class="text-red-500">{remoteTestResult.error}</p>
        {/if}
      </div>
    {/if}
  </div>
</Card>
