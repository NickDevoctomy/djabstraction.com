#!/usr/bin/env node
// Validates the generated feeds in the built site. Run after the build;
// exits non-zero if either feed is broken, so CI fails before deploying.
//
// Usage: node scripts/validate-feeds.mjs [site_dir]

import fs from "node:fs";
import path from "node:path";
import { XMLParser, XMLValidator } from "fast-xml-parser";

const SITE_DIR = process.argv[2] || "_site";
const ATOM_NS = "http://www.w3.org/2005/Atom";

const errors = [];
const error = (where, msg) => errors.push(`${where}: ${msg}`);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ["item", "entry", "link", "itunes:image", "itunes:category", "psc:chapter"].includes(name)
});

const asArray = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const first = (node, name) => asArray(node?.[name])[0];
const all = (node, name) => asArray(node?.[name]);
const textOf = (node, name) => {
  const el = first(node, name);
  if (el === undefined || el === null) return "";
  return String(typeof el === "object" ? (el["#text"] ?? "") : el).trim();
};
const attrOf = (node, name, attr) => String(first(node, name)?.[`@${attr}`] ?? "").trim();
const inspect = (value) => JSON.stringify(value);

function httpUrl(value) {
  if (!value || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
}

const positiveInt = (value) => /^\d+$/.test(value) && Number(value) > 0;

const RFC822 =
  /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), )?\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{2,4} \d{2}:\d{2}(?::\d{2})? (?:[+-]\d{4}|UT|GMT|[ECMP][SD]T|[A-IK-Z])$/;
const rfc822 = (value) => RFC822.test(value) && !Number.isNaN(Date.parse(value));

const ISO8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;
const iso8601 = (value) => ISO8601.test(value) && !Number.isNaN(Date.parse(value));

function checkImage(where, href) {
  if (httpUrl(href) && /\.(jpe?g|png)$/i.test(href)) return;
  error(where, `<itunes:image href> must be a .jpg or .png URL, got ${inspect(href)}`);
}

function parseXml(file) {
  if (!fs.existsSync(file)) {
    error(file, "file not found (did the build run?)");
    return null;
  }
  const xml = fs.readFileSync(file, "utf8");
  const valid = XMLValidator.validate(xml);
  if (valid !== true) {
    error(file, `not well-formed XML: ${valid.err.msg} (line ${valid.err.line})`);
    return null;
  }
  return parser.parse(xml);
}

function requireText(where, node, name) {
  if (textOf(node, name) === "") error(where, `missing or empty <${name}>`);
}

function checkPodcast(file) {
  const doc = parseXml(file);
  if (!doc) return;
  const rss = doc.rss;
  if (!rss || rss["@version"] !== "2.0") {
    error(file, 'root element must be <rss version="2.0">');
    return;
  }
  const channel = first(rss, "channel");
  if (!channel) return error(file, "missing <channel>");

  for (const name of ["title", "link", "description", "language", "itunes:author"]) requireText(file, channel, name);
  if (!httpUrl(textOf(channel, "link"))) error(file, "channel <link> is not an http(s) URL");
  checkImage(`${file} channel`, attrOf(channel, "itunes:image", "href"));
  if (attrOf(channel, "itunes:category", "text") === "") error(file, "channel has no <itunes:category text>");
  if (!["true", "false"].includes(textOf(channel, "itunes:explicit").toLowerCase())) {
    error(file, "channel <itunes:explicit> must be true or false");
  }

  const items = all(channel, "item");
  if (items.length === 0) error(file, "feed has no <item> entries");

  const seen = {};
  items.forEach((item, i) => {
    const title = textOf(item, "title");
    const where = `${file} item ${i + 1} (${title === "" ? "untitled" : title})`;

    requireText(where, item, "title");
    requireText(where, item, "description");

    const unique = {
      guid: textOf(item, "guid"),
      "enclosure url": attrOf(item, "enclosure", "url"),
      "itunes:episode": textOf(item, "itunes:episode")
    };
    for (const [field, value] of Object.entries(unique)) {
      if (value === "") continue;
      seen[field] ??= {};
      if (Object.hasOwn(seen[field], value)) error(where, `duplicate ${field} ${value} (also ${seen[field][value]})`);
      seen[field][value] = `item ${i + 1}`;
    }

    if (textOf(item, "guid") === "") error(where, "missing <guid>");
    if (!httpUrl(textOf(item, "link"))) error(where, "<link> is not an http(s) URL");

    const pubDate = textOf(item, "pubDate");
    if (!rfc822(pubDate)) error(where, `<pubDate> is not an RFC 822 date: ${inspect(pubDate)}`);

    const enclosure = first(item, "enclosure");
    if (enclosure === undefined) {
      error(where, "missing <enclosure>");
    } else {
      if (!httpUrl(String(enclosure["@url"] ?? ""))) error(where, "<enclosure url> is not an http(s) URL");
      if (!positiveInt(String(enclosure["@length"] ?? ""))) error(where, "<enclosure length> must be a positive integer");
      if (enclosure["@type"] !== "audio/mpeg") error(where, "<enclosure type> must be audio/mpeg");
    }

    if (!positiveInt(textOf(item, "itunes:duration"))) error(where, "<itunes:duration> must be a positive number of seconds");
    if (!positiveInt(textOf(item, "itunes:episode"))) error(where, "<itunes:episode> must be a positive integer");

    checkImage(where, attrOf(item, "itunes:image", "href"));

    let previousStart = -1;
    all(first(item, "psc:chapters"), "psc:chapter").forEach((chapter, c) => {
      const start = String(chapter["@start"] ?? "");
      if (!/^\d{1,2}:\d{2}:\d{2}(\.\d+)?$/.test(start)) {
        error(where, `chapter ${c + 1} start ${inspect(start)} is not HH:MM:SS`);
        return;
      }
      const [h, m, s] = start.split(":").map(Number);
      const seconds = h * 3600 + m * 60 + s;
      if (seconds < previousStart) error(where, `chapter ${c + 1} starts before the previous chapter`);
      previousStart = seconds;
      if (String(chapter["@title"] ?? "").trim() === "") error(where, `chapter ${c + 1} has an empty title`);
      const href = String(chapter["@href"] ?? "");
      if (href !== "" && !httpUrl(href)) error(where, `chapter ${c + 1} href ${inspect(href)} is not an http(s) URL`);
    });
  });

  console.log(`${file}: ${items.length} items checked`);
}

function checkIso8601(where, value) {
  if (!iso8601(value)) error(where, `<updated> is not an ISO 8601 date: ${inspect(value)}`);
}

function checkAtom(file) {
  const doc = parseXml(file);
  if (!doc) return;
  const feed = doc.feed;
  if (!feed || feed["@xmlns"] !== ATOM_NS) {
    error(file, "root element must be an Atom <feed>");
    return;
  }

  for (const name of ["id", "title", "updated"]) requireText(file, feed, name);
  checkIso8601(file, textOf(feed, "updated"));

  const entries = all(feed, "entry");
  if (entries.length === 0) error(file, "feed has no <entry> elements");

  const ids = new Set();
  entries.forEach((entry, i) => {
    const where = `${file} entry ${i + 1}`;
    const id = textOf(entry, "id");
    if (id === "") error(where, "missing <id>");
    if (ids.has(id)) error(where, `duplicate <id> ${id}`);
    ids.add(id);
    requireText(where, entry, "title");
    checkIso8601(where, textOf(entry, "updated"));
    if (!httpUrl(attrOf(entry, "link", "href"))) error(where, "<link href> is not an http(s) URL");
  });

  console.log(`${file}: ${entries.length} entries checked`);
}

checkPodcast(path.join(SITE_DIR, "feed", "podcast.xml"));
checkAtom(path.join(SITE_DIR, "feed.xml"));

if (errors.length > 0) {
  for (const e of errors) console.log(`::error::${e}`);
  console.log(`Feed validation failed with ${errors.length} error(s).`);
  process.exit(1);
}
console.log("Feeds OK.");
