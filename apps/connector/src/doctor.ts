import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ConnectorConfig } from "./config.js";

export async function connectorDoctor(config: ConnectorConfig): Promise<void> {
  await mkdir(dirname(config.stateFile), { recursive: true, mode: 0o700 });
  await access(dirname(config.stateFile), constants.R_OK | constants.W_OK);
  await command(config.openclawExecutable, ["--version"]);
  console.log("connector configuration is valid");
  console.log(`relay: ${new URL(config.relayUrl).origin}`);
  console.log(`state: ${config.stateFile}`);
  console.log("openclaw executable is available");
}

function command(executable: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${executable} health check timed out`));
    }, 10_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(
          new Error(`${executable} --version exited with ${code ?? "signal"}`),
        );
    });
  });
}
