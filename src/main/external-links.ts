// The schemes `openExternal` hands to the OS: web pages and mail. Any other
// scheme (`file:`, `javascript:`, an app's own) could run or open something
// on the machine.
const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

// `open` behind a scheme gate: a URL that does not parse, or whose scheme is
// not http, https or mailto, rejects with `Refused to open <url>: …` and never
// reaches `open`.
export function gateExternalLinks(
  open: (url: string) => Promise<void>,
): (url: string) => Promise<void> {
  return async (url) => {
    const scheme = URL.parse(url)?.protocol;
    if (scheme === undefined || !EXTERNAL_SCHEMES.has(scheme)) {
      throw new Error(
        `Refused to open ${url}: only http, https and mailto links open outside the app`,
      );
    }
    return open(url);
  };
}
