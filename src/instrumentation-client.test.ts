import { expect, it, vi } from "vitest";

it("QA-F-13: Zod never probes eval once the client config has run", async () => {
  await import("./instrumentation-client");
  const probe = vi.spyOn(globalThis, "Function");
  const { z } = await import("zod");
  const schema = z.object({ q: z.string(), page: z.number().optional() });
  expect(schema.parse({ q: "lolla" })).toEqual({ q: "lolla" });
  expect(probe).not.toHaveBeenCalled();
  probe.mockRestore();
});
