/** True while navigating between /chat and /settings (preserve middleware, skip cold bootstrap). */
let chatSettingsHop = false;

export function armChatSettingsHop(): void {
  chatSettingsHop = true;
}

export function isChatSettingsHop(): boolean {
  return chatSettingsHop;
}

export function disarmChatSettingsHop(): void {
  chatSettingsHop = false;
}
