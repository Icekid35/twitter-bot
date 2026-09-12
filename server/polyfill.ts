// Polyfill Web APIs for environments running Node < 20
import * as bufferModule from "node:buffer";
if (typeof globalThis.File === "undefined" && "File" in bufferModule) {
  (globalThis as Record<string, unknown>).File = (bufferModule as Record<string, unknown>).File;
}
if (typeof globalThis.FormData === "undefined" && "FormData" in bufferModule) {
  (globalThis as Record<string, unknown>).FormData = (bufferModule as Record<string, unknown>).FormData;
}
