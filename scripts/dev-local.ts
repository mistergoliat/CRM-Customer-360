import { spawn } from "node:child_process";
import { loadLocalEnv } from "./db-utils";

async function main() {
  await loadLocalEnv();

  const child = spawn("npm", ["run", "dev"], {
    stdio: "inherit",
    env: process.env,
    shell: true
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 0;
  });

  child.on("error", (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
