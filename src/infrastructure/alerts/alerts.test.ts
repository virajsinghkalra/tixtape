import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Duplex } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Alert, Alerts } from "@/application/ports/alerts";
import { createAlerts, JobSummaryAlerts, SmtpAlerts, ThrottledAlerts } from ".";
import { formatMessage } from "./smtp";

const alert: Alert = { key: "held-events", subject: "2 events need review", body: "A\nB" };

/** A fake SMTP server: answers each command with the scripted reply. */
function fakeServer(replies: Record<string, string>) {
  const received: string[] = [];
  let pendingData = false;
  const socket: Duplex = new Duplex({
    read() {},
    write(chunk, _enc, done) {
      const text = chunk.toString();
      received.push(text);
      const verb = pendingData ? "MESSAGE" : text.split(/[ :\r]/)[0]!;
      pendingData = verb === "DATA";
      const reply = replies[verb];
      if (reply) setImmediate(() => socket.push(reply));
      done();
    },
  });
  setImmediate(() => socket.push("220 smtp.test ready\r\n"));
  return { socket, received };
}

const ok = {
  EHLO: "250-smtp.test\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n",
  AUTH: "235 2.7.0 Accepted\r\n",
  MAIL: "250 OK\r\n",
  RCPT: "250 OK\r\n",
  DATA: "354 Go ahead\r\n",
  MESSAGE: "250 2.0.0 queued\r\n",
  QUIT: "221 bye\r\n",
};

const smtp = (socket: Duplex) =>
  new SmtpAlerts(
    {
      host: "smtp.test",
      port: 465,
      user: "app@example.com",
      pass: "app-password",
      to: "lineupmixes@gmail.com",
      connect: () => socket,
    },
    () => new Date("2026-11-21T10:00:00Z"),
  );

describe("SmtpAlerts", () => {
  it("authenticates and sends one message to the alert mailbox", async () => {
    const server = fakeServer(ok);
    await smtp(server.socket).send(alert);
    const all = server.received.join("");
    expect(all).toContain(
      `AUTH PLAIN ${Buffer.from("\0app@example.com\0app-password").toString("base64")}`,
    );
    expect(all).toContain("RCPT TO:<lineupmixes@gmail.com>");
    expect(all).toContain("Subject: [Tixtape] 2 events need review");
    expect(all).toContain("\r\n.\r\n");
    expect(all).toContain("QUIT");
  });

  it("fails with the step and server text when auth is refused", async () => {
    const server = fakeServer({ ...ok, AUTH: "535 5.7.8 Username and Password not accepted\r\n" });
    await expect(smtp(server.socket).send(alert)).rejects.toThrow(/AUTH failed: 535/);
    expect(server.received.join("")).not.toContain("MAIL FROM");
  });

  it("formats a message whose subject and addresses can't inject headers", () => {
    const msg = formatMessage(
      "a@x.com",
      "b@y.com\r\nBcc: evil@z.com",
      { key: "k", subject: "hi\r\nBcc: evil@z.com", body: "x" },
      new Date(0),
    );
    expect(msg).not.toMatch(/\r\nBcc:/);
  });

  it("encodes a non-ASCII subject", () => {
    const msg = formatMessage("a@x.com", "b@y.com", { ...alert, subject: "Café ✓" }, new Date(0));
    expect(msg).toMatch(/Subject: =\?UTF-8\?B\?/);
  });
});

describe("ThrottledAlerts", () => {
  it("repeats an unchanged alert only after a day, and a changed one at once", async () => {
    const dir = await mkdtemp(join(tmpdir(), "alerts-"));
    let now = new Date("2026-11-21T00:00:00Z");
    const sent: Alert[] = [];
    const inner: Alerts = { send: async (a) => void sent.push(a) };
    const throttled = () => new ThrottledAlerts(inner, join(dir, "s.json"), { now: () => now });

    await throttled().send(alert);
    await throttled().send(alert);
    expect(sent).toHaveLength(1);
    await throttled().send({ ...alert, subject: "3 events need review" });
    expect(sent).toHaveLength(2);
    now = new Date("2026-11-22T00:00:01Z");
    await throttled().send({ ...alert, subject: "3 events need review" });
    expect(sent).toHaveLength(3);
  });
});

describe("createAlerts", () => {
  afterEach(() => {
    process.exitCode = 0;
    vi.restoreAllMocks();
  });
  const env = {
    ALERT_SMTP_HOST: "smtp.gmail.com",
    ALERT_SMTP_PORT: 465,
    ALERT_SMTP_USER: undefined,
    ALERT_SMTP_PASS: undefined,
    ALERT_EMAIL_TO: "lineupmixes@gmail.com",
  };
  const logger = { warn: vi.fn(), error: vi.fn() };

  it("without SMTP, writes the job summary and fails the job so GitHub notifies", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = await mkdtemp(join(tmpdir(), "alerts-"));
    const summary = join(dir, "summary.md");
    await createAlerts({ env: { ...env, GITHUB_STEP_SUMMARY: summary }, logger }).send(alert);
    expect(await readFile(summary, "utf8")).toContain("Alert: 2 events need review");
    expect(process.exitCode).toBe(1);
  });

  it("off GitHub Actions and without SMTP, only logs", async () => {
    await createAlerts({ env: { ...env, GITHUB_STEP_SUMMARY: undefined }, logger }).send(alert);
    expect(logger.warn).toHaveBeenCalledWith(
      { alert: "held-events", subject: "2 events need review" },
      "alert",
    );
    expect(process.exitCode).toBe(0);
  });

  it("a summary sink doesn't fail the job when email is configured", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = await mkdtemp(join(tmpdir(), "alerts-"));
    await new JobSummaryAlerts(join(dir, "s.md"), false).send(alert);
    expect(process.exitCode).toBe(0);
  });
});
