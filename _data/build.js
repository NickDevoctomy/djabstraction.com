import { execSync } from "node:child_process";
import site from "./site.js";

// The version shown in the footer, linked to GitHub.
// Deploys run from a v* tag (GITHUB_REF_NAME). Other builds use the tag on
// HEAD if there is one, else the short commit hash.
function git(args) {
  try {
    return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

export default function () {
  const ref = process.env.GITHUB_REF_NAME ?? "";
  const tag = ref.startsWith("v") ? ref : git("describe --tags --exact-match HEAD");
  if (tag) return { version: tag, versionUrl: `${site.repo_url}/releases/tag/${tag}` };

  const sha = process.env.GITHUB_SHA?.slice(0, 7) || git("rev-parse --short HEAD");
  if (sha) return { version: sha, versionUrl: `${site.repo_url}/commit/${sha}` };

  return { version: "", versionUrl: "" };
}
