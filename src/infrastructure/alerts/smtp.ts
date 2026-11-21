/**
 * Minimal SMTP client for operator alerts (D-060): implicit TLS (port 465), AUTH PLAIN, one
 * plain-text message. Gmail with an app password is the $0 option. No dependency, because the
 * whole exchange is a dozen lines of protocol.
 */
import { connect as tlsConnect } from "node:tls";
import type { Duplex } from "node:stream";
import type { Alert, Alerts } from "@/application/ports/alerts";

export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  to: string;
  /** Opens the connection; tests pass a fake socket. */
  connect?: (host: string, port: number) => Duplex;
  timeoutMs?: number;
};

const CRLF = "\r\n";

/** Strips CR/LF so a value can't add headers or commands. */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

/** RFC 2047 encoded word, so non-ASCII subjects survive. */
const encodeHeader = (s: string) =>
  /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;

export function formatMessage(from: string, to: string, alert: Alert, date: Date): string {
  const body = Buffer.from(alert.body, "utf8")
    .toString("base64")
    .replace(/.{1,76}/g, (l) => l + CRLF);
  return [
    `From: Tixtape alerts <${oneLine(from)}>`,
    `To: <${oneLine(to)}>`,
    `Subject: ${encodeHeader(oneLine(`[Tixtape] ${alert.subject}`))}`,
    `Date: ${date.toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join(CRLF);
}

/** Reads SMTP replies; a reply ends at a line `NNN ` (space, not dash). */
function replies(socket: Duplex): () => Promise<{ code: number; text: string }> {
  let buffer = "";
  const waiting: Array<(line: string) => void> = [];
  const lines: string[] = [];
  socket.setEncoding?.("utf8");
  socket.on("data", (chunk: string | Buffer) => {
    buffer += chunk.toString();
    let i: number;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i).replace(/\r$/, "");
      buffer = buffer.slice(i + 1);
      const w = waiting.shift();
      if (w) w(line);
      else lines.push(line);
    }
  });
  const nextLine = () =>
    new Promise<string>((resolve) => {
      const l = lines.shift();
      if (l !== undefined) resolve(l);
      else waiting.push(resolve);
    });
  return async () => {
    const text: string[] = [];
    for (;;) {
      const line = await nextLine();
      text.push(line);
      if (/^\d{3}(?: |$)/.test(line))
        return { code: Number(line.slice(0, 3)), text: text.join("\n") };
    }
  };
}

export class SmtpAlerts implements Alerts {
  constructor(
    private readonly config: SmtpConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async send(alert: Alert): Promise<void> {
    const { host, port, user, pass, to } = this.config;
    const socket = (this.config.connect ?? defaultConnect)(host, port);
    const timer = setTimeout(
      () => socket.destroy(new Error("SMTP timed out")),
      this.config.timeoutMs ?? 15_000,
    );
    const failed = new Promise<never>((_, reject) => socket.once("error", reject));
    const read = replies(socket);
    const expect = async (code: number, step: string) => {
      const r = await Promise.race([read(), failed]);
      // Server replies may echo the address; never the password (AUTH is sent, not echoed).
      if (r.code !== code) throw new Error(`SMTP ${step} failed: ${oneLine(r.text).slice(0, 200)}`);
    };
    const cmd = (line: string) => socket.write(line + CRLF);
    try {
      await expect(220, "greeting");
      cmd("EHLO lineupmixes");
      await expect(250, "EHLO");
      cmd(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`).toString("base64")}`);
      await expect(235, "AUTH");
      cmd(`MAIL FROM:<${oneLine(user)}>`);
      await expect(250, "MAIL FROM");
      cmd(`RCPT TO:<${oneLine(to)}>`);
      await expect(250, "RCPT TO");
      cmd("DATA");
      await expect(354, "DATA");
      // Base64 lines never start with ".", so no dot-stuffing is needed.
      socket.write(formatMessage(user, to, alert, this.now()) + CRLF + "." + CRLF);
      await expect(250, "message");
      cmd("QUIT");
    } finally {
      clearTimeout(timer);
      socket.end();
    }
  }
}

function defaultConnect(host: string, port: number): Duplex {
  return tlsConnect({ host, port, servername: host });
}
