/**
 * SSRF guard (D-070): the collector may only talk to public internet addresses. Checked
 * after DNS resolution, for every address a host resolves to, and again on every redirect.
 */
import { isIP } from "node:net";

const V4_BLOCKED: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (cloud metadata)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
];

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}

function v4Blocked(ip: string): boolean {
  const n = v4ToInt(ip);
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

/** Expands an IPv6 address to its 8 groups. */
function v6Groups(ip: string): number[] {
  const [head = "", tail] = ip.split("::");
  const parse = (s: string) => (s === "" ? [] : s.split(":"));
  let parts = [...parse(head), ...(tail === undefined ? [] : ["::"]), ...parse(tail ?? "")];
  // An embedded IPv4 tail ("::ffff:1.2.3.4") becomes two groups.
  const last = parts[parts.length - 1];
  if (last && last.includes(".")) {
    const n = v4ToInt(last);
    parts = [...parts.slice(0, -1), ((n >>> 16) & 0xffff).toString(16), (n & 0xffff).toString(16)];
  }
  const gap = parts.indexOf("::");
  if (gap >= 0) {
    const fill = Array<string>(8 - (parts.length - 1)).fill("0");
    parts = [...parts.slice(0, gap), ...fill, ...parts.slice(gap + 1)];
  }
  return parts.map((p) => parseInt(p, 16));
}

function v6Blocked(ip: string): boolean {
  const g = v6Groups(
    ip
      .toLowerCase()
      .replace(/^\[|\]$/gu, "")
      .replace(/%.*$/u, ""),
  );
  if (g.length !== 8 || g.some((x) => Number.isNaN(x))) return true;
  const [a = 0, b = 0, , , , f = 0, x = 0, y = 0] = g;
  if (g.every((v) => v === 0)) return true; // ::
  if (g.slice(0, 7).every((v) => v === 0) && y === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible: judge the embedded IPv4.
  if (g.slice(0, 5).every((v) => v === 0) && (f === 0xffff || f === 0)) {
    return v4Blocked(`${x >> 8}.${x & 0xff}.${y >> 8}.${y & 0xff}`);
  }
  if (a === 0x64 && b === 0xff9b) return true; // NAT64
  if ((a & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((a & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((a & 0xff00) === 0xff00) return true; // multicast
  if (a === 0x2001 && b === 0x0db8) return true; // documentation
  if (a === 0x2002) return true; // 6to4 (may embed private IPv4)
  return false;
}

/** True only for public unicast addresses. Anything unparseable is treated as blocked. */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip.replace(/^\[|\]$/gu, ""));
  if (kind === 4) return !v4Blocked(ip);
  if (kind === 6) return !v6Blocked(ip);
  return false;
}
