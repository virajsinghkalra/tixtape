/**
 * robots.txt rules for one user agent (RFC 9309): the most specific group wins, then the
 * longest matching rule; `Allow` wins a tie. `*` and `$` wildcards are supported.
 * `Crawl-delay` isn't in the RFC but is honoured (Rolling Stone India sets 600s, D-033).
 */
export type RobotsRules = {
  allows(path: string): boolean;
  /** Seconds, or null when the site sets none. */
  crawlDelaySeconds: number | null;
};

type Rule = { allow: boolean; pattern: string };
type Group = { agents: string[]; rules: Rule[]; crawlDelay: number | null };

function parseGroups(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.replace(/#.*$/u, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/iu.exec(line);
    if (!m?.[1]) continue;
    const key = m[1].toLowerCase();
    const value = (m[2] ?? "").trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" || key === "disallow") {
      // "Disallow:" with no path allows everything.
      if (value !== "") current.rules.push({ allow: key === "allow", pattern: value });
    } else if (key === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }
  return groups;
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`, "u").test(path);
}

/** Rules for `userAgent` (its product token, e.g. "lineupmixes"); empty text allows everything. */
export function parseRobots(text: string, userAgent: string): RobotsRules {
  const groups = parseGroups(text);
  const token = userAgent.toLowerCase();
  const group =
    groups.find((g) => g.agents.some((a) => a !== "*" && token.startsWith(a))) ??
    groups.find((g) => g.agents.includes("*"));
  const rules = group?.rules ?? [];
  return {
    crawlDelaySeconds: group?.crawlDelay ?? null,
    allows(path) {
      let best: Rule | null = null;
      for (const rule of rules) {
        if (!matches(rule.pattern, path)) continue;
        if (
          best === null ||
          rule.pattern.length > best.pattern.length ||
          (rule.pattern.length === best.pattern.length && rule.allow)
        ) {
          best = rule;
        }
      }
      return best === null || best.allow;
    },
  };
}
