/**
 * D-090: crawlers, link unfurlers, monitors and headless browsers never count as visitors.
 * Matched on the User-Agent; the browser also skips tracking under `navigator.webdriver`.
 */
const BOT_UA =
  /bot\b|bot\/|crawl|spider|slurp|scrape|preview|facebookexternalhit|embedly|whatsapp\/|slack-imgproxy|vkshare|lighthouse|pagespeed|headlesschrome|phantomjs|puppeteer|playwright|selenium|curl\/|wget|python-requests|python-urllib|axios|node-fetch|undici|go-http-client|okhttp|java\/|httpclient|monitor|uptime|pingdom|statuscake|vercel-(screenshot|favicon)/i;

export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua || ua.trim().length < 10) return true;
  return BOT_UA.test(ua);
}
