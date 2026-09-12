/** Convert Nitter's public media proxy paths to the original HTTPS CDN resource. */
export function mediaSource(input: string): string {
  try {
    const url = new URL(input, "https://mirror.invalid");
    if (["pbs.twimg.com", "video.twimg.com"].includes(url.hostname)) {
      url.protocol = "https:";
      return url.href;
    }
    if (!url.pathname.startsWith("/pic/")) return input;
    const decoded = decodeURIComponent(url.pathname.slice(5)).replace(
      /^orig\//,
      "",
    );
    if (/^(pbs|video)\.twimg\.com\//.test(decoded)) return `https://${decoded}`;
    if (
      /^(media|card_img|profile_images|profile_banners|ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)\//.test(
        decoded,
      )
    )
      return `https://pbs.twimg.com/${decoded}`;
    if (/^(ext_tw_video|amplify_video|tweet_video)\//.test(decoded))
      return `https://video.twimg.com/${decoded}`;
  } catch {
    /* An unsupported URL remains unavailable to the bounded downloader. */
  }
  return input;
}

/** Only extract attachments from the requested tweet, never adjacent timeline posts. */
export function tweetMedia(payload: unknown, id: string): import("../../shared/schema.js").Post["media"] {
  const found: import("../../shared/schema.js").Post["media"] = [];
  const visit = (value: any) => {
    if (!value || typeof value !== "object") return;
    if (value.rest_id === id || value.id_str === id) {
      const media = (value.legacy || value).extended_entities?.media;
      for (const item of Array.isArray(media) ? media : []) {
        if (item.type === "photo" && item.media_url_https) found.push({ type: "image", url: item.media_url_https });
        else if (item.type === "video" || item.type === "animated_gif") {
          const variants = (item.video_info?.variants || []).filter((v: any) => v.content_type === "video/mp4" && v.url);
          variants.sort((a: any, b: any) => (a.bitrate || 0) - (b.bitrate || 0));
          found.push({ type: "video", url: variants[0]?.url || "" });
        }
      }
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(payload);
  return found.filter((m, i) => found.findIndex((other) => other.url === m.url && other.type === m.type) === i);
}
