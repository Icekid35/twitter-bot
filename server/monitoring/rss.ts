import { mediaSource } from "../utils/media.js";
import * as cheerio from "cheerio";
import type { Store } from "../database/store.js";
import type { Post, PostType } from "../../shared/schema.js";
import { AppError } from "../utils/errors.js";
import { download } from "../utils/network.js";
export function feedAddress(base: string, provider: string, username: string) {
  if (!base)
    throw new AppError(
      "FEED_REQUIRED",
      "Configure a Nitter or RSSHub feed source in System Settings.",
    );
  if (base.includes("{username}"))
    return base.replaceAll("{username}", username);
  return new URL(
    provider === "rsshub" ? `/twitter/user/${username}` : `/${username}/rss`,
    base,
  ).href;
}

export function parseFeed(xml: string, username: string): Post[] {
  const $ = cheerio.load(xml, { xml: true });
  if (!$("rss > channel").length && !$("feed").length)
    throw new AppError(
      "FEED_UNAVAILABLE",
      "The source returned an error page instead of an RSS feed.",
      503,
      true,
    );
  const channelTitle = $("channel > title,feed > title").first().text();
  const channelHandle = channelTitle.match(/@([a-zA-Z0-9_]+)/)?.[1];
  if (channelHandle && channelHandle.toLowerCase() !== username)
    throw new AppError(
      "FEED_MISMATCH",
      "The RSS feed belongs to a different account.",
      503,
    );
  const posts: Post[] = [];
  const entries = $("item,entry");
  entries.each((_i, node) => {
    const item = $(node);
    const url =
      item.find("link").first().text() ||
      item.find("link").attr("href") ||
      item.find("guid,id").first().text();
    const match = url.match(/\/([\w]+)\/status\/(\d+)/);
    if (!match) return;
    const raw = item
      .find("description,content\\:encoded,content,summary")
      .first()
      .text();
    const html = cheerio.load(raw);
    const title = item
      .find("title")
      .text()
      .replace(/^Pinned:\s*/i, "");
    const creator = item
      .find("dc\\:creator,author name")
      .text()
      .replace("@", "")
      .trim()
      .toLowerCase();
    let type: PostType = "original";
    if (/^RT by @|^RT @|^R\s*to\s*@/i.test(title))
      type = /^R to/i.test(title) ? "reply" : "repost";
    else if (/^R to @|^Replying to @/i.test(title)) type = "reply";
    else if (
      html(".quote,.quote-text,blockquote").length ||
      /^(QT|Quote)[: ]/i.test(title)
    )
      type = "quote";
    else if (
      match[1].toLowerCase() !== username ||
      (creator && creator !== username)
    )
      type = "unknown";
    const quoteText = html("blockquote").text().trim();
    let text =
      html("p").first().text().trim() || html.root().text().trim() || title;
    const published = item.find("pubDate,published,updated").first().text();
    const timestamp = Date.parse(published);
    if (!Number.isFinite(timestamp)) return;
    const media: Post["media"] = [];
    const add = (value: string | undefined, type: "image" | "video") => {
      if (!value) return;
      const clean = mediaSource(value);
      if (!media.some((m) => m.url === clean)) media.push({ url: clean, type });
    };
    html("img").each((_i, el) => add(html(el).attr("src"), "image"));
    html("video,video source").each((_i, el) =>
      add(html(el).attr("src"), "video"),
    );
    item.find("enclosure,media\\:content").each((_i, el) => {
      const mime = $(el).attr("type") || "";
      if (mime.startsWith("image/") || mime.startsWith("video/"))
        add($(el).attr("url"), mime.startsWith("video/") ? "video" : "image");
    });
    if (
      /Video unavailable|video playback|<br\s*\/?>(?:\s*)Video(?:\s*)<br/i.test(
        raw,
      ) &&
      !media.some((m) => m.type === "video")
    )
      media.push({ url: "", type: "video" });
    posts.push({
      id: match[2],
      author: match[1],
      url: `https://x.com/${match[1]}/status/${match[2]}`,
      publishedAt: new Date(timestamp).toISOString(),
      type,
      text,
      media,
      ...(quoteText ? { quotedText: quoteText } : {}),
    });
  });
  if (entries.length && !posts.length)
    throw new AppError(
      "FEED_FORMAT",
      "Feed entries lack recognizable X post IDs or dates. No baseline was changed.",
      503,
    );
  return posts;
}
export class RSSMonitor {
  constructor(
    private store: Store,
    private browser?: { scanPosts: (username: string) => Promise<Post[]> },
  ) {}
  async scan(username: string) {
    const settings = this.store.settings();
    const sources = [
      settings.feedUrl || settings.mirrorUrl,
      settings.fallbackFeedUrl,
    ].filter(Boolean);
    if (!sources.length)
      throw new AppError(
        "FEED_REQUIRED",
        "Set a Nitter or RSSHub source in System Settings.",
      );
    let failure: unknown;
    const account = this.store.accounts().find((a) => a.username === username);
    for (const source of sources) {
      const urlsToTry: string[] = [];
      if (source.includes("{username}")) {
        urlsToTry.push(source.replaceAll("{username}", username));
      } else {
        const withReplies = account?.settings.replies;
        const nitterUrl = feedAddress(source, "nitter", username).replace(
          withReplies ? /\/rss$/ : /$^/,
          "/with_replies/rss",
        );
        const rsshubUrl = feedAddress(source, "rsshub", username);
        if (settings.feedProvider === "rsshub") {
          urlsToTry.push(rsshubUrl, nitterUrl);
        } else {
          urlsToTry.push(nitterUrl, rsshubUrl);
        }
      }
      for (const url of urlsToTry) {
        try {
          const response = await download(url, {
            maxBytes: 4 * 1024 * 1024,
            timeout: settings.timeout,
          });
          if (response.status !== 200)
            throw new AppError(
              "FEED_UNAVAILABLE",
              `RSS source returned HTTP ${response.status}. The account has not been marked invalid.`,
              503,
              true,
            );
          const posts = parseFeed(response.data.toString("utf8"), username);
          if (posts.length > 0) return posts;
        } catch (error) {
          failure = error;
        }
      }
    }
    // If Nitter / RSS sources failed or returned 0 posts and browser is available with configured session
    if (this.browser && this.store.session().configured) {
      try {
        const browserPosts = await this.browser.scanPosts(username);
        if (browserPosts.length > 0) return browserPosts;
      } catch (browserError) {
        if (!failure) failure = browserError;
      }
    }
    if (failure) throw failure;
    return [];
  }
}
export async function verifyFeed(store: Store, username: string) {
  const settings = store.settings();
  const sources = [
    settings.feedUrl,
    settings.fallbackFeedUrl,
    settings.mirrorUrl,
  ].filter(Boolean);
  if (!sources.length)
    throw new AppError(
      "FEED_REQUIRED",
      "Set a Nitter or RSSHub source in System Settings.",
    );
  let lastError: unknown;
  for (const source of sources) {
    const urlsToTry: string[] = [];
    if (source.includes("{username}")) {
      urlsToTry.push(source.replaceAll("{username}", username));
    } else {
      urlsToTry.push(
        feedAddress(source, settings.feedProvider, username),
        feedAddress(source, settings.feedProvider === "rsshub" ? "nitter" : "rsshub", username),
      );
    }
    for (const url of urlsToTry) {
      try {
        const result = await download(url, {
          maxBytes: 4 * 1024 * 1024,
          timeout: settings.timeout,
        });
        if (result.status !== 200) {
          throw new AppError(
            "VERIFICATION_UNAVAILABLE",
            "The RSS source could not verify this account. This is not proof the account is invalid.",
            503,
            true,
          );
        }
        const xml = result.data.toString("utf8");
        parseFeed(xml, username);
        const $ = cheerio.load(xml, { xml: true });
        const title = $("channel > title,feed > title").first().text();
        const link =
          $("channel > link,feed > link").first().text() ||
          $("feed > link").attr("href") ||
          "";
        const matches =
          title.toLowerCase().includes("@" + username) ||
          new URL(link, "https://invalid.example").pathname.toLowerCase() ===
            `/${username}`;
        if (!matches) {
          throw new AppError(
            "VERIFICATION_UNAVAILABLE",
            "RSS profile identity could not be confirmed. Choose Nitter profile or authenticated X verification.",
            503,
          );
        }
        return {
          displayName: title.split(" / @")[0] || username,
          avatar: "",
          bio: "",
          url: `https://x.com/${username}`,
          verified: false,
          verification: "valid",
        };
      } catch (err) {
        lastError = err;
      }
    }
  }
  throw (
    lastError ||
    new AppError(
      "VERIFICATION_UNAVAILABLE",
      "The RSS source could not verify this account. This is not proof the account is invalid.",
      503,
      true,
    )
  );
}
