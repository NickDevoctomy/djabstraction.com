// Helpers for the Afterglow templates: cover thumbnails, the mix timeline,
// the player's episode data and the search index.

import Image from "@11ty/eleventy-img";
import { DateTime } from "luxon";
import site from "../_data/site.js";
import { TIMEZONE, stripHtml, normalizeWhitespace, timeSeconds, truncatewords } from "./jekyll.js";

// JSON that is safe inside a <script> element.
export const toJson = (value) => JSON.stringify(value ?? null).replace(/</g, "\\u003c");

// A resized WebP copy of a site image ("/img/podcast/16.jpg"), for cards and
// backdrops. Returns the copy's URL.
export async function cover(src, width = 480) {
  if (!src) return "";
  const stats = await Image(`.${src}`, {
    widths: [Number(width)],
    formats: ["webp"],
    outputDir: "_site/img/generated/",
    urlPath: "/img/generated/"
  });
  return stats.webp[0].url;
}

// "Warmup Sessions 16" for a mix, else the post's own title.
export function mixTitle(post) {
  if (post.layout !== "mix" || !post.subtitle) return post.title;
  return `${site.podcast_shorttitle} ${String(post.subtitle).replace(/^Episode\s*/i, "")}`;
}

// "01:18:32" -> "1h 18m".
export function humanDuration(input) {
  const total = timeSeconds(input);
  const h = Math.floor(total / 3600);
  const m = Math.floor(total / 60) % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

// A mix's tracklist as timeline chapters: start and length in seconds, and
// the start as a percentage of the whole mix.
export function chapters(tracklist, duration) {
  const total = timeSeconds(duration) || 1;
  const list = tracklist ?? [];
  return list.map((track, i) => {
    const start = timeSeconds(track.startpos);
    const end = i + 1 < list.length ? timeSeconds(list[i + 1].startpos) : total;
    return {
      ...track,
      artist: String(track.artist ?? "").trim(),
      n: String(i + 1).padStart(2, "0"),
      start,
      length: Math.max(1, end - start),
      pct: ((start / total) * 100).toFixed(3)
    };
  });
}

// The post `offset` places away from `url` in a newest-first list
// (1 = older, -1 = newer), or null.
export function adjacent(posts, url, offset) {
  const i = posts.findIndex((post) => post.url === url);
  return i < 0 ? null : posts[i + Number(offset)] ?? null;
}

// What the player needs to know about a mix.
export function episodeJson(post) {
  return toJson({
    id: post.url,
    url: post.url,
    title: mixTitle(post),
    genre: post.genre ?? "",
    src: post.mp3streamurl,
    cover: post.episodeimg ? `${site.url}${post.episodeimg}` : "",
    duration: timeSeconds(post.duration),
    tracks: chapters(post.tracklist, post.duration).map((c) => ({ s: c.start, a: c.artist, t: c.title }))
  });
}

// The search page's index of every listed post.
export async function searchJson(posts) {
  const items = [];
  for (const post of posts) {
    const date = DateTime.fromJSDate(post.date, { zone: TIMEZONE });
    items.push({
      type: post.layout === "mix" ? "mix" : "post",
      title: mixTitle(post),
      url: post.url,
      date: date.toISODate(),
      dateLabel: date.toFormat("d LLL yyyy"),
      year: date.toFormat("yyyy"),
      duration: post.duration ?? "",
      genre: post.genre ?? "",
      tags: post.tags ?? [],
      excerpt: truncatewords(normalizeWhitespace(stripHtml(post.excerpt)), 30),
      image: post.episodeimg ? await cover(post.episodeimg, 192) : "",
      tracks: (post.tracklist ?? []).map((t) => ({
        artist: String(t.artist ?? "").trim(),
        title: t.title ?? "",
        label: t.label ?? "",
        start: t.startpos ?? ""
      }))
    });
  }
  return toJson(items);
}
