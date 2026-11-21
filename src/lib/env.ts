import { z } from "zod";

/**
 * All configuration comes from the environment (Twelve-Factor) and is
 * validated once. Code reads `env()`, never `process.env` directly.
 */
/** Blank values in .env (e.g. `SPOTIFY_CLIENT_ID=`) mean "not set". */
const blankToUndefined = (v: unknown) => (v === "" ? undefined : v);
const optional = <T extends z.ZodType>(t: T) => z.preprocess(blankToUndefined, t.optional());

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  APP_URL: z.url().default("http://127.0.0.1:3000"),
  DATABASE_URL: z.string().min(1),
  /** Postgres pool size per process. Defaults to 2 on Vercel (serverless), 5 elsewhere. */
  DB_POOL_MAX: optional(z.coerce.number().int().min(1).max(20)),

  SPOTIFY_CLIENT_ID: optional(z.string().min(1)),
  SPOTIFY_CLIENT_SECRET: optional(z.string().min(1)),
  /** 32-byte key, base64. Generate with: openssl rand -base64 32 */
  TOKEN_ENC_KEY: optional(z.string().min(1)),
  TOKEN_ENC_KEY_VERSION: z.coerce.number().int().positive().default(1),
  SESSION_SECRET: optional(z.string().min(32)),

  TICKETMASTER_API_KEY: optional(z.string().min(1)),
  LASTFM_API_KEY: optional(z.string().min(1)),
  TAVILY_API_KEY: optional(z.string().min(1)),
  /** D-062/D-064 daily caps for the doubt resolver. */
  DOUBT_SEARCHES_PER_DAY: z.coerce.number().int().min(0).default(30),
  DOUBT_MODEL_CALLS_PER_DAY: z.coerce.number().int().min(0).default(30),
  GITHUB_MODELS_TOKEN: optional(z.string().min(1)),
  GITHUB_MODELS_MODEL: z.string().default("openai/gpt-5.5"),
  OPENAI_API_KEY: optional(z.string().min(1)),
  OPENAI_MODEL: z.string().default("gpt-5.5"),
  GEMINI_API_KEY: optional(z.string().min(1)),
  GEMINI_MODEL: optional(z.string().min(1)),

  /** Dedicated app mailbox for API etiquette (Wikimedia User-Agent). Never a personal email. */
  APP_CONTACT_EMAIL: optional(z.email()),
  SETLISTFM_API_KEY: optional(z.string().min(1)),
  /** D-060 alerts by Gmail SMTP (app password). Without user and pass, alerts go to the job log. */
  ALERT_SMTP_HOST: z.string().default("smtp.gmail.com"),
  ALERT_SMTP_PORT: z.coerce.number().int().positive().default(465),
  ALERT_SMTP_USER: optional(z.email()),
  ALERT_SMTP_PASS: optional(z.string().min(1)),
  ALERT_EMAIL_TO: z.email().default("lineupmixes@gmail.com"),
  /** Set by GitHub Actions: alerts are also written to the job summary. */
  GITHUB_STEP_SUMMARY: optional(z.string().min(1)),
  /** Comma-separated Spotify user IDs allowed to use admin screens. */
  ADMIN_SPOTIFY_USER_IDS: z.string().default(""),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Throws a clear error when a feature needs a variable that isn't set. */
export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = env()[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required environment variable ${String(key)}. See .env.example.`);
  }
  return value as NonNullable<Env[K]>;
}

/** Test helper: forget the cached config so tests can change process.env. */
export function resetEnvForTests(): void {
  cached = undefined;
}

/**
 * True on Vercel, which sets `VERCEL=1` on every deployment. A platform marker rather than app
 * config, so it is read without validating (and requiring) the rest of the environment.
 */
export function isVercel(): boolean {
  return Boolean(process.env.VERCEL);
}
