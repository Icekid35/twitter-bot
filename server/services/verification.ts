import { mediaSource } from "../utils/media.js";
import * as cheerio from "cheerio";
import { download } from "../utils/network.js";
import { AppError } from "../utils/errors.js";
export function normalizeHandle(input: string) {
  const handle = input.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(handle))
    throw new AppError(
      "INVALID_USERNAME",
      "Use an X handle with 1–15 letters, numbers, or underscores.",
    );
  return handle;
}
export function parseMirror(html: string, username: string) {
  const $ = cheerio.load(html);
  const error = $(".error-panel").text().toLowerCase();
  if (error.includes("suspended"))
    throw new AppError("SUSPENDED", "This account is suspended.");
  if (error.includes("not found") || error.includes("does not exist"))
    throw new AppError("NOT_FOUND", "This account does not exist.");
  if ($(".protected-icon").length || error.includes("protected"))
    throw new AppError(
      "PROTECTED",
      "This account is private. Public monitoring is unavailable.",
    );
  const handle = $(".profile-card-username")
    .text()
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  if (handle !== username || !$(".profile-card").length)
    throw new AppError(
      "VERIFICATION_UNAVAILABLE",
      "The verification source did not return a recognizable profile. Try another source.",
      503,
      true,
    );
  const avatar = mediaSource($(".profile-card-avatar img").attr("src") || "");
  return {
    displayName: $(".profile-card-fullname").text().trim() || username,
    avatar: avatar.startsWith("https://pbs.twimg.com/") ? avatar : "",
    bio: $(".profile-bio").text().trim(),
    url: `https://x.com/${username}`,
    verified: !!$(".verified-icon").length,
    verification: "valid",
  };
}
export async function verifyMirror(
  username: string,
  mirrorUrl: string,
  timeout: number,
) {
  if (!mirrorUrl)
    throw new AppError(
      "PROVIDER_REQUIRED",
      "Set a public mirror URL in System Settings, or choose authenticated X verification.",
    );
  let url: URL;
  try {
    url = new URL(mirrorUrl);
  } catch {
    throw new AppError("INVALID_SOURCE", "Enter a valid HTTPS mirror URL.");
  }
  const result = await download(new URL(`/${username}`, url).href, {
    maxBytes: 2 * 1024 * 1024,
    timeout,
  });
  if (result.status >= 500 || result.status === 429)
    throw new AppError(
      "VERIFICATION_UNAVAILABLE",
      "The verification service is temporarily unavailable. Try again later.",
      503,
      true,
    );
  return parseMirror(result.data.toString("utf8"), username);
}
