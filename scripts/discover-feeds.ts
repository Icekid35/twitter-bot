import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { download } from "../server/utils/network.js";
import { parseFeed } from "../server/monitoring/rss.js";
// Candidates from the upstream and community directories. A listing is never treated as proof of health.
const candidates = [
  "nitter.meowing.monster",
  "nitter.jaydenha.uk",
  "x.n0g.xyz",
  "tw.eir-nya.gay",
  "nitter.net",
  "xcancel.com",
  "nitter.poast.org",
  "nitter.privacyredirect.com",
  "nitter.tiekoetter.com",
  "nuku.trabun.org",
  "nitter.catsarch.com",
  "nitter.kareem.one",
  "lightbrd.com",
  "nitter.space",
  "nitter.miningtcup.me",
  "shitter.thepixora.com",
  "nitter.click",
  "nt.vern.cc",
  "nitter.xitter.cc",
];
interface Sample {
  username: string;
  ok: boolean;
  ms: number;
  count?: number;
  latest?: string;
  error?: string;
  status?: number;
}
interface Candidate {
  host: string;
  samples: Sample[];
  averageMs: number;
  healthy: boolean;
}
async function probe(host: string, username: string): Promise<Sample> {
  const start = Date.now();
  try {
    const r = await download(`https://${host}/${username}/rss`, {
      timeout: 18000,
      maxBytes: 3 * 1024 * 1024,
    });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    const posts = parseFeed(r.data.toString("utf8"), username);
    const latest = posts.toSorted(
      (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
    )[0]?.publishedAt;
    const age = latest ? Date.now() - Date.parse(latest) : Infinity;
    if (!posts.length || age > 7 * 86400000 || age < -300000)
      throw new Error("No recent, trustworthy post timestamps.");
    return {
      username,
      ok: true,
      ms: Date.now() - start,
      status: r.status,
      count: posts.length,
      latest,
    };
  } catch (error) {
    return {
      username,
      ok: false,
      ms: Date.now() - start,
      error: (error as Error).message,
    };
  }
}
const results: Candidate[] = [];
for (let i = 0; i < candidates.length; i += 3) {
  await Promise.all(
    candidates.slice(i, i + 3).map(async (host) => {
      const samples = [];
      for (const username of ["nasa", "github"])
        samples.push(await probe(host, username));
      const healthy = samples.every((s) => s.ok);
      results.push({
        host,
        samples,
        healthy,
        averageMs: samples.reduce((n, s) => n + s.ms, 0) / samples.length,
      });
      console.log(
        `${host}: ${healthy ? "RSS passed" : "unavailable"} (${samples.map((s) => (s.ok ? `${s.ms} ms` : s.error)).join("; ")})`,
      );
    }),
  );
}
const finalists = results
  .filter((r) => r.healthy)
  .sort((a, b) => a.averageMs - b.averageMs);
for (const candidate of finalists) {
  candidate.samples.push(await probe(candidate.host, "elonmusk"));
  candidate.healthy = candidate.samples.every((s) => s.ok);
  candidate.averageMs =
    candidate.samples.reduce((n, s) => n + s.ms, 0) / candidate.samples.length;
}
const healthy = finalists
  .filter((r) => r.healthy)
  .sort((a, b) => a.averageMs - b.averageMs);
const selected = healthy[0]?.host || null,
  fallback = healthy[1]?.host || null;
const report = {
  checkedAt: new Date().toISOString(),
  sources: [
    "https://github.com/zedeus/nitter/wiki/Instances",
    "https://codeberg.org/mv12star/shitter/wiki/Instances",
  ],
  selected,
  fallback,
  method:
    "Require recent valid feeds for three public accounts; rank passing candidates by mean request duration. No cookies or browser access.",
  results,
};
const dir = path.resolve(process.env.DATA_DIR || "data");
mkdirSync(dir, { recursive: true, mode: 0o700 });
writeFileSync(
  path.join(dir, "instance-selection.json"),
  JSON.stringify(report, null, 2),
  { mode: 0o600 },
);
if (!selected) {
  console.error(
    "No healthy source found. Existing configuration was left unchanged.",
  );
  process.exitCode = 1;
} else {
  console.log(
    `Primary: https://${selected}; fallback: ${fallback ? "https://" + fallback : "none passed"}`,
  );
  if (process.argv.includes("--apply")) {
    const response = await fetch(
      `http://127.0.0.1:${process.env.PORT || 4318}/api/settings`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Signaldesk": "1" },
        body: JSON.stringify({
          feedProvider: "nitter",
          feedUrl: `https://${selected}`,
          mirrorUrl: `https://${selected}`,
          fallbackFeedUrl: fallback ? `https://${fallback}/{username}/rss` : "",
          verificationProvider: "rss",
        }),
      },
    );
    if (!response.ok)
      throw new Error(
        "Sources passed but could not be saved. Start the local server and retry.",
      );
    console.log(
      "Verified sources saved through the API. Automation state unchanged.",
    );
  }
}
