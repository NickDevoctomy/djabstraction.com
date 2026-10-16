// Helpers that reproduce Jekyll 4 / Ruby Liquid behaviour, so the Eleventy
// build outputs the same HTML and feeds as the old Jekyll build did.

import fs from "node:fs";
import { DateTime } from "luxon";
import markdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";

export const TIMEZONE = "Europe/London";

// --- Markdown (kramdown-alike) ---------------------------------------------

// kramdown's auto heading id: drop leading non-letters, keep [a-zA-Z0-9 -],
// spaces become dashes, lower-case. "DJ A - B" -> "dj-a---b".
function kramdownSlug(text) {
  const id = text
    .replace(/^[^a-zA-Z]+/, "")
    .replace(/[^a-zA-Z0-9 -]/g, "")
    .replace(/ /g, "-")
    .toLowerCase();
  return id || "section";
}

export const markdown = markdownIt({ html: true, xhtmlOut: true, typographer: true })
  .use(markdownItAnchor, { slugify: kramdownSlug, tabIndex: false });

// kramdown keeps a blank line between top-level blocks wherever the source
// had one; markdown-it doesn't. The difference matters where text is cut to a
// length, e.g. the podcast feed's <itunes:subtitle>.
markdown.render = function (src, env = {}) {
  const blocks = [];
  for (const token of markdown.parse(src, env)) {
    if (token.level === 0 && token.nesting >= 0) blocks.push({ tokens: [], map: token.map });
    blocks.at(-1).tokens.push(token);
  }
  return blocks
    .map((block, i) => {
      const html = markdown.renderer.render(block.tokens, markdown.options, env);
      const previous = blocks[i - 1];
      return previous?.map && block.map && block.map[0] > previous.map[1] ? `
${html}` : html;
    })
    .join("");
};

// --- Posts -----------------------------------------------------------------

// Jekyll's post excerpt: the raw source up to the first "\n\n", rendered as
// Markdown. The split is on the raw file, so a post saved with CRLF line
// endings has no "\n\n" and its whole content becomes the excerpt.
export function jekyllExcerpt(inputPath) {
  const raw = fs.readFileSync(inputPath, "utf8");
  const match = raw.match(/^(---\s*\n[\s\S]*?\n?)^((---|\.\.\.)\s*$\n?)/m);
  const body = match && match.index === 0 ? raw.slice(match[0].length) : raw;
  return markdown.render(body.split("\n\n")[0]);
}

// --- Liquid filters --------------------------------------------------------

function toDateTime(input) {
  if (input === "now" || input === "today") return DateTime.now().setZone(TIMEZONE);
  if (input instanceof Date) return DateTime.fromJSDate(input, { zone: TIMEZONE });
  if (typeof input === "string" && input.trim()) {
    const dt = DateTime.fromISO(input.trim(), { zone: TIMEZONE });
    if (dt.isValid) return dt;
  }
  return null;
}

const STRFTIME = {
  a: "ccc", A: "cccc", b: "LLL", B: "LLLL", d: "dd", e: "d", H: "HH", I: "hh",
  m: "MM", M: "mm", p: "a", S: "ss", T: "HH:mm:ss", y: "yy", Y: "yyyy", z: "ZZZ",
  "%": "'%'"
};

// Ruby Liquid `date`: strftime in the site timezone. Unparseable input is
// returned unchanged, as Ruby Liquid does.
export function date(input, format) {
  if (!format) return input;
  const dt = toDateTime(input);
  if (!dt) return input;
  return String(format).replace(/%(.)/g, (_, c) => {
    if (!(c in STRFTIME)) throw new Error(`date filter: unsupported directive %${c}`);
    return dt.setLocale("en-US").toFormat(STRFTIME[c]);
  });
}

export function dateToXmlschema(input) {
  const dt = toDateTime(input);
  return dt ? dt.toFormat("yyyy-MM-dd'T'HH:mm:ssZZ") : input;
}

const XML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
export const xmlEscape = (input) => String(input ?? "").replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);

// Ruby Liquid strip_html; unlike liquidjs it also strips tags that span lines.
export const stripHtml = (input) =>
  String(input ?? "")
    .replace(/<script.*?<\/script>|<!--.*?-->|<style.*?<\/style>/gs, "")
    .replace(/<.*?>/gs, "");

export const stripNewlines = (input) => String(input ?? "").replace(/\r?\n/g, "");

export const normalizeWhitespace = (input) => String(input ?? "").replace(/[ \n\r\t\f\v]+/g, " ").trim();

export const numberOfWords = (input) => String(input ?? "").trim().split(/\s+/).filter(Boolean).length;

export function truncate(input, length = 50, ellipsis = "...") {
  if (input == null) return input;
  const chars = Array.from(String(input));
  const max = Number(length);
  if (chars.length <= max) return String(input);
  const keep = Math.max(0, max - Array.from(String(ellipsis)).length);
  return chars.slice(0, keep).join("") + ellipsis;
}

export function truncatewords(input, words = 15, ellipsis = "...") {
  if (input == null) return input;
  const str = String(input);
  const n = Math.max(1, Number(words));
  const list = str.trim().split(/\s+/).filter(Boolean);
  if (list.length <= n) return str;
  return list.slice(0, n).join(" ") + ellipsis;
}

// Ruby integer division floors when both sides are integers.
export function dividedBy(input, operand) {
  const a = Number(input);
  const b = Number(operand);
  return Number.isInteger(a) && Number.isInteger(b) ? Math.floor(a / b) : a / b;
}

// time_seconds (was _plugins/time_to_seconds.rb): "HH:MM:SS" -> total seconds.
export function timeSeconds(input) {
  const [h = 0, m = 0, s = 0] = String(input).split(":").map((x) => parseInt(x, 10) || 0);
  return h * 3600 + m * 60 + s;
}

// Jekyll's smartify (used by jekyll-feed on titles): typographic quotes only.
export function smartify(input) {
  return markdown
    .renderInline(String(input ?? ""))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
