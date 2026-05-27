import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { waitForHttp } from "./wait-for-http.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPOSE_FILE = path.join(__dirname, "..", "docker-compose.yml");

export async function dockerAvailable() {
  return new Promise((resolve) => {
    const proc = spawn("docker", ["info"], { stdio: "ignore" });
    proc.on("error", () => resolve(false));
    proc.on("exit", (code) => resolve(code === 0));
  });
}

export async function bootPhoenix({ bootTimeoutMs = 180_000 } = {}) {
  const ok = await dockerAvailable();
  if (!ok) {
    return { skipped: true, reason: "Docker is not available" };
  }
  let bootTimer;
  try {
    const bootWork = (async () => {
      await new Promise((resolve, reject) => {
        const proc = spawn(
          "docker",
          ["compose", "-f", COMPOSE_FILE, "up", "-d", "--wait"],
          { stdio: "inherit" },
        );
        proc.on("error", reject);
        proc.on("exit", (code) =>
          code === 0 ? resolve() : reject(new Error(`compose up exited ${code}`)),
        );
      });
      await waitForHttp("http://127.0.0.1:6006/health", { timeoutMs: bootTimeoutMs });
    })();
    const bootDeadline = new Promise((_, reject) => {
      bootTimer = setTimeout(() => reject(new Error("Phoenix boot timed out")), bootTimeoutMs);
    });
    await Promise.race([bootWork, bootDeadline]);
    return { skipped: false };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { skipped: true, reason: message };
  } finally {
    if (bootTimer !== undefined) clearTimeout(bootTimer);
  }
}

export async function tearDownPhoenix() {
  const ok = await dockerAvailable();
  if (!ok) return;
  await new Promise((resolve) => {
    const proc = spawn("docker", ["compose", "-f", COMPOSE_FILE, "down"], { stdio: "inherit" });
    proc.on("exit", () => resolve());
    proc.on("error", () => resolve());
  });
}
