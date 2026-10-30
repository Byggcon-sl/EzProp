import { describe, expect, it } from "vitest";
import { observeStickyHeight, STICKY_BAR_HEIGHT_VAR } from "./use-sticky-scroll-padding";

// Ingen jsdom: elementet, roten og ResizeObserver er enkle forfalskninger.
function fakeRoot() {
  const props = new Map<string, string>();
  return {
    props,
    style: {
      setProperty: (name: string, value: string) => void props.set(name, value),
      removeProperty: (name: string) => void props.delete(name),
    },
  };
}

describe("observeStickyHeight", () => {
  it("setter høyden ved start og ved endring, og rydder opp", () => {
    let height = 86.2;
    const el = { getBoundingClientRect: () => ({ height }) };
    const root = fakeRoot();
    let notify: () => void = () => {};
    let observed: unknown = null;
    let disconnected = false;

    const cleanup = observeStickyHeight(
      el as unknown as HTMLElement,
      root as unknown as HTMLElement,
      (callback) => {
        notify = callback;
        return {
          observe: (target) => void (observed = target),
          disconnect: () => void (disconnected = true),
        };
      },
    );

    expect(observed).toBe(el);
    expect(root.props.get(STICKY_BAR_HEIGHT_VAR)).toBe("87px");

    height = 161;
    notify();
    expect(root.props.get(STICKY_BAR_HEIGHT_VAR)).toBe("161px");

    cleanup();
    expect(disconnected).toBe(true);
    expect(root.props.has(STICKY_BAR_HEIGHT_VAR)).toBe(false);
  });
});
