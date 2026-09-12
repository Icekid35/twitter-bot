import test from "node:test";
import assert from "node:assert/strict";
import { tweetMedia } from "../server/utils/media.js";
import { Gemini } from "../server/ai/gemini.js";
import type { Store } from "../server/database/store.js";
test("tweet media resolves playable video variants and excludes other posts", () => {
  const payload = { entries: [
    { rest_id: "other", legacy: { extended_entities: { media: [{type: "photo", media_url_https: "https://pbs.twimg.com/other.jpg"}] } } },
    { rest_id: "123", legacy: { extended_entities: { media: [
      { type: "photo", media_url_https: "https://pbs.twimg.com/image.jpg" },
      { type: "video", video_info: { variants: [
        { content_type: "application/x-mpegURL", url: "https://video.twimg.com/stream.m3u8" },
        { content_type: "video/mp4", bitrate: 2000, url: "https://video.twimg.com/large.mp4" },
        { content_type: "video/mp4", bitrate: 500, url: "https://video.twimg.com/small.mp4" },
      ] } },
    ] } } },
  ] };
  assert.deepEqual(tweetMedia(payload, "123"), [
    {type: "image", url: "https://pbs.twimg.com/image.jpg"},
    {type: "video", url: "https://video.twimg.com/small.mp4"},
  ]);
});
test("empty media posts cannot generate invented replies", async () => {
  const ai = new Gemini({settings: () => ({replyLength: "short"}), secret: () => "fixture-key"} as unknown as Store);
  await assert.rejects(ai.generate({id: "1", author: "alice", url: "https://x.com/alice/status/1", type: "original", text: "", media: [], publishedAt: new Date().toISOString()}), /no readable text or attachments/);
});
