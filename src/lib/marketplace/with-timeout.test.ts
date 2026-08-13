import { describe, expect, it, vi } from "vitest";
import { withTimeout } from "./with-timeout";

describe("withTimeout", () => {
  it("resolves with the value when the promise settles in time", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 1000, "too slow")).resolves.toBe("ok");
  });

  it("passes a rejection straight through", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("handshake refused")), 1000, "too slow"),
    ).rejects.toThrow("handshake refused");
  });

  it("wraps a non-Error rejection so callers can rely on .message", async () => {
    await expect(withTimeout(Promise.reject("nope"), 1000, "too slow")).rejects.toThrow("nope");
  });

  // The case that matters: the SDK stops retrying but never settles.
  it("rejects a promise that never settles", async () => {
    vi.useFakeTimers();
    try {
      const pending = withTimeout(new Promise<string>(() => {}), 15_000, "Timed out");
      const assertion = expect(pending).rejects.toThrow("Timed out");
      await vi.advanceTimersByTimeAsync(15_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fire the timer once the promise has resolved", async () => {
    vi.useFakeTimers();
    try {
      await expect(withTimeout(Promise.resolve("ok"), 10, "Timed out")).resolves.toBe("ok");
      // Advancing past the deadline must not produce an unhandled rejection.
      await vi.advanceTimersByTimeAsync(1000);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
