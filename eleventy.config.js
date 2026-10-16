import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import * as sass from "sass";
import site from "./_data/site.js";
import * as jekyll from "./_11ty/jekyll.js";
import * as afterglow from "./_11ty/afterglow.js";

// Post dates, feeds and the sitemap are shown in London time.
process.env.TZ = jekyll.TIMEZONE;

const POSTS = "_posts/*.md";

// Jekyll orders posts by date, then by file path.
const byDateThenPath = (a, b) => a.date - b.date || a.inputPath.localeCompare(b.inputPath);

// Shape a collection item like a Jekyll post, so templates read post.title,
// post.url, post.content and so on.
function toJekyllPost(item) {
  const post = { ...item.data, url: item.url, date: item.date, path: item.inputPath };
  Object.defineProperty(post, "content", { enumerable: true, get: () => item.templateContent });
  return post;
}

export default function (eleventyConfig) {
  const isPublished = (item) => item.date <= site.time;

  eleventyConfig.addDataExtension("yml,yaml", (contents) => yaml.load(contents));

  // --- Inputs -------------------------------------------------------------

  for (const ignored of [
    "docs/**", "README.md", "AGENTS.md", "LICENSE", "_sass/**", "_11ty/**", ".github/**",
    "node_modules/**", "scripts/**", "assets/**", "img/**", "temp/**"
  ]) {
    eleventyConfig.ignores.add(ignored);
  }

  eleventyConfig.addPassthroughCopy("img");
  eleventyConfig.addPassthroughCopy("assets/*.js");
  eleventyConfig.addPassthroughCopy("favicon.ico");
  eleventyConfig.addPassthroughCopy("robots.txt");
  eleventyConfig.addPassthroughCopy("manifest.json");
  eleventyConfig.addPassthroughCopy("feed/stylesheet.xsl");

  eleventyConfig.addTemplateFormats("xml");
  eleventyConfig.addExtension("xml", { key: "liquid" });

  // --- Sass: assets/main.scss -> assets/main.css (+ source map) -----------

  // File-change events from the Windows drive don't reach WSL, so poll
  // (like Jekyll's --force_polling). Only used by `npm run serve`.
  eleventyConfig.setChokidarConfig({ usePolling: true, interval: 500 });

  eleventyConfig.addWatchTarget("_sass/");
  eleventyConfig.addWatchTarget("assets/main.scss");
  eleventyConfig.on("eleventy.before", ({ directories }) => {
    const outDir = path.join(directories.output, "assets");
    const result = sass.compile("assets/main.scss", {
      loadPaths: ["_sass"],
      style: "expanded",
      sourceMap: true,
      silenceDeprecations: ["import", "global-builtin", "color-functions", "slash-div"]
    });
    result.sourceMap.sources = result.sourceMap.sources.map((src) =>
      path.relative(path.resolve("assets"), new URL(src).pathname).split(path.sep).join("/")
    );
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "main.css"), `${result.css}\n\n/*# sourceMappingURL=main.css.map */`);
    fs.writeFileSync(path.join(outDir, "main.css.map"), JSON.stringify(result.sourceMap));
  });

  // --- Markdown and Liquid ------------------------------------------------

  eleventyConfig.setLibrary("md", jekyll.markdown);
  eleventyConfig.setLiquidOptions({
    jekyllInclude: true,
    dynamicPartials: false,
    strictFilters: false
  });

  const filters = {
    relative_url: (url) => url,
    absolute_url: (url) => (/^[a-z]+:\/\//i.test(String(url)) ? url : `${site.url}${url}`),
    xml_escape: jekyll.xmlEscape,
    date_to_xmlschema: jekyll.dateToXmlschema,
    date: jekyll.date,
    number_of_words: jekyll.numberOfWords,
    normalize_whitespace: jekyll.normalizeWhitespace,
    strip_html: jekyll.stripHtml,
    strip_newlines: jekyll.stripNewlines,
    truncate: jekyll.truncate,
    truncatewords: jekyll.truncatewords,
    divided_by: jekyll.dividedBy,
    time_seconds: jekyll.timeSeconds,
    smartify: jekyll.smartify,
    // Not defined in Jekyll 4: Ruby Liquid ignored them and passed the input
    // through unchanged, so they stay as no-ops here.
    expand_urls: (input) => input,
    cdata_escape: (input) => input,
    encode_email: (input) => input,
    json: (input) => input,
    // Jekyll-style post for a URL, e.g. to reach .previous/.next from a layout.
    post_for_url: (posts, url) => posts.find((post) => post.url === url),
    // jekyll-paginate-v2's `paginator` object, from Eleventy's `pagination`.
    paginator: (p) => ({
      posts: p.items,
      page: p.pageNumber + 1,
      total_pages: p.pages.length,
      previous_page: p.pageNumber > 0 ? p.pageNumber : null,
      previous_page_path: p.href.previous ? `${p.href.previous}index.html` : null,
      next_page: p.href.next ? p.pageNumber + 2 : null,
      next_page_path: p.href.next ? `${p.href.next}index.html` : null
    })
  };
  for (const [name, fn] of Object.entries(filters)) eleventyConfig.addFilter(name, fn);

  // Filters for the Afterglow templates (see _11ty/afterglow.js).
  eleventyConfig.addFilter("cover", afterglow.cover);
  eleventyConfig.addFilter("chapters", afterglow.chapters);
  eleventyConfig.addFilter("mix_title", afterglow.mixTitle);
  eleventyConfig.addFilter("human_duration", afterglow.humanDuration);
  eleventyConfig.addFilter("adjacent", afterglow.adjacent);
  eleventyConfig.addFilter("episode_json", afterglow.episodeJson);
  eleventyConfig.addFilter("search_json", afterglow.searchJson);
  eleventyConfig.addFilter("to_json", afterglow.toJson);

  // --- Collections --------------------------------------------------------

  // site.posts: published posts, newest first, each with previous (older)
  // and next (newer) across all posts, hidden ones included.
  function jekyllPosts(api) {
    const items = api.getFilteredByGlob(POSTS).filter(isPublished).sort(byDateThenPath);
    const posts = items.map(toJekyllPost);
    posts.forEach((post, i) => {
      post.previous = posts[i - 1];
      post.next = posts[i + 1];
    });
    return posts.reverse();
  }

  eleventyConfig.addCollection("posts", jekyllPosts);
  eleventyConfig.addCollection("paginatedPosts", (api) => jekyllPosts(api).filter((p) => !p.hidden));
  eleventyConfig.addCollection("mixPosts", (api) =>
    jekyllPosts(api).filter((p) => !p.hidden && p.tags?.includes("mix"))
  );
  eleventyConfig.addCollection("blogPosts", (api) =>
    jekyllPosts(api).filter((p) => !p.hidden && p.tags?.includes("blog"))
  );

  // site.tags as [tag, posts] pairs: tags in the order first seen walking
  // posts oldest first, and each tag's posts newest first.
  eleventyConfig.addCollection("tagList", (api) => {
    const tags = new Map();
    for (const post of jekyllPosts(api).reverse()) {
      for (const tag of post.tags ?? []) {
        if (!tags.has(tag)) tags.set(tag, []);
        tags.get(tag).unshift(post);
      }
    }
    return [...tags];
  });

  // feed.xml (jekyll-feed): newest first; posts sharing a timestamp come out
  // in file path order in the Jekyll build, so keep that.
  eleventyConfig.addCollection("feedPosts", (api) =>
    jekyllPosts(api).sort((a, b) => b.date - a.date || a.path.localeCompare(b.path)).slice(0, 10)
  );

  // sitemap.xml (jekyll-sitemap): every post oldest first, then every other
  // HTML page.
  eleventyConfig.addCollection("sitemapPages", (api) =>
    api
      .getAll()
      .filter((item) => item.url && /(\/|\.html)$/.test(item.url) && !item.inputPath.includes("/_posts/"))
      .sort((a, b) => a.inputPath.localeCompare(b.inputPath) || a.url.localeCompare(b.url))
  );

  return {
    dir: {
      input: ".",
      includes: "_includes",
      layouts: "_layouts",
      data: "_data",
      output: "_site"
    },
    templateFormats: ["html", "md", "xml", "liquid"],
    markdownTemplateEngine: "liquid",
    htmlTemplateEngine: "liquid"
  };
}
