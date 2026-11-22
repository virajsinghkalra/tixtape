/**
 * D-084 (QA-F-13): runs in the browser before any app code. Zod 4 probes `new Function("")` when
 * it builds object schemas (its JIT fast path). Under our CSP (no 'unsafe-eval') the probe
 * throws and is caught, but the browser still reports a `script-src` violation on every page.
 * Jitless mode skips the probe; client-side parses are small, so the speed difference is nil.
 */
import { config } from "zod";

config({ jitless: true });
