"use strict";
const fs = require("node:fs/promises");
const { existsSync } = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const lock = require("../../../internal/platform/computer/cua-driver.lock.json");

function artifact(platform, arch) {
  const key = platform === "darwin" ? "darwin-universal" : `${platform}-${arch}`;
  const selected = lock.artifacts[key];
  if (!selected) throw new Error(`No pinned CUA artifact for ${key}`);
  return selected;
}

async function locate(dir, name) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const candidate = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === name) return candidate;
    if (entry.isDirectory()) { const found = await locate(candidate, name); if (found) return found; }
  }
  return null;
}

function targetArchitecture(goarch, nativeArch) {
  if (!goarch) return nativeArch;
  if (goarch === "amd64") return "x64";
  if (goarch === "arm64") return "arm64";
  throw new Error(`Unsupported CUA target architecture ${goarch}`);
}

// The version a driver already in bin/ reports, or "" when it cannot say. An
// install that predates the stamp is adopted by this rather than re-fetched:
// the pinned release is identified by the version it prints.
function installedVersion(binary) {
  const run = spawnSync(binary, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 10000 });
  if (run.status !== 0) return "";
  const match = /\b(\d+\.\d+\.\d+)\b/.exec(run.stdout ?? "");
  return match ? match[1] : "";
}

// downloadArtifact fetches the pinned release asset and returns its bytes, so
// a caller can stand in for the network: the digest check belongs to install.
async function downloadArtifact(selected) {
  const url = `https://github.com/${lock.repository}/releases/download/${lock.tag}/${selected.name}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`CUA download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 128 * 1024 * 1024) throw new Error("CUA artifact exceeds size limit");
  if (crypto.createHash("sha256").update(bytes).digest("hex") !== selected.sha256) throw new Error("CUA artifact SHA-256 mismatch");
  return bytes;
}

async function install(platform = process.platform, arch = targetArchitecture(process.env.REASONIX_GOARCH, process.arch), into = path.resolve(__dirname, "../bin"), probe = installedVersion, fetchArtifact = downloadArtifact) {
  const selected = artifact(platform, arch);
  const name = platform === "win32" ? "cua-driver.exe" : "cua-driver";
  const bin = into;
  const destination = path.join(bin, name);
  // What is in bin/ is this download's output, so the stamp recording which
  // artifact produced it is enough to skip the ~100 MB fetch on every build.
  const stamp = destination + ".artifact";
  const wanted = `${selected.name} ${selected.sha256}`;
  if (existsSync(destination)) {
    try {
      if ((await fs.readFile(stamp, "utf8")).trim() === wanted) return destination;
    } catch {}
    if (probe(destination) === lock.version) {
      await fs.writeFile(stamp, wanted);
      return destination;
    }
  }
  const tempRoot = path.resolve(os.tmpdir());
  const stage = await fs.mkdtemp(path.join(tempRoot, "reasonix-cua-"));
  try {
    const bytes = await fetchArtifact(selected);
    const archive = path.join(stage, selected.name);
    await fs.writeFile(archive, bytes);
    const extracted = path.join(stage, "extracted");
    await fs.mkdir(extracted);
    extract(archive, extracted);
    const source = await locate(extracted, name);
    if (!source) throw new Error("CUA artifact contains no driver executable");
    await fs.mkdir(bin, { recursive: true });
    await fs.copyFile(source, destination);
    if (platform !== "win32") await fs.chmod(destination, 0o755);
    await fs.writeFile(stamp, wanted);
    return destination;
  } finally {
    if (!path.resolve(stage).startsWith(tempRoot + path.sep)) throw new Error("Invalid CUA staging path");
    await fs.rm(stage, { recursive: true, force: true });
  }
}

function extract(archive, extracted) {
  const cwd = path.dirname(archive);
  const tar = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:/Windows", "System32", "tar.exe") : "tar";
  const result = spawnSync(tar, ["-xf", path.basename(archive), "-C", path.relative(cwd, extracted)], { cwd, stdio: "inherit", windowsHide: true });
  if (result.status !== 0) throw new Error("CUA extraction failed");
}

module.exports = { artifact, install, targetArchitecture, extract };
if (require.main === module) install().then(file => process.stdout.write(`Installed pinned CUA Driver ${lock.version}: ${file}\n`)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
