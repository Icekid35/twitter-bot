import { mediaSource, tweetMedia } from "../utils/media.js";
import { browserExecutable } from "./executable.js";
import puppeteer, { type Browser, type Page, type HTTPResponse } from "puppeteer";
import { selectors as S } from "./selectors.js";
import { AppError, now } from "../utils/errors.js";
import type { Store } from "../database/store.js";
import type { Post, ActionType } from "../../shared/schema.js";
export class XBrowser {
  private browser?: Browser;
  private page?: Page;
  constructor(private store: Store) {}
  async close() {
    await this.browser?.close();
    this.browser = undefined;
    this.page = undefined;
  }
  private async getPage() {
    if (this.page && !this.page.isClosed()) return this.page;
    try {
      this.browser = await puppeteer.launch({
        headless: process.env.HEADLESS !== "false",
        executablePath: await browserExecutable(),
        args: ["--lang=en-US"],
        pipe: true,
      });
      this.page = await this.browser.newPage();
      await this.page.setViewport({ width: 1440, height: 1000 });
      await this.page.setExtraHTTPHeaders({
        "Accept-Language": "en-US,en;q=0.9",
      });
      const cookies = this.store.secret("cookies");
      if (cookies)
        await this.browser
          .defaultBrowserContext()
          .setCookie(...JSON.parse(cookies));
      this.page.setDefaultTimeout(this.store.settings().timeout);
      return this.page;
    } catch {
      throw new AppError(
        "BROWSER",
        "Chromium could not start. Check the browser installation and executable path.",
        503,
      );
    }
  }
  private async guard(page: Page) {
    const text = await page.evaluate(() => document.body.innerText);
    if (
      /\/account\/access|\/i\/flow\/challenge/.test(page.url()) ||
      /verify your identity|unusual activity|suspicious activity|authenticate your account|prove you.re human/i.test(
        text,
      )
    ) {
      this.stop(
        "challenge",
        "X requires verification. Open X yourself and resolve the challenge.",
      );
      throw new AppError(
        "CHALLENGE",
        "X requires verification. Automation has stopped.",
        409,
      );
    }
    if (
      /\/i\/flow\/login|\/login(?:\?|$)/.test(page.url()) ||
      !(await page.$(S.account))
    ) {
      this.stop(
        "expired",
        "The X session is no longer authenticated. Replace or test your cookies.",
      );
      throw new AppError(
        "SESSION",
        "Your X session needs reauthentication.",
        409,
      );
    }
  }
  private stop(status: string, message: string) {
    this.store.setMeta("paused", true);
    this.store.setMeta("session", {
      status,
      username: null,
      checkedAt: now(),
      message,
    });
    this.store.log("ERROR", message);
  }
  private async navigate(url: string) {
    const page = await this.getPage();
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: this.store.settings().timeout,
      });
      await page
        .waitForSelector(
          `${S.account},input[autocomplete="username"],[data-testid="LoginForm_Login_Button"]`,
          { timeout: this.store.settings().timeout },
        )
        .catch(() => undefined);
      await this.guard(page);
      return page;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "NAVIGATION",
        "X did not finish loading. The scan can retry after a delay.",
        503,
        true,
      );
    }
  }
  async testSession() {
    this.store.setMeta("session", {
      status: "checking",
      username: null,
      checkedAt: now(),
      message: "Checking authentication with X.",
    });
    try {
      const page = await this.navigate("https://x.com/home");
      const href = await page.$eval(S.profile, (el) => el.getAttribute("href"));
      const username = href?.replace(/^\//, "").split("/")[0];
      if (!username || !/^[a-zA-Z0-9_]{1,15}$/.test(username))
        throw new AppError(
          "STRUCTURE",
          "X profile navigation could not be identified. Session not confirmed.",
          503,
        );
      this.store.setMeta("session", {
        status: "valid",
        username: username.toLowerCase(),
        checkedAt: now(),
        message: "Session verified with X.",
      });
      this.store.log("SUCCESS", "X session authenticated");
      return this.store.session();
    } catch (error) {
      if (!["expired", "challenge"].includes(this.store.session().status))
        this.stop(
          "authentication_failed",
          "Session verification failed. Check your cookies and connection.",
        );
      throw error;
    }
  }
  async verify(username: string) {
    const page = await this.navigate(`https://x.com/${username}`);
    await page.waitForSelector(
      '[data-testid="UserName"],[data-testid="emptyState"]',
    );
    const body = await page.evaluate(() => document.body.innerText);
    if (/account suspended/i.test(body))
      throw new AppError("SUSPENDED", "This account is suspended.");
    if (/this account doesn.t exist/i.test(body))
      throw new AppError("NOT_FOUND", "This account does not exist.");
    if (/these posts are protected/i.test(body))
      throw new AppError("PROTECTED", "This account is private.");
    const profile = await page.evaluate(() => ({
      displayName:
        document
          .querySelector('[data-testid="UserName"]')
          ?.textContent?.split("@")[0] || "",
      bio:
        document.querySelector('[data-testid="UserDescription"]')
          ?.textContent || "",
      avatar:
        document
          .querySelector('[data-testid^="UserAvatar-Container"] img')
          ?.getAttribute("src") || "",
    }));
    if (!profile.displayName)
      throw new AppError(
        "STRUCTURE",
        "X profile structure was not recognized.",
        503,
      );
    return {
      ...profile,
      url: `https://x.com/${username}`,
      verified: false,
      verification: "valid",
    };
  }
  async scanPosts(username: string): Promise<Post[]> {
    const page = await this.navigate(`https://x.com/${username}`);
    await page
      .waitForSelector('article[data-testid="tweet"], [data-testid="emptyState"]', {
        timeout: this.store.settings().timeout,
      })
      .catch(() => undefined);
    const rawPosts = await page.evaluate((targetUser: string) => {
      const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
      return articles.map((el) => {
        const timeEl = el.querySelector("time");
        const link = timeEl?.closest("a")?.getAttribute("href") || "";
        const match = link.match(/\/([^\/]+)\/status\/(\d+)/);
        const text = el.querySelector('[data-testid="tweetText"]')?.textContent?.trim() || "";
        const publishedAt = timeEl?.getAttribute("datetime") || new Date().toISOString();
        const author = match ? match[1].toLowerCase() : targetUser.toLowerCase();
        const id = match ? match[2] : "";
        const isRepost = !link.toLowerCase().startsWith(`/${targetUser.toLowerCase()}/status/`);
        const isReply = el.textContent?.toLowerCase().includes("replying to") || false;
        return {
          id,
          author,
          url: `https://x.com${link}`,
          publishedAt,
          type: isRepost ? "repost" : isReply ? "reply" : "original",
          text,
          media: Array.from(el.querySelectorAll('[data-testid="tweetPhoto"] img, video')).map((node) => {
            if (node instanceof HTMLVideoElement) return { type: "video", url: node.currentSrc || node.src || node.querySelector("source")?.src || "" };
            return { type: "image", url: (node as HTMLImageElement).currentSrc || (node as HTMLImageElement).src };
          }),
        };
      }).filter((p) => Boolean(p.id));
    }, username);
    return rawPosts.map((post) => ({ ...post, media: post.media.map((media) => ({ ...media, url: mediaSource(media.url) })) })) as Post[];
  }
  async enrichMedia(post: Post): Promise<Post> {
    const page = await this.getPage();
    const attachments: Post["media"] = [];
    const pending: Promise<void>[] = [];
    const capture = (response: HTTPResponse) => {
      if (!response.url().includes("/graphql/") || !response.ok()) return;
      pending.push(response.json().then((body) => { attachments.push(...tweetMedia(body, post.id)); }).catch(() => undefined));
    };
    page.on("response", capture);
    try {
      await this.navigate(post.url);
      const selector = `${S.tweet}:has(a[href$="/status/${post.id}"] time)`;
      await page.waitForSelector(selector);
      await page.waitForNetworkIdle({ idleTime: 500, timeout: this.store.settings().timeout }).catch(() => undefined);
      await Promise.all(pending);
      if (!attachments.length) {
        const media = await page.$eval(selector, (el) => Array.from(el.querySelectorAll('[data-testid="tweetPhoto"] img, video')).map((node) => ({
          type: node instanceof HTMLVideoElement ? "video" as const : "image" as const,
          url: (node as HTMLVideoElement | HTMLImageElement).currentSrc || (node as HTMLVideoElement | HTMLImageElement).src || "",
        })));
        attachments.push(...media);
      }
      return { ...post, media: attachments.length ? attachments : post.media };
    } finally { page.off("response", capture); }
  }
  async act(
    post: Post,
    type: ActionType,
    text: string | undefined,
    beforeMutation: () => boolean,
  ) {
    const page = await this.navigate(post.url);
    await page.waitForSelector(S.tweet);
    const target = await page.$(
      `${S.tweet}:has(a[href$="/status/${post.id}"] time)`,
    );
    if (!target)
      throw new AppError(
        "POST_MISSING",
        "The requested post was not found on X.",
        404,
      );
    if (
      await page.$$eval(S.dialog, (dialogs) =>
        dialogs.some((el) => {
          const rect = el.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            getComputedStyle(el).visibility !== "hidden"
          );
        }),
      )
    )
      throw new AppError(
        "DIALOG",
        "An unexpected dialog blocked the action.",
        409,
      );
    const permit = async () => {
      await this.guard(page);
      if (!beforeMutation())
        throw new AppError(
          "PAUSED",
          "Automation stopped before submitting the action.",
          409,
        );
    };
    if (type === "like") {
      if (await target.$(S.unlike)) return { url: post.url };
      await permit();
      const button = await target.$(S.like);
      if (!button)
        throw new AppError(
          "STRUCTURE",
          "The Like control could not be identified.",
          503,
        );
      await button.click();
      await page.waitForSelector(
        `${S.tweet}:has(a[href$="/status/${post.id}"] time) ${S.unlike}`,
      );
      return { url: post.url };
    }
    if (type === "repost") {
      if (await target.$(S.undoRepost)) return { url: post.url };
      const button = await target.$(S.repost);
      if (!button)
        throw new AppError(
          "STRUCTURE",
          "The Repost control could not be identified.",
          503,
        );
      await permit();
      await button.click();
      const menuItem = await page.waitForFunction((selector) => {
        const candidates = Array.from(document.querySelectorAll(`${selector},[role="menuitem"]`));
        return candidates.find((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden" &&
            (el.matches(selector) || /^(repost|retweet)$/i.test((el as HTMLElement).innerText.trim()));
        });
      }, { timeout: this.store.settings().timeout }, S.repostConfirm).catch(() => {
        throw new AppError("REPOST_MENU", "The Repost confirmation menu did not appear or its control was not recognized.", 503);
      });
      await permit();
      const confirmed = page.waitForResponse((response) => {
        if (!response.url().includes("/CreateRetweet")) return false;
        try { return JSON.parse(response.request().postData() || "{}").variables?.tweet_id === post.id; }
        catch { return false; }
      }, { timeout: this.store.settings().timeout }).then(async (response) => {
        const body = await response.json();
        const result = body?.data?.create_retweet?.retweet_results?.result;
        if (body.errors?.length) {
          const error = body.errors[0];
          const rejection = new AppError("ACTION_REJECTED", `X rejected the repost${error.code ? ` (code ${error.code})` : ""}: ${String(error.message || "No reason supplied").replace(/[\r\n]/g, " ").slice(0,240)}`, 409);
          return { error: rejection };
        }
        if (!response.ok() || !/^\d+$/.test(result?.rest_id || result?.legacy?.id_str || ""))
          throw new AppError("UNCONFIRMED", `X returned HTTP ${response.status()} without a confirmed repost identifier.`, 503);
        return { error: null };
      });
      // Register both confirmations before the click; React may update the control asynchronously.
      const ui = page.waitForSelector(
        `${S.tweet}:has(a[href$="/status/${post.id}"] time) ${S.undoRepost}`,
      );
      const confirmation = Promise.any([confirmed, ui.then(() => ({ error: null }))]).catch(() => null);
      await menuItem.dispose();
      // Menus animate after becoming visible. A raw ElementHandle click can land
      // outside the moving item and dismiss it without ever submitting a request.
      await page.locator(`${S.repostConfirm},[role="menuitem"]`).filter((el) =>
        el.getAttribute("data-testid") === "retweetConfirm" || /^(repost|retweet)$/i.test((el as HTMLElement).innerText.trim()),
      ).setTimeout(this.store.settings().timeout).click();
      const outcome = await confirmation;
      if (!outcome) throw new AppError("UNCONFIRMED", "X returned neither a confirmed repost nor an Undo repost control.", 503);
      if (outcome.error) throw outcome.error;
      return { url: post.url };
    }
    const button = await target.$(S.reply);
    if (!button || !text)
      throw new AppError(
        "REPLY",
        "Reply controls or generated text are missing.",
        503,
      );
    await permit();
    await button.click();
    await page.waitForSelector(`${S.dialog} ${S.editor}`, { visible: true });
    await page.type(`${S.dialog} ${S.editor}`, text, { delay: 15 });
    await permit();
    // Match the submitted text and parent ID, then require a server-issued reply ID.
    // A stale toast or an optimistic UI change is insufficient evidence.
    const confirmation = page
      .waitForResponse(
        (response) => {
          if (!response.url().includes("/CreateTweet")) return false;
          try {
            const variables = JSON.parse(
              response.request().postData() || "{}",
            ).variables;
            return (
              variables?.tweet_text === text &&
              variables?.reply?.in_reply_to_tweet_id === post.id
            );
          } catch {
            return false;
          }
        },
        { timeout: this.store.settings().timeout },
      )
      .then(async (response) => {
        const body = await response.json();
        const id = body?.data?.create_tweet?.tweet_results?.result?.rest_id;
        if (!response.ok() || !/^\d+$/.test(id || ""))
          throw new AppError(
            "UNCONFIRMED",
            "X did not return a confirmed reply identifier.",
            503,
          );
        return id as string;
      });
    // Attach a rejection handler before clicking so failures cannot become unhandled.
    const outcome = confirmation.then(
      (id) => ({ id }),
      () => ({ id: null }),
    );
    await page.click(`${S.dialog} ${S.submit}`);
    const { id } = await outcome;
    if (!id)
      throw new AppError(
        "UNCONFIRMED",
        "Reply submission could not be confirmed. Inspect X before resolving.",
        503,
      );
    return {
      url: `https://x.com/${this.store.session().username}/status/${id}`,
    };
  }
}
