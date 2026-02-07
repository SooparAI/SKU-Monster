import { describe, expect, it, vi, beforeEach } from "vitest";

// Test the retryDbOp utility logic (extracted pattern)
describe("retryDbOp pattern", () => {
  it("succeeds on first attempt", async () => {
    const op = vi.fn().mockResolvedValue("ok");
    
    // Simulate the retry pattern
    async function retryDbOp<T>(fn: () => Promise<T>, label: string, retries = 3): Promise<T> {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          return await fn();
        } catch (err) {
          if (attempt === retries) throw err;
          await new Promise(r => setTimeout(r, 10));
        }
      }
      throw new Error("exhausted");
    }

    const result = await retryDbOp(op, "test");
    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds on second attempt", async () => {
    let callCount = 0;
    const op = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error("db connection lost");
      return "ok";
    });

    async function retryDbOp<T>(fn: () => Promise<T>, label: string, retries = 3): Promise<T> {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          return await fn();
        } catch (err) {
          if (attempt === retries) throw err;
          await new Promise(r => setTimeout(r, 10));
        }
      }
      throw new Error("exhausted");
    }

    const result = await retryDbOp(op, "test");
    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting all retries", async () => {
    const op = vi.fn().mockRejectedValue(new Error("permanent failure"));

    async function retryDbOp<T>(fn: () => Promise<T>, label: string, retries = 3): Promise<T> {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          return await fn();
        } catch (err) {
          if (attempt === retries) throw err;
          await new Promise(r => setTimeout(r, 10));
        }
      }
      throw new Error("exhausted");
    }

    await expect(retryDbOp(op, "test")).rejects.toThrow("permanent failure");
    expect(op).toHaveBeenCalledTimes(3);
  });
});

// Test the withTimeout pattern
describe("withTimeout pattern", () => {
  function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`'${operation}' timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      promise
        .then((result) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } })
        .catch((err) => { if (!settled) { settled = true; clearTimeout(timer); reject(err); } });
    });
  }

  it("resolves when promise completes before timeout", async () => {
    const result = await withTimeout(
      Promise.resolve("fast"),
      1000,
      "test"
    );
    expect(result).toBe("fast");
  });

  it("rejects when promise exceeds timeout", async () => {
    const slowPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("slow"), 500);
    });

    await expect(
      withTimeout(slowPromise, 50, "slow-op")
    ).rejects.toThrow("'slow-op' timed out after 50ms");
  });

  it("rejects with original error when promise fails before timeout", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("original error")), 1000, "test")
    ).rejects.toThrow("original error");
  });

  it("does not resolve after timeout even if promise eventually resolves", async () => {
    const slowPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("late"), 200);
    });

    const result = withTimeout(slowPromise, 50, "test");
    await expect(result).rejects.toThrow("timed out");
  });
});

// Test the status determination logic
describe("order status determination", () => {
  it("returns 'failed' when totalImages is 0", () => {
    const totalImages = 0;
    const failedSkus = 1;
    const skusLength = 1;

    const finalStatus = totalImages === 0 ? "failed"
      : failedSkus === skusLength ? "failed"
      : failedSkus > 0 ? "partial"
      : "completed";

    expect(finalStatus).toBe("failed");
  });

  it("returns 'failed' when all SKUs failed", () => {
    const totalImages = 0;
    const failedSkus = 3;
    const skusLength = 3;

    const finalStatus = totalImages === 0 ? "failed"
      : failedSkus === skusLength ? "failed"
      : failedSkus > 0 ? "partial"
      : "completed";

    expect(finalStatus).toBe("failed");
  });

  it("returns 'partial' when some SKUs failed but has images", () => {
    const totalImages = 3;
    const failedSkus = 1;
    const skusLength = 3;

    const finalStatus = totalImages === 0 ? "failed"
      : failedSkus === skusLength ? "failed"
      : failedSkus > 0 ? "partial"
      : "completed";

    expect(finalStatus).toBe("partial");
  });

  it("returns 'completed' when all SKUs succeeded", () => {
    const totalImages = 9;
    const failedSkus = 0;
    const skusLength = 3;

    const finalStatus = totalImages === 0 ? "failed"
      : failedSkus === skusLength ? "failed"
      : failedSkus > 0 ? "partial"
      : "completed";

    expect(finalStatus).toBe("completed");
  });

  // This is the exact bug case from order #270020:
  // totalImages=0 but failedSkus=1 and skusLength=1
  // Old code: failedSkus === skusLength → "failed" ✓
  // But if somehow totalImages=0 and failedSkus=0 (edge case), old code would say "completed"
  // New code: totalImages === 0 → "failed" regardless
  it("returns 'failed' when totalImages is 0 even if failedSkus is 0 (edge case)", () => {
    const totalImages = 0;
    const failedSkus = 0;
    const skusLength = 1;

    // OLD logic (buggy):
    const oldStatus = failedSkus === skusLength ? "failed"
      : failedSkus > 0 ? "partial"
      : "completed";
    expect(oldStatus).toBe("completed"); // BUG: should be failed!

    // NEW logic (fixed):
    const newStatus = totalImages === 0 ? "failed"
      : failedSkus === skusLength ? "failed"
      : failedSkus > 0 ? "partial"
      : "completed";
    expect(newStatus).toBe("failed"); // CORRECT
  });
});

// Test the hard timeout mechanism
describe("hard timeout mechanism", () => {
  it("fires and sets jobTimedOut flag", async () => {
    let jobTimedOut = false;
    const JOB_HARD_TIMEOUT = 100; // 100ms for test

    const hardTimer = setTimeout(() => {
      jobTimedOut = true;
    }, JOB_HARD_TIMEOUT);

    // Simulate a job that takes longer than the hard timeout
    await new Promise(r => setTimeout(r, 150));

    expect(jobTimedOut).toBe(true);
    clearTimeout(hardTimer);
  });

  it("does not fire when job completes in time", async () => {
    let jobTimedOut = false;
    const JOB_HARD_TIMEOUT = 200;

    const hardTimer = setTimeout(() => {
      jobTimedOut = true;
    }, JOB_HARD_TIMEOUT);

    // Simulate a job that completes quickly
    await new Promise(r => setTimeout(r, 50));
    clearTimeout(hardTimer);

    expect(jobTimedOut).toBe(false);
  });
});
