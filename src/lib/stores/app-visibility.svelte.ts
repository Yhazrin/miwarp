function createVisibilityStore() {
  let isFocused = $state(true);
  let isVisible = $state(true);

  function sync() {
    isVisible = document.visibilityState === "visible";
  }

  function onFocus() {
    isFocused = true;
    sync();
  }
  function onBlur() {
    isFocused = false;
  }
  function onVisibility() {
    sync();
    if (document.visibilityState === "visible") isFocused = true;
  }

  if (typeof document !== "undefined") {
    // Initialize from current state
    sync();
    isFocused = document.hasFocus();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
  }

  return {
    get isAppFocused() {
      return isFocused;
    },
    get isDocumentVisible() {
      return isVisible;
    },
  };
}

export const appVisibility = createVisibilityStore();
