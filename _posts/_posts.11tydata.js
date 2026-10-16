import { DateTime } from "luxon";
import { TIMEZONE, jekyllExcerpt } from "../_11ty/jekyll.js";

// Front matter dates without an offset are UTC (as in Jekyll), and the
// permalink uses the London date: /YYYY/MM/DD/<slug>.html.
// Future-dated posts get no page; the collections leave them out too.
export default {
  eleventyComputed: {
    permalink: (data) => {
      if (data.page.date > data.site.time) return false;
      const day = DateTime.fromJSDate(data.page.date, { zone: TIMEZONE }).toFormat("yyyy/MM/dd");
      return `/${day}/${data.page.fileSlug}.html`;
    },
    excerpt: (data) => jekyllExcerpt(data.page.inputPath),
    // Footnote lines for the optional `aigen` list (keys from _data/aigen.yml).
    aigenNotes: (data) =>
      (data.aigen ?? []).map((key) => {
        if (!(key in data.aigen_uses)) throw new Error(`${data.page.inputPath}: unknown aigen value "${key}"`);
        return data.aigen_uses[key];
      })
  }
};
