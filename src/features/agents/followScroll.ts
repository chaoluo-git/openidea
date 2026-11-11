/** One animation follows a moving bottom target instead of restarting on every streamed chunk. */
export function createFollowScroll(el: HTMLElement) {
  const view = el.ownerDocument.defaultView!;
  const motion = view.matchMedia("(prefers-reduced-motion: reduce)");
  let frame: number | null = null;
  let previous: number | null = null;
  let written: number | null = null;
  const write = (top: number) => {
    el.scrollTop = top;
    written = el.scrollTop;
  };
  const cancel = () => {
    if (frame !== null) view.cancelAnimationFrame(frame);
    frame = null;
    previous = null;
    written = null;
  };
  const step = (now: number) => {
    const bottom = Math.max(0, el.scrollHeight - el.clientHeight);
    const distance = bottom - el.scrollTop;
    if (motion.matches || Math.abs(distance) < 0.5) {
      write(bottom);
      frame = null;
      previous = null;
      return;
    }
    const elapsed = previous === null ? 1000 / 60 : Math.min(64, Math.max(0, now - previous));
    previous = now;
    const delta = Math.max(1, Math.abs(distance) * (1 - Math.exp(-elapsed / 65)));
    write(el.scrollTop + Math.sign(distance) * Math.min(Math.abs(distance), delta));
    frame = view.requestAnimationFrame(step);
  };
  const follow = (animate: boolean) => {
    if (!animate || motion.matches) {
      cancel();
      write(el.scrollHeight);
    } else if (frame === null) {
      previous = view.performance.now();
      frame = view.requestAnimationFrame(step);
    }
  };
  const changed = () => {
    if (motion.matches && frame !== null) follow(false);
  };
  motion.addEventListener("change", changed);
  return {
    get active() {
      return frame !== null;
    },
    ownsScroll: () => frame !== null && written !== null && Math.abs(el.scrollTop - written) < 1,
    follow,
    cancel,
    dispose: () => {
      cancel();
      motion.removeEventListener("change", changed);
    },
  };
}
