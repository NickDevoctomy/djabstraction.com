#!/usr/bin/env node
// Compares two copies of a feed (Atom or podcast RSS) semantically and exits
// non-zero on any difference that isn't allowed. Each side is a file path or
// an http(s) URL.
//
// Allowed to differ: build-time fields (Atom <updated> on the feed, RSS
// <lastBuildDate>, <generator>), how a date is written as long as it is the
// same instant, and whitespace / line endings.
//
// Usage:
//   node scripts/compare-feeds.mjs <new> <reference>
//   node scripts/compare-feeds.mjs        # _site feeds against the live site

import fs from "node:fs";
import { XMLParser, XMLValidator } from "fast-xml-parser";

const LIVE = "https://www.djabstraction.com";

const IGNORED = new Set([
  "feed.updated",
  "feed.generator",
  "rss.channel.lastBuildDate",
  "rss.channel.generator"
]);
const DATE_FIELDS = new Set(["published", "updated", "pubDate", "lastBuildDate"]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  ignoreDeclaration: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name, jpath, isLeaf, isAttribute) => !isAttribute
});

async function load(source) {
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`${source}: HTTP ${response.status}`);
    return response.text();
  }
  return fs.readFileSync(source, "utf8");
}

function parse(source, xml) {
  const valid = XMLValidator.validate(xml);
  if (valid !== true) throw new Error(`${source}: not well-formed XML: ${valid.err.msg} (line ${valid.err.line})`);
  return parser.parse(xml);
}

// Whitespace and line endings don't count, including between tags in HTML
// content.
const normalise = (value) => String(value).replace(/\s+/g, " ").replace(/> </g, "><").trim();

const show = (value) => {
  const text = value === undefined ? "(missing)" : JSON.stringify(typeof value === "string" ? normalise(value) : value);
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
};

function compare(a, b, path, key, diffs) {
  // Paths for IGNORED leave out array indexes: "rss.channel.generator".
  const plainPath = path.replace(/\[\d+\]/g, "");
  if (IGNORED.has(plainPath)) return;

  if (Array.isArray(a) || Array.isArray(b)) {
    const left = Array.isArray(a) ? a : [];
    const right = Array.isArray(b) ? b : [];
    if (left.length !== right.length) diffs.push(`${path}: ${left.length} vs ${right.length} element(s)`);
    for (let i = 0; i < Math.min(left.length, right.length); i++) compare(left[i], right[i], `${path}[${i}]`, key, diffs);
    return;
  }

  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      compare(a[k], b[k], path ? `${path}.${k}` : k, k, diffs);
    }
    return;
  }

  if (a === undefined || b === undefined || typeof a === "object" || typeof b === "object") {
    if (normalise(JSON.stringify(a)) !== normalise(JSON.stringify(b))) diffs.push(`${path}: ${show(a)} vs ${show(b)}`);
    return;
  }

  const field = key === "#text" ? path.replace(/\[\d+\]/g, "").split(".").at(-2) : key;
  if (DATE_FIELDS.has(field)) {
    const left = Date.parse(a);
    const right = Date.parse(b);
    if (Number.isNaN(left) || Number.isNaN(right) || left !== right) diffs.push(`${path}: ${show(a)} vs ${show(b)} (different instant)`);
    return;
  }

  if (normalise(a) !== normalise(b)) diffs.push(`${path}: ${show(a)} vs ${show(b)}`);
}

function summarise(doc) {
  if (doc.feed) return `Atom, ${doc.feed[0].entry?.length ?? 0} entries`;
  if (doc.rss) return `RSS, ${doc.rss[0].channel?.[0].item?.length ?? 0} items`;
  return "unknown feed type";
}

async function comparePair(newSource, refSource) {
  const [newDoc, refDoc] = [parse(newSource, await load(newSource)), parse(refSource, await load(refSource))];
  const diffs = [];
  compare(newDoc, refDoc, "", "", diffs);
  console.log(`${newSource} (${summarise(newDoc)}) vs ${refSource} (${summarise(refDoc)})`);
  for (const d of diffs) console.log(`  DIFF ${d}`);
  console.log(diffs.length === 0 ? "  match" : `  ${diffs.length} difference(s)`);
  return diffs.length;
}

const args = process.argv.slice(2);
if (args.length !== 0 && args.length !== 2) {
  console.error("Usage: node scripts/compare-feeds.mjs [<new> <reference>]");
  process.exit(2);
}
const pairs =
  args.length === 2
    ? [args]
    : [
        ["_site/feed.xml", `${LIVE}/feed.xml`],
        ["_site/feed/podcast.xml", `${LIVE}/feed/podcast.xml`]
      ];

let total = 0;
try {
  for (const [newSource, refSource] of pairs) total += await comparePair(newSource, refSource);
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
process.exit(total === 0 ? 0 : 1);
