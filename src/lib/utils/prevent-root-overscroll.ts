function isScrollable(el: HTMLElement | null): boolean {
  while (el && el !== document.body && el !== document.documentElement) {
    const style = getComputedStyle(el);
    const canScrollY = /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight;
    const canScrollX = /(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth;

    if (canScrollY || canScrollX) return true;
    el = el.parentElement;
  }
  return false;
}

export function installPreventRootOverscroll() {
  const wheelHandler = (event: WheelEvent) => {
    const target = event.target as HTMLElement | null;

    if (!isScrollable(target)) {
      event.preventDefault();
    }
  };

  // iOS rubber-band overscroll prevention
  const touchHandler = (event: TouchEvent) => {
    const target = event.target as HTMLElement | null;

    if (!isScrollable(target)) {
      event.preventDefault();
    }
  };

  window.addEventListener("wheel", wheelHandler, { passive: false });
  window.addEventListener("touchmove", touchHandler, { passive: false });

  return () => {
    window.removeEventListener("wheel", wheelHandler);
    window.removeEventListener("touchmove", touchHandler);
  };
}
