import https from "node:https";
import { lookup } from "node:dns/promises";
import { AppError } from "./errors.js";
export function isPublicAddress(ip: string) {
  return (
    !/^(127\.|10\.|192\.168\.|169\.254\.|0\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|172\.(1[6-9]|2\d|3[01])\.|19[28]\.0\.|198\.(1[89])\.|22[4-9]\.|2[3-5]\d\.)/.test(
      ip,
    ) && !ip.includes(":")
  );
}
export async function download(
  url: string,
  {
    maxBytes = 8 * 1024 * 1024,
    timeout = 30000,
    hosts,
    redirects = 2,
  }: {
    maxBytes?: number;
    timeout?: number;
    hosts?: string[];
    redirects?: number;
  } = {},
): Promise<{ data: Buffer; mime: string; status: number }> {
  const target = new URL(url);
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    (target.port && target.port !== "443") ||
    (hosts && !hosts.includes(target.hostname))
  )
    throw new AppError("UNSAFE_URL", "This resource address is not permitted.");
  const addresses = await lookup(target.hostname, {
    all: true,
    family: 4,
  }).catch(() => {
    throw new AppError(
      "NETWORK",
      "Could not resolve the service address.",
      503,
      true,
    );
  });
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new AppError(
      "UNSAFE_URL",
      "Private network resources are not permitted.",
    );
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (e: Error) => {
      if (!settled) {
        settled = true;
        reject(e);
      }
    };
    const req = https.get(
      target,
      {
        family: 4,
        lookup: (_host, _options, callback) =>
          callback(null, addresses[0].address, 4),
        headers: { "User-Agent": "Signaldesk/1.0", Accept: "*/*" },
      },
      (res) => {
        const status = res.statusCode || 500;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (!redirects) {
            fail(new AppError("REDIRECT", "Too many service redirects.", 503));
            return;
          }
          settled = true;
          download(new URL(res.headers.location, target).href, {
            maxBytes,
            timeout,
            hosts,
            redirects: redirects - 1,
          }).then(resolve, reject);
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy();
            fail(
              new AppError("MEDIA_SIZE", "Resource exceeds the size limit."),
            );
          } else chunks.push(chunk);
        });
        res.on("error", () =>
          fail(
            new AppError(
              "NETWORK",
              "The service connection was interrupted.",
              503,
              true,
            ),
          ),
        );
        res.on("end", () => {
          if (!settled) {
            settled = true;
            resolve({
              data: Buffer.concat(chunks),
              mime: String(res.headers["content-type"] || "").split(";")[0],
              status,
            });
          }
        });
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      fail(
        new AppError(
          "TIMEOUT",
          "The service took too long to respond.",
          504,
          true,
        ),
      );
    }, timeout);
    req.on("close", () => clearTimeout(timer));
    req.on("error", () =>
      fail(
        new AppError("NETWORK", "The service could not be reached.", 503, true),
      ),
    );
  });
}
