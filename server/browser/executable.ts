import { existsSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";
export async function browserExecutable() {
  if (process.env.CHROME_EXECUTABLE_PATH)
    return process.env.CHROME_EXECUTABLE_PATH;
  const bundled = await puppeteer.executablePath();
  if (existsSync(bundled)) return bundled;
  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
      : process.platform === "win32"
        ? [
            path.join(
              process.env.PROGRAMFILES || "C:\\Program Files",
              "Google/Chrome/Application/chrome.exe",
            ),
            path.join(
              process.env.LOCALAPPDATA || "",
              "Google/Chrome/Application/chrome.exe",
            ),
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
          ];
  return candidates.find(existsSync);
}
