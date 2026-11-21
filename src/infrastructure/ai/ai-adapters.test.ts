import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AiUnavailableError } from "@/application/ports/web-search";
import { UpstreamError } from "@/lib/errors";
import { GITHUB_MODELS_URL, GitHubModelsExtractor, relevantText } from "./github-models";
import { TAVILY_URL, TavilySearch } from "./tavily";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const f: typeof fetch = (...args) => fetch(...args);

describe("TavilySearch", () => {
  it("posts the query with a Bearer key and deny-list, and returns pages with text", async () => {
    let seen: { auth: string | null; body: Record<string, unknown> } | null = null;
    server.use(
      http.post(TAVILY_URL, async ({ request }) => {
        seen = {
          auth: request.headers.get("authorization"),
          body: (await request.json()) as Record<string, unknown>,
        };
        return HttpResponse.json({
          results: [
            {
              url: "https://djmag.com/news/x",
              title: "Lineup",
              content: "snippet",
              raw_content: "full text",
            },
            { url: "javascript:alert(1)", title: "bad", content: "x" },
            { url: "https://sunburn.in/event/x/", title: "Event", content: "snippet only" },
          ],
        });
      }),
    );
    const pages = await new TavilySearch({ apiKey: "tvly-test", fetch: f }).search("Sunburn 2026", {
      maxResults: 6,
      excludeDomains: ["bookmyshow.com"],
    });
    expect(seen!.auth).toBe("Bearer tvly-test");
    expect(seen!.body).toMatchObject({
      query: "Sunburn 2026",
      max_results: 6,
      exclude_domains: ["bookmyshow.com"],
    });
    expect(pages).toEqual([
      { url: "https://djmag.com/news/x", title: "Lineup", content: "full text" },
      { url: "https://sunburn.in/event/x/", title: "Event", content: "snippet only" },
    ]);
  });

  it("maps 429 to AiUnavailableError and a bad shape to UpstreamError", async () => {
    server.use(http.post(TAVILY_URL, () => new HttpResponse(null, { status: 429 })));
    const t = new TavilySearch({ apiKey: "k", fetch: f });
    await expect(t.search("q", { maxResults: 1, excludeDomains: [] })).rejects.toBeInstanceOf(
      AiUnavailableError,
    );
    server.use(http.post(TAVILY_URL, () => HttpResponse.json({ nope: true })));
    await expect(t.search("q", { maxResults: 1, excludeDomains: [] })).rejects.toBeInstanceOf(
      UpstreamError,
    );
  });
});

describe("GitHubModelsExtractor", () => {
  const request = {
    event: { title: "Sunburn Festival 2026", city: "Mumbai", date: "2026-12-18" },
    page: {
      url: "https://djmag.com/news/x",
      title: "Lineup",
      content: "Sunburn Festival 2026 text",
    },
  };

  it("sends the model, the page text and JSON mode, and parses the JSON reply", async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post(GITHUB_MODELS_URL, async ({ request: r }) => {
        expect(r.headers.get("authorization")).toBe("Bearer ghp-test");
        body = (await r.json()) as Record<string, unknown>;
        return HttpResponse.json({
          choices: [{ message: { content: '{"title":"Sunburn Festival 2026"}' } }],
        });
      }),
    );
    const x = new GitHubModelsExtractor({ token: "ghp-test", model: "openai/gpt-5.5", fetch: f });
    expect(await x.extract(request)).toEqual({ title: "Sunburn Festival 2026" });
    expect(body).toMatchObject({
      model: "openai/gpt-5.5",
      response_format: { type: "json_object" },
    });
    const messages = (body as unknown as { messages: Array<{ content: string }> }).messages;
    expect(messages[1]!.content).toContain("Sunburn Festival 2026 text");
  });

  it("maps 429 and quota errors to AiUnavailableError", async () => {
    const x = new GitHubModelsExtractor({ token: "t", model: "m", fetch: f });
    server.use(http.post(GITHUB_MODELS_URL, () => new HttpResponse(null, { status: 429 })));
    await expect(x.extract(request)).rejects.toBeInstanceOf(AiUnavailableError);
    server.use(
      http.post(GITHUB_MODELS_URL, () =>
        HttpResponse.json({ error: { message: "Daily quota exceeded" } }, { status: 403 }),
      ),
    );
    await expect(x.extract(request)).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it("rejects a non-JSON reply", async () => {
    server.use(
      http.post(GITHUB_MODELS_URL, () =>
        HttpResponse.json({ choices: [{ message: { content: "Sure! Here it is" } }] }),
      ),
    );
    await expect(
      new GitHubModelsExtractor({ token: "t", model: "m", fetch: f }).extract(request),
    ).rejects.toBeInstanceOf(UpstreamError);
  });

  it("trims long pages to the part around the event's name", () => {
    const text = `${"x ".repeat(20_000)}Sunburn Festival 2026 lineup: DJ Snake.${" y".repeat(20_000)}`;
    const trimmed = relevantText(text, "Sunburn Festival 2026");
    expect(trimmed.length).toBeLessThanOrEqual(12_000);
    expect(trimmed).toContain("Sunburn Festival 2026 lineup: DJ Snake.");
  });
});
