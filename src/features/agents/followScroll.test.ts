import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFollowScroll } from "./followScroll";

let time: number;
let frames: Map<number, FrameRequestCallback>;
let reduced: boolean;
const disposers: Array<() => void> = [];
beforeEach(() => {
  time = 0;
  reduced = false;
  frames = new Map();
  let id = 0;
  vi.spyOn(window.performance, "now").mockImplementation(() => time);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((fn) => {
    frames.set(++id, fn);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  vi.spyOn(window, "matchMedia").mockImplementation(
    () =>
      ({
        get matches() {
          return reduced;
        },
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList,
  );
});
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.restoreAllMocks();
});
function tick(ms = 1000 / 60) {
  time += ms;
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((fn) => fn(time));
}
function setup(rounded = false) {
  const el = document.createElement("div");
  let height = 1000;
  let top = 0;
  Object.defineProperties(el, {
    scrollHeight: { get: () => height },
    clientHeight: { get: () => 400 },
    scrollTop: {
      get: () => top,
      set: (value: number) => {
        top = Math.max(0, Math.min(rounded ? Math.round(value) : value, height - 400));
      },
    },
  });
  const follow = createFollowScroll(el);
  disposers.push(follow.dispose);
  return {
    el,
    follow,
    grow: (value: number) => {
      height = value;
    },
  };
}
it("moves through intermediate positions and follows new output without restarting", () => {
  const { el, follow, grow } = setup();
  follow.follow(true);
  expect(el.scrollTop).toBe(0);
  tick();
  expect(el.scrollTop).toBeGreaterThan(0);
  expect(el.scrollTop).toBeLessThan(600);
  expect(follow.ownsScroll()).toBe(true);
  grow(2000);
  follow.follow(true);
  follow.follow(true);
  expect(frames.size).toBe(1);
  let previous = el.scrollTop;
  for (let i = 0; i < 50; i++) {
    tick();
    expect(el.scrollTop).toBeGreaterThanOrEqual(previous);
    expect(el.scrollTop).toBeLessThanOrEqual(1600);
    previous = el.scrollTop;
  }
  expect(el.scrollTop).toBe(1600);
  expect(frames.size).toBe(0);
});
it("keeps the same pace on 60Hz and 120Hz displays", () => {
  const slow = setup();
  const fast = setup();
  slow.follow.follow(true);
  for (let i = 0; i < 6; i++) tick(1000 / 60);
  const expected = slow.el.scrollTop;
  slow.follow.cancel();
  fast.follow.follow(true);
  for (let i = 0; i < 12; i++) tick(1000 / 120);
  expect(fast.el.scrollTop).toBeCloseTo(expected, 5);
});
it("reaches the bottom when the browser rounds offsets to integer pixels", () => {
  const { el, follow } = setup(true);
  follow.follow(true);
  for (let i = 0; i < 60; i++) tick();
  expect(el.scrollTop).toBe(600);
  expect(frames.size).toBe(0);
});
it("recognizes a manual offset and cancels pending animation frames", () => {
  const { el, follow } = setup();
  follow.follow(true);
  tick();
  el.scrollTop = 20;
  expect(follow.ownsScroll()).toBe(false);
  follow.cancel();
  tick();
  expect(el.scrollTop).toBe(20);
  expect(frames.size).toBe(0);
});
it("honours reduced motion and leaves no animation after disposal", () => {
  const { el, follow } = setup();
  reduced = true;
  follow.follow(true);
  expect(el.scrollTop).toBe(600);
  expect(frames.size).toBe(0);
  reduced = false;
  el.scrollTop = 0;
  follow.follow(true);
  follow.dispose();
  tick();
  expect(el.scrollTop).toBe(0);
});
