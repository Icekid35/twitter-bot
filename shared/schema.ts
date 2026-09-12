import { z } from "zod";
export const accountSettingsSchema = z
  .object({
    monitoring: z.boolean().default(true),
    reply: z.boolean().default(false),
    like: z.boolean().default(false),
    repost: z.boolean().default(false),
    original: z.boolean().default(true),
    replies: z.boolean().default(false),
    reposts: z.boolean().default(false),
    quote: z.boolean().default(false),
    interval: z.number().min(0.5).max(1440).nullable().default(null),
    prompt: z.string().max(8000).default(""),
  })
  .strict();
export type AccountSettings = z.infer<typeof accountSettingsSchema>;
export const settingsSchema = z
  .object({
    interval: z.number().min(0.5).max(1440).default(10),
    repliesPerHour: z.number().int().min(0).max(100).default(10),
    likesPerHour: z.number().int().min(0).max(300).default(30),
    repostsPerHour: z.number().int().min(0).max(100).default(10),
    actionsPerDay: z.number().int().min(0).max(1000).default(100),
    retries: z.number().int().min(0).max(3).default(2),
    timeout: z.number().int().min(15000).max(120000).default(45000),
    readOnlyWhenPaused: z.boolean().default(false),
    model: z
      .string()
      .regex(/^[a-zA-Z0-9.\-_]+$/)
      .max(100)
      .default("gemini-3.5-flash"),
    prompt: z
      .string()
      .min(10)
      .max(8000)
      .default(
        `You are a sharp, active human user on X (Twitter). Write a single authentic, natural reply to the post.

STYLE & TONE:
        - Write like a thoughtful peer scrolling their feed on mobile: casual yet insightful, engaging, and direct.
- React directly to the core idea, tension, or nuance of the post.Avoid summarizing or repeating what the author said.
- Use natural conversational phrasing, varied sentence lengths, and genuine reactions(e.g.slight skepticism, dry humor, sharp observation, or a constructive angle).
- If appropriate, end with a brief open thought or question, or make a punchy standalone observation.

CRITICAL FORMATTING RULES:
      - PLAIN TEXT ONLY.Never use markdown: absolutely NO bold(**), italics (*), bullet points, numbered lists, quotation marks, or emojis - as - bullet - points.
- No hashtags(#), no mentions(@), and no URLs or links.
- Use at most one natural emoji, or none at all.
- NEVER sound like an AI assistant.Ban all generic praise and buzzwords: "Great insights!", "Couldn't agree more!", "This is a game changer!", "Fascinating perspective!", "Spot on!", "Delve", "Crucial", "Landscape".
- Do not make up personal anecdotes, fake credentials, or claim "I just tested this yesterday".

  COMPLETION & LENGTH:
- Keep the reply strictly between 1 to 3 compact sentences.
- Always finish the thought completely with proper closing punctuation(period, question mark).Never trail off, leave an incomplete sentence, or get cut off.
`,
      ),
replyLength: z
  .enum(["very-short", "short", "medium", "custom"])
  .default("short"),
  maxLength: z.number().int().min(20).max(280).default(180),
    verificationProvider: z.enum(["nitter", "rss", "x"]).default("nitter"),
      mirrorUrl: z.string().max(300).default(""),
        feedProvider: z.enum(["nitter", "rsshub"]).default("nitter"),
          feedUrl: z.string().max(500).default(""),
            fallbackFeedUrl: z.string().max(500).default(""),
              logLevel: z.enum(["INFO", "WARNING", "ERROR"]).default("INFO"),
                retentionDays: z.number().int().min(7).max(3650).default(90),
  })
  .strict();
export type Settings = z.infer<typeof settingsSchema>;
export type PostType = "original" | "reply" | "repost" | "quote" | "unknown";
export interface Post {
  id: string;
  author: string;
  text: string;
  url: string;
  publishedAt: string;
  type: PostType;
  quotedText?: string;
  media: { url: string; type: "image" | "video" }[];
}
export interface Account {
  id: number;
  username: string;
  displayName: string;
  avatar: string;
  bio: string;
  url: string;
  verified: boolean;
  verification: string;
  settings: AccountSettings;
  addedAt: string;
  baselineAt: string | null;
  lastChecked: string | null;
  lastPost: string | null;
  lastSuccess: string | null;
  nextScan: string;
  failures: number;
  error: string | null;
}
export type ActionType = "reply" | "like" | "repost";
export type ActionStatus =
  "reserved" | "running" | "succeeded" | "failed" | "uncertain" | "skipped";
export interface Action {
  id: number;
  actor: string;
  postId: string;
  type: ActionType;
  status: ActionStatus;
  reply: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  resultUrl: string | null;
}
export interface Activity {
  id: number;
  accountId: number;
  username: string;
  post: Post;
  detectedAt: string;
  status: string;
  reason: string | null;
  duration: number;
  generation: Generation | null;
  actions: Action[];
}
export interface Generation {
  text: string;
  context: string;
  mediaStatus: string;
  mediaErrors: string[];
  tokens: number;
  model: string;
  duration: number;
}
export interface Session {
  status: string;
  username: string | null;
  checkedAt: string | null;
  message: string;
  configured: boolean;
}
