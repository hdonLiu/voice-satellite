import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";

const version = "1.9.1";
const model = "base-q5_1";
const installRoot = "/opt/whisper";
const versionRoot = join(installRoot, `whisper-${version}`);
const archivePath = join(
  installRoot,
  `whisper-bin-ubuntu-x64-${version}.tar.gz`,
);
const modelPath = join("/models", `ggml-${model}.bin`);

const binary = {
  url:
    process.env.WHISPER_CPP_ARCHIVE_URL ||
    `https://github.com/ggml-org/whisper.cpp/releases/download/v${version}/whisper-bin-ubuntu-x64.tar.gz`,
  sha256: "f3bf3b4369a99b54665b0f19b88483b30de27f25963b0414235dea03198515c5",
  bytes: 9_379_235,
};

const modelAsset = {
  // ModelScope is used as a China-reachable mirror. The checksum and size are
  // the canonical ggerganov/whisper.cpp Hugging Face LFS values.
  url:
    process.env.WHISPER_MODEL_URL ||
    `https://www.modelscope.cn/models/iceCream2025/whisper.cpp/resolve/master/ggml-${model}.bin`,
  sha256: "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898",
  bytes: 59_707_625,
};

await mkdir(installRoot, { recursive: true });
await mkdir("/models", { recursive: true });
await downloadVerified(binary, archivePath);
await downloadVerified(modelAsset, modelPath);

if (!(await exists(join(versionRoot, ".ready")))) {
  await rm(versionRoot, { recursive: true, force: true });
  await mkdir(versionRoot, { recursive: true });
  execFileSync("tar", ["-xzf", archivePath, "-C", versionRoot], {
    stdio: "inherit",
  });
  const files = await walk(versionRoot);
  const server = files.find((file) => basename(file) === "whisper-server");
  if (!server)
    throw new Error("whisper-server was not found in release archive");
  await chmod(server, 0o755);
  const libraryDirs = [
    ...new Set(
      files
        .filter((file) => /\.so(?:\.\d+)*$/.test(file))
        .map((file) => dirname(file)),
    ),
  ];
  const wrapper = `#!/bin/sh\nexport LD_LIBRARY_PATH=${libraryDirs.join(":")}\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}\nexec ${server} "$@"\n`;
  await writeFile(join(versionRoot, "run-server"), wrapper, { mode: 0o755 });
  await writeFile(join(versionRoot, ".ready"), `${version}\n`);
}

await rm(join(installRoot, "run-server"), { force: true });
await symlink(join(versionRoot, "run-server"), join(installRoot, "run-server"));
console.log(`whisper.cpp ${version} and ${model} model are ready`);

async function downloadVerified(asset, destination) {
  if (await matches(destination, asset)) {
    console.log(`${basename(destination)} already verified`);
    return;
  }
  const partial = `${destination}.partial`;
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      let offset = await fileSize(partial);
      if (offset > asset.bytes) {
        await rm(partial, { force: true });
        offset = 0;
      }
      console.log(
        `downloading ${basename(destination)} (attempt ${attempt}, offset ${offset})`,
      );
      const response = await fetch(asset.url, {
        redirect: "follow",
        headers: offset > 0 ? { range: `bytes=${offset}-` } : {},
      });
      if (!response.ok || !response.body) {
        throw new Error(`download returned HTTP ${response.status}`);
      }
      const resumed = offset > 0 && response.status === 206;
      if (offset > 0 && !resumed) {
        await rm(partial, { force: true });
        offset = 0;
      }
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(partial, { flags: resumed ? "a" : "w" }),
      );
      const downloaded = await fileSize(partial);
      if (downloaded < asset.bytes) {
        throw new Error(
          `download stopped at ${downloaded} of ${asset.bytes} bytes`,
        );
      }
      if (downloaded > asset.bytes || !(await matches(partial, asset))) {
        await rm(partial, { force: true });
        throw new Error(
          "download size or SHA-256 mismatch; partial file reset",
        );
      }
      await rename(partial, destination);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 4)
        await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    }
  }
  throw lastError;
}

async function fileSize(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function matches(path, asset) {
  try {
    if ((await stat(path)).size !== asset.bytes) return false;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest("hex") === asset.sha256;
  } catch {
    return false;
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function walk(root) {
  const output = [];
  const stack = [root];
  while (stack.length > 0) {
    const directory = stack.pop();
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile()) output.push(path);
    }
  }
  return output;
}
