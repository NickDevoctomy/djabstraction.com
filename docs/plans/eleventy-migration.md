# Plan: Migrate from Jekyll to Eleventy

**Status:** Phases 0–2 and 1.7 done (uncommitted). Waiting for the maintainer's manual checks (Phase 3). See "Verification results" at the end.
**Date:** 2026-10-16
**Branch:** `eleventy` (already checked out by the maintainer)
**Background:** see `build-and-deploy-refactor.md` section 3 for why Eleventy was chosen.

This plan is written for a fresh agent session to carry out end to end. There are three phases, and each must be finished before the next starts:

1. **Update:** port the site to Eleventy.
2. **Verify:** automated checks, including comparing the feeds against the live site. All must pass before handover.
3. **Manual checks:** a checklist for the maintainer. The agent stops after handing over.

---

## Ground rules (read first)

These come from `AGENTS.md` and apply to the whole migration:

- **No git commands that change anything.** Read-only commands (`git status`, `git diff`, `git log`) are fine. Don't run `add`, `commit`, `reset`, `checkout`, `stash`, `tag` or `push`, and no `gh` writes. Leave all changes uncommitted in the working tree. The maintainer commits.
- **No AI attribution** anywhere.
- **Never create or push tags.** A `v*` tag deploys the live site.
- **If something is blocked or fails, stop and report.** Don't swap in a different or more destructive action.
- **`sudo` needs the maintainer.** Installing system packages in WSL needs root. Ask the maintainer to run the command, or ask permission to use `wsl -d Ubuntu-26.04 -u root -- ...`.
- **Output parity comes first.** The migration must not change what the site outputs, except for the allowed differences listed below. Don't fix existing bugs along the way. Note them in the "Follow-ups" section instead.

### Hard requirements (blockers for handover)

1. **Every URL stays the same.** Every page, post, feed and asset URL in the current build exists at the same path in the new build. Podcast GUIDs are built from post URLs, so a changed URL makes podcast apps re-download episodes.
2. **Feeds match live.** `/feed.xml` and `/feed/podcast.xml` must match https://www.djabstraction.com/feed.xml and https://www.djabstraction.com/feed/podcast.xml as described in Phase 2. They're checked **before** handover, not by the maintainer.
3. **The feed validator passes**, and still catches deliberately broken feeds.
4. **CI works:** the Build and Deploy workflows run Eleventy, and the output still goes to `_site/`.

---

## Current site: facts the migration must preserve

These were gathered from the Jekyll 4.4.1 build on 2026-10-16. Re-check them against the baseline from Phase 0.

### Output inventory

- **Posts:** 20 posts in `_posts/` (16 with `layout: mix`, 4 with `layout: post`). Permalinks use Jekyll's `date` style: `/YYYY/MM/DD/<slug>.html`, e.g. `/2025/06/08/warmupsessions_16.html`. The slug is the filename without its date prefix.
- **Pages:** `/`, `/page/2/`, `/mixes/`, `/mixes/page/2/`, `/posts/`, `/tags/`, `/about/`, `/cookies/`, `/podcast/`. Each is written as `index.html` in its directory.
- **Feeds and other files:**
  - `/feed.xml`: Atom, from `jekyll-feed`, 10 most recent posts.
  - `/feed/podcast.xml`: a hand-written Liquid template.
  - `/feed/stylesheet.xsl`: static.
  - `/sitemap.xml`: from `jekyll-sitemap`, 29 URLs.
  - `/robots.txt`: static.
- **Assets:** `/assets/main.css` is compiled from `assets/main.scss`, which imports `_sass/styles.scss`, which imports the vendored Clean Blog SCSS. Everything else in `assets/` and `img/`, plus `favicon.ico`, is copied as-is.
- **Not published:** `docs/`, `README.md`, `AGENTS.md`, `LICENSE`, `jekyll-theme-clean-blog.gemspec`, `Gemfile*`, `.github/`. The new config must also exclude `node_modules/`, `package*.json` and the Eleventy config.

### Behaviour

| Jekyll behaviour | Detail | Eleventy needs |
|---|---|---|
| **Timezone** | `_config.yml` has `timezone: Europe/London`. Front matter dates like `date: 2025-06-08 00:00:00` mean London wall-clock time, so feeds show `+01:00` and `+00:00` offsets. | YAML parses these as **UTC**. Reinterpret the date/time as Europe/London, e.g. with Luxon. This affects permalinks (which day a post lands on), feed dates and sitemaps. Run builds with `TZ=Europe/London` as well. |
| **Future posts** | Jekyll leaves out posts dated after build time. | Filter them out of every collection and output. Don't write their pages at all. |
| **`hidden: true`** | 4 early mixes (episodes 1–4) are hidden. `jekyll-paginate-v2` drops them from paginated lists, and `feed/podcast.xml` skips them with `{% unless post.hidden %}`. Their pages still get built. | Same: build their pages, but leave them out of pagination and the podcast feed. Check `feed.xml` and `sitemap.xml` against the baseline to see whether those include them. |
| **Pagination** (`jekyll-paginate-v2`) | 10 per page, `/page/:num/` permalinks, newest first, hidden posts excluded. Home (`index.html`) paginates all posts, creating `/page/2/`, even though the `home` layout lists `site.posts limit: 5`. `/mixes/` paginates posts tagged `mix`, and `/posts/` those tagged `blog`. | Eleventy `pagination` front matter, which uses a **different schema** from the existing `pagination:` blocks, so replace them. Provide a `paginator` shim with `posts`, `total_pages`, `previous_page`, `previous_page_path`, `next_page` and `next_page_path`. |
| **`site.posts`** | All published posts, newest first. | A `posts` collection shaped like Jekyll's posts (see below). |
| **`site.tags`** | Hash of tag → posts, in Jekyll's order. Used by `tags/index.html`. | Build an equivalent. Match the baseline's tag order and post order exactly. |
| **`page.previous` / `page.next`** | Previous is the older post and next the newer one, across all posts (hidden ones included). | Compute from the sorted collection. |
| **`post.excerpt`** | The first paragraph, i.e. rendered content up to the first blank line in the source. Used with `strip_html \| truncatewords: 15` in lists, and in `og:description`. | Replicate this in the collection. |
| **Markdown** | kramdown: auto heading IDs, smart quotes and typographic symbols, raw HTML allowed. | markdown-it with `html: true`. Tune it (anchors, typographer) until the HTML diff is clean, or document any remaining differences. |
| **Includes** | `{% include read_time.html content=post.content %}`, read as `include.content`. | liquidjs option `jekyllInclude: true`, with `_includes/` as the includes dir. |
| **`page.*` in templates** | Jekyll exposes front matter as `page.title`, `page.background` and so on. | In Eleventy front matter is top level (`title`, `background`), and `page` is reserved (`page.url`, `page.date`, `page.fileSlug`). Rewrite these references. |

### Liquid filters in use

Templates use these filters, and the port must reproduce Jekyll's output exactly. **Four of them aren't defined in Jekyll at all** (checked in the 4.4.1 gems). Jekyll's Liquid silently ignores unknown filters and outputs the input unchanged, so implement those four as identity filters to keep the output identical.

| Filter | Defined in Jekyll? | Implement as |
|---|---|---|
| `relative_url`, `absolute_url` | yes | `baseurl` is `""`. Absolute means `site.url` + path. |
| `xml_escape` | yes | Escape `& < > " '`. Check the baseline: it outputs `&apos;`. |
| `date_to_xmlschema` | yes | ISO 8601 with the Europe/London offset. |
| `date` | Liquid | Ruby `strftime` formats including `%T` and `%z`, in Europe/London. Check liquidjs output against the baseline. |
| `number_of_words` | yes | Jekyll splits on whitespace: `String(s).trim().split(/\s+/).filter(Boolean).length`. |
| `normalize_whitespace` | yes | Replace runs of whitespace with a single space, then trim. |
| `time_seconds` | `_plugins/time_to_seconds.rb` | `"HH:MM:SS"` → total seconds. |
| `expand_urls` | **no** | identity |
| `cdata_escape` | **no** | identity |
| `encode_email` | **no** | identity |
| `json` | **no** | identity |

Standard Liquid filters (`strip_html`, `truncatewords`, `truncate`, `escape`, `prepend`, `replace`, `divided_by`, `join`, `default`, `strip_newlines`) come with liquidjs. Check their output matches.

### Existing quirks to keep (don't fix during the migration)

- **Invalid JSON-LD** in `_includes/head.html`: commas are missing between properties.
- **`_includes/footer.html`** has a stray `</s>`, and `mixes/index.html` closes an `<h4>` with `</h3>`.
- **Unescaped podcast title:** `feed/podcast.xml` outputs `<title>{{ post.subtitle }}</title>` without `xml_escape`. The validator catches it if that ever breaks the feed.

These go in Follow-ups at the end.

---

## Phase 0: Baseline (before changing anything)

1. **Ruby toolchain:** confirm it still works. WSL Ruby is installed, and gems live in `~/.gem`, per `README.md`.
2. **Jekyll baseline build:** build the current Jekyll site into a directory **outside the repo**:
   ```bash
   export GEM_HOME="$HOME/.gem" PATH="$HOME/.gem/bin:$PATH"
   bundle exec jekyll build --destination ~/baseline/jekyll
   bundle exec ruby .github/scripts/validate-feeds.rb ~/baseline/jekyll
   ```
3. **Live snapshot:** save copies of the live files to `~/baseline/live/`:
   ```bash
   mkdir -p ~/baseline/live/feed
   curl -fsS https://www.djabstraction.com/feed.xml         -o ~/baseline/live/feed.xml
   curl -fsS https://www.djabstraction.com/feed/podcast.xml -o ~/baseline/live/feed/podcast.xml
   curl -fsS https://www.djabstraction.com/sitemap.xml      -o ~/baseline/live/sitemap.xml
   ```
4. **Baseline vs live:** compare the Jekyll baseline's feeds with live, using the same rules as Phase 2. They should already match. If they don't (for example, live is behind `main`), **stop and report** before continuing, because Phase 2 depends on this comparison being meaningful.

---

## Phase 1: Update

### 1.1 Node toolchain

- **Install Node in WSL.** It isn't installed yet. Ubuntu 26.04's packaged `nodejs` is 22.x, which is enough for Eleventy 3. Ask the maintainer to run:
  ```bash
  sudo apt-get install -y nodejs npm
  ```
- **Pin the Node version:** add `.nvmrc` containing `22`.
- **Add `package.json`** with dependencies pinned to current versions:
  - required: `@11ty/eleventy` (3.1.7 at the time of writing), `sass` and `luxon`;
  - add `markdown-it-anchor` only if heading IDs need it.

  It should have scripts for `build`, `serve` and `validate`, plus `compare-feeds` (added in Phase 2), and set `TZ=Europe/London` for build and serve, for example through `cross-env` or a tiny wrapper script.
- **Commit the lockfile:** add `package-lock.json` to the repo, and `node_modules/` to `.gitignore`.

### 1.2 Eleventy config (`eleventy.config.js`)

- **Directories:** input `.`, includes `_includes`, layouts `_layouts`, data `_data`, output `_site`.
- **Ignores:**
  - Jekyll leftovers: `docs/`, `README.md`, `AGENTS.md`, `LICENSE`, the gemspec, `Gemfile*` and `_plugins/`;
  - repo tooling: `.github/`, `node_modules/` and `scripts/`.
- **Passthrough copy:** `img/`, `assets/` (everything except `main.scss`), `favicon.ico`, `robots.txt` and `feed/stylesheet.xsl`.
- **Liquid:** `jekyllInclude: true`, `dynamicPartials: false`, `strictFilters: false`, and `timezoneOffset` set for Europe/London if the liquidjs version supports IANA names (check). Register every filter from the table above.
- **Site data:** move the `_config.yml` keys into `_data/site.json`, or `_data/site.js`, so `site.*` references keep working. Include `site.time` (build time) for `lastBuildDate` and the feed's `updated`.

### 1.3 Posts

- **Directory data:** `_posts/_posts.11tydata.js` sets, for every post:
  - `permalink`: `/YYYY/MM/DD/<fileSlug>.html`, using the **London** date;
  - a corrected `date`: the YAML date reinterpreted as London time;
  - exclusion of future-dated posts (`permalink: false` and `eleventyExcludeFromCollections`, decided at build time).
- **Collections:**
  - `posts`: all published posts, newest first;
  - `paginatedPosts`: `posts` minus hidden ones;
  - `mixPosts` and `blogPosts`: the hidden-filtered lists for `mix` and `blog`.

  Each item exposes Jekyll-style fields so templates change as little as possible: `title`, `subtitle`, `url`, `date`, `content` (rendered), `excerpt`, `tags`, `layout`, `hidden`, the rest of the front matter, and `previous`/`next`.
- **Tags collection:** a `tags` collection or global equivalent to `site.tags`, in the baseline's order.
- **Watch for `tags` collisions:** Eleventy treats `tags` front matter as collection membership. That's fine, but check the `mix` and `blog` collections don't clash with your own collection names.

### 1.4 Templates

- **Front-matter references:** rewrite `page.<front matter>` as top-level variables in `_layouts/*.html` and `_includes/*.html`. Keep `page.url`.
- **Post lists:** replace `site.posts` with the `posts` collection.
- **Pagination:** rewrite the front matter of `index.html`, `mixes/index.html` and `posts/index.html` for Eleventy pagination. Keep `/page/2/` and `/mixes/page/2/`, and keep `/posts/` as a single page while there are 10 or fewer blog posts.
- **Tags page:** port `tags/index.html` to the tags structure.
- **Podcast feed:** port `feed/podcast.xml` with as few changes as possible (`site.posts` → collection, field access). Its output must match live (Phase 2).
- **`feed.xml`:** write it by hand as a template that reproduces the structure of `jekyll-feed`'s output **exactly as in the baseline**: element order, `type="html"` attributes, `xml:base`, ids without `.html`, `author`, `category`, `summary`. Use the baseline file as the reference. Only the `<generator>` element may change.
- **`sitemap.xml`:** write it by hand as a template that produces the same set of URLs as the baseline (and live). Copy the `lastmod` behaviour from the baseline.
- **Sass:** compile `assets/main.scss` to `/assets/main.css` with `sass` (load path `_sass`, style `expanded`). Remove the Jekyll front matter dashes from `assets/main.scss`.

### 1.5 Port the feed validator to Node

- **Port the script:** `.github/scripts/validate-feeds.rb` becomes `scripts/validate-feeds.mjs`, with **the same checks and messages** (well-formed XML, channel and item fields, unique guids/enclosures/episodes, chapters, Atom fields). Use `fast-xml-parser`: its `XMLValidator` checks well-formedness, and its parser handles the structure.
- **Prove it still fails:** run it against deliberately broken copies of the output (an unescaped `&` in an item title, an empty enclosure length, bare-URL channel artwork, a malformed chapter start, a duplicate guid, an Atom entry with no `<id>`). It must exit non-zero for each one and zero for the real build.
- **Remove the old script:** delete the Ruby script only after the Node port passes those tests.

### 1.6 CI

Change `build.yml` and `deploy.yml`:
- **Replace the Ruby steps:** `ruby/setup-ruby` becomes `actions/setup-node@v4`, using `node-version-file: .nvmrc` and `cache: npm`, followed by `npm ci`.
- **Build and validate:** `bundle exec jekyll build` becomes `npm run build`, with `TZ: Europe/London` in the step's `env`. The validation step becomes `npm run validate`.
- **Keep the rest:** the tag/main check, the AWS steps, `_site/` as output, and the trigger rules stay exactly as they are.

### 1.7 Remove Jekyll (only after Phase 2 passes)

- **Delete:** `Gemfile`, `Gemfile.lock`, `_config.yml` (once its values are in `_data/site.*`), `_plugins/`, `.ruby-version`, `jekyll-theme-clean-blog.gemspec` and `.jekyll-cache/` if present.
- **Docs:**
  - `README.md`: Node setup in WSL, the build/serve/validate commands, and the release section (unchanged apart from commands).
  - `AGENTS.md`: replace the Ruby/Bundler commands with npm ones, and keep the rules section word for word.
  - This plan: update its status.

---

## Phase 1 notes (findings that correct or extend the plan)

- **Timezone:** the "Behaviour" table above is wrong. Jekyll (Psych) reads offset-less front matter dates as **UTC** and shows them in London time, e.g. `date: 2025-06-08 00:00:00` is published as `2025-06-08T01:00:00+01:00`. JavaScript YAML parsing already gives the same instant, so nothing is reinterpreted. Every date is just formatted in Europe/London (Luxon, in `_11ty/jekyll.js`).
- **Excerpts depend on line endings:** Jekyll splits the raw source on `

`, so a post saved with CRLF has its whole content as its excerpt. Two blog posts are committed with CRLF, and their feed.xml `<summary>` is the full text on live. The port copies this exactly. Normalising line endings would change those two summaries.
- **Post order with equal timestamps** (`newformat` and `warmupsessions_11`): previous/next and tags use date then file name ascending, but feed.xml lists `newformat` first. Both orders are copied (`feedPosts` collection).
- **`/posts/` markup:** Jekyll rendered `/posts/` from the *mixes* template (a jekyll-paginate-v2 template-cache quirk), so live uses `h2`/`h4` there. `posts/index.html` now matches what live serves.
- **Raw HTML in Markdown:** kramdown re-serialised inline HTML and markdown-it passes it through. Four source snippets were rewritten in the form kramdown output (`&amp;` in hrefs, `<img … />`, `allowfullscreen=""`, `<p><br /></p>` in `cookies/index.md`). Without the cookies change, CommonMark would swallow the `### Necessary cookies` heading into the HTML block.
- **Block spacing:** markdown-it's renderer is wrapped to keep kramdown's blank line between blocks. Without it, `<itunes:subtitle>` (truncated to 252 characters) is cut at a different point.
- **`<generator>`** is now `Eleventy` in both feeds (an allowed difference).
- **Tags page (deliberate change, requested by the maintainer):** entries now show the subtitle after the title, e.g. "DJ Abstraction's Warmup Sessions - Episode 16". Before, every mix showed the same title. Expect this difference in the `/tags/` HTML diff.
- **Sass:** compiled in an `eleventy.before` hook. `main.css` is byte-identical to the baseline, and `main.css.map` is still produced because live serves it.
- **Results at the end of Phase 1:** the file list is identical to the baseline. Every HTML page matches after whitespace normalisation. feed.xml and podcast.xml differ only in the generator, the build time and whitespace. The sitemap URL set equals baseline and live. The Node validator passes the build and fails all six broken copies, matching the Ruby script.

---

## Phase 2: Verify (automated; all must pass before handover)

Run everything from a clean install: `rm -rf node_modules _site && npm ci && npm run build`.

### 2.1 URL parity

- **Same files:** list every file under `~/baseline/jekyll` and `_site`. The file sets must be the same. The only allowed extras or omissions are files that existed purely because of Jekyll, and each one must be listed in the report.
- **Live sitemap:** every `<loc>` in `~/baseline/live/sitemap.xml` must exist in `_site`.
- **Sitemaps match:** the new `/sitemap.xml` must list the same set of URLs as the live one.

### 2.2 Feeds against live (blocking)

Add `scripts/compare-feeds.mjs`. It parses two feeds and compares them **semantically**, exiting non-zero on any difference that isn't allowed. Run it in three combinations:

| Compare | Against |
|---|---|
| new `_site/feed.xml` | `~/baseline/live/feed.xml` (https://www.djabstraction.com/feed.xml) |
| new `_site/feed/podcast.xml` | `~/baseline/live/feed/podcast.xml` |
| both new feeds | the `~/baseline/jekyll` equivalents |

**Must match exactly:**
- **Atom (`feed.xml`):**
  - feed: `id`, `title`, `subtitle`, `author` and links;
  - entries, compared in order: `id`, `title`, link `href`, `published` and `updated` (compared as **instants**, not strings), `author`, `category` terms, `summary`, and `content` (after normalising whitespace).
- **Podcast (`feed/podcast.xml`):**
  - channel: every element and attribute except `lastBuildDate`;
  - items, compared in order: `title`, `guid` (and `isPermaLink`), `link`, `pubDate` (as an instant), enclosure `url`, `length` and `type`, `category` list, `description` and `content:encoded` (after normalising whitespace), `dc:creator`, every `psc:chapter` (`start`, `title`, `href`), and the `itunes:*` fields (`episode`, `title`, `subtitle`, `episodeType`, `summary`, `author`, `image`, `duration`, `explicit`), plus the `googleplay:*` fields.

**Allowed to differ:**
- build-time fields: `lastBuildDate`, the Atom feed `updated`, and `<generator>`;
- the text formatting of a date, as long as the instant is the same (for example `+0000` vs `+0100` representations of the same moment);
- whitespace and line endings (live uses CRLF).

**Before handover, record the full output of all three comparisons in the report, plus the validator output.** If the live comparison fails because live has changed since Phase 0 (for example, a new episode was released), re-take the snapshot and re-run the comparison, and say so in the report.

### 2.3 HTML parity

- **Diff every page:** for every `.html` file, run a normalised diff (collapse whitespace, ignore attribute order) between `~/baseline/jekyll` and `_site`.
- **Target zero differences.** Anything left must be listed in the report with a reason. Expect possible small kramdown vs markdown-it differences, which should be tuned away where possible.
- **Check these closely:** home, `/page/2/`, `/mixes/` and `/mixes/page/2/` (which posts, in what order, pager links), `/tags/` (tag order, post order), one mix page (tracklist, audio `src`, the seek `onclick` values from `time_seconds`, download button, previous/next links, JSON-LD), and one blog post (read time).

### 2.4 Other checks

- **CSS:** `assets/main.css` must match the baseline, apart from cosmetic formatting.
- **Future-dated posts:** add a temporary post dated in the future, build, confirm it appears nowhere (no page, not in lists, feeds or sitemap), then delete it.
- **Hidden posts:** episodes 1–4 must still have pages, but must not appear in pagination or `feed/podcast.xml`.
- **Validator:** passes on the real build, and fails on each of the broken copies (1.5).
- **YAML:** `build.yml` and `deploy.yml` parse, and their steps are in the right order: build → validate → AWS steps.

### 2.5 Report

Add a **"Verification results"** section at the bottom of this file with:
- the commands run and their output (trim long output, but keep every difference line);
- the list of accepted differences, each with a reason;
- confirmation that every item in 2.1–2.4 passed.

Only then hand over to the maintainer, with a short summary in chat.

---

## Phase 3: Manual checks (maintainer)

The agent prepares these and then stops. The maintainer works through them.

### Local (before committing)

- [ ] **Serve the site:** run `npm run serve` in WSL and open http://localhost:8080 (or the port shown).
- [ ] **Pages render** and look the same as the live site:
  - Home: the masthead logo, the 5 latest posts and the "View All Posts" button.
  - `/mixes/`: artwork, tags and duration on each card. Then follow "Older Posts" to page 2 and back.
  - `/posts/`: the read-time estimates show.
  - `/tags/`: clicking a tag scrolls to its section.
  - `/about/`, `/podcast/` and `/cookies/`.
- [ ] **A mix page (episode 16):**
  - The audio player plays.
  - Clicking a 🎧 icon jumps to that track.
  - The 🛒 purchase links open, and the Download button works.
  - The share icons appear.
  - Previous/Next post buttons go to the right posts.
- [ ] **Site-wide parts:** the cookie banner appears and dismisses, the navbar collapses into the Menu button at mobile width, and the footer icons link to email, Instagram, Spotify, `/feed.xml` and `/feed/podcast.xml`.
- [ ] **Feed in a browser:** `/feed/podcast.xml` is styled by `stylesheet.xsl`.
- [ ] **Review the report:** read the "Verification results" section and its list of accepted differences.

### After merging and the first Eleventy deploy (tag)

- [ ] **The Deploy run passes:** build → validate → S3 → CloudFront.
- [ ] **Live feeds:** https://www.djabstraction.com/feed.xml and https://www.djabstraction.com/feed/podcast.xml load. Optionally, run `npm run compare-feeds` against the pre-deploy snapshot.
- [ ] **Podcast app test:** in AntennaPod or your usual app, refresh the subscription. There should be **no duplicate or "new" old episodes**, and nothing should re-download.
- [ ] **External validator:** run the live podcast feed through one, for example Podbase or Cast Feed Validator.
- [ ] **Spot-check a few old post URLs** from search results or bookmarks.

### Rollback

- **Redeploy the previous release:** run the Deploy workflow manually (Actions → Deploy → Run workflow) and pick the **previous `v*` tag**. GitHub uses the workflow file from that tag, so a pre-migration tag rebuilds with Jekyll.

---

## Follow-ups (after the migration is live; not part of this plan)

- Fix the invalid JSON-LD in `_includes/head.html`.
- Add `xml_escape` to `<title>{{ post.subtitle }}</title>` in the podcast feed.
- Fix the stray `</s>` in the footer and the `<h4>…</h3>` mismatch on `mixes/index.html`.
- Decide whether `expand_urls`, `cdata_escape`, `encode_email` and `json` should do something real, or whether to remove them.
- Sass `@import` deprecation: once off Jekyll, consider moving the vendored SCSS to `@use`, or switch to the prebuilt Clean Blog CSS.

---

## Verification results

Run on 2026-10-16 in WSL2 Ubuntu 26.04 with Node 22.22.1. The live snapshot (`~/baseline/live`) was taken the same morning, and the Phase 0 baseline matched live except for build timestamps.

### Commands and output

```
$ rm -rf node_modules _site && npm ci && npm run build
added 144 packages in 2s
[11ty] Copied 1725 Wrote 32 files in 5.59 seconds (v3.1.7)

$ npm run validate
_site/feed/podcast.xml: 12 items checked
_site/feed.xml: 10 entries checked
Feeds OK.

$ node scripts/compare-feeds.mjs _site/feed.xml ~/baseline/live/feed.xml
_site/feed.xml (Atom, 10 entries) vs ~/baseline/live/feed.xml (Atom, 10 entries)
  match
$ node scripts/compare-feeds.mjs _site/feed/podcast.xml ~/baseline/live/feed/podcast.xml
_site/feed/podcast.xml (RSS, 12 items) vs ~/baseline/live/feed/podcast.xml (RSS, 12 items)
  match
$ node scripts/compare-feeds.mjs _site/feed.xml ~/baseline/jekyll/feed.xml
  match
$ node scripts/compare-feeds.mjs _site/feed/podcast.xml ~/baseline/jekyll/feed/podcast.xml
  match
$ npm run compare-feeds        # against https://www.djabstraction.com over HTTPS
_site/feed.xml (Atom, 10 entries) vs https://www.djabstraction.com/feed.xml (Atom, 10 entries)
  match
_site/feed/podcast.xml (RSS, 12 items) vs https://www.djabstraction.com/feed/podcast.xml (RSS, 12 items)
  match
```

`compare-feeds` self-test on edited copies of the build (expected: exit 1, except the "allowed" rows):

```
changed guid              exit=1  DIFF rss[0].channel[0].item[1].guid[0].#text: ".../warmupsessions_15b.html" vs ...
pubDate +1h               exit=1  DIFF rss[0].channel[0].item[0].pubDate[0]: ... (different instant)
chapter title             exit=1  DIFF ...psc:chapter[14].@title: "Acues - A Million Dream (Original Mi..."
subtitle one char         exit=1  DIFF rss[0].channel[0].item[0].itunes:subtitle[0]: "I wasX Lost in Sound, ..."
dropped item              exit=1  DIFF rss[0].channel[0].item: 11 vs 12 element(s)
atom summary              exit=1  DIFF feed[0].entry[0].summary[0].#text: "Uplifting Trance Mix!" vs "Uplifting Trance Mix."
ALLOWED same instant      exit=0  (+0100 vs the equivalent +0000)
ALLOWED whitespace/CRLF   exit=0
ALLOWED generator         exit=0
```

Validator on broken copies (1.5). The Ruby script gave the same results before it was deleted:

```
real build                node=0 ruby=0
unescaped & in title      node=1 ruby=1  not well-formed XML: char '&' is not expected. (line 54)
empty enclosure length    node=1 ruby=1  item 1 (Episode 16): <enclosure length> must be a positive integer
bare-URL channel artwork  node=1 ruby=1  channel: <itunes:image href> must be a .jpg or .png URL, got "/img/podcast/podcast.jpg"
malformed chapter start   node=1 ruby=1  item 1 (Episode 16): chapter 2 start "3m38" is not HH:MM:SS
duplicate guid            node=1 ruby=1  item 2 (Episode 15): duplicate guid .../warmupsessions_16.html (also item 1)
atom entry without id     node=1 ruby=1  entry 1: missing <id>
```

### 2.1 URL parity: passed

- The file lists of `~/baseline/jekyll` and `_site` are identical (1759 files, including `assets/main.css.map`). There are no extra or missing files.
- All 29 `<loc>` URLs in the live sitemap exist in `_site`.
- The new sitemap's URL set equals live's. Its 20 `lastmod` values are the same instants as the baseline's. The order of the non-post pages differs, as it already did between the baseline and live.

### 2.2 Feeds against live: passed

All three comparisons match (see above). The only differences are the allowed ones: `<generator>` (now Eleventy), the Atom feed `<updated>`, `lastBuildDate`, and whitespace.

### 2.3 HTML parity: passed, one intended difference

All 29 HTML files were compared with whitespace collapsed and attributes sorted. 28 are identical. `tags/index.html` differs only by the requested subtitle, e.g. "DJ Abstraction's Warmup Sessions - Episode 16" (75 links). With `" - Episode NN"` removed, it is identical. The pages singled out in 2.3 (home, `/page/2/`, `/mixes/`, `/mixes/page/2/`, `/tags/`, episode 16, a blog post) are covered by this comparison. That includes the pager links, the `time_seconds` onclick values, previous/next links, JSON-LD and read times.

### 2.4 Other checks: passed

- **CSS:** `assets/main.css` is byte-identical to the baseline.
- **Future-dated posts:** a temporary post dated 2099-01-01 produced no page and appears in no HTML, XML, list, feed or sitemap (1759 files, the same as a normal build). As a control, the same post dated 2020-01-01 appeared in its own page, `/tags/`, `/mixes/page/2/`, the podcast feed, the sitemap and a neighbour's previous/next link. Both temporary posts were deleted.
- **Hidden posts:** episodes 1–4 each have a page, and none appears in `/`, `/page/2/`, `/mixes/`, `/mixes/page/2/`, `/posts/` or `feed/podcast.xml`.
- **Validator:** passes on the build and fails on each broken copy (see above).
- **Workflows:** both parse. Build: checkout → Set up Node → Install dependencies → Build → Validate feeds. Deploy: checkout → tag/main check → Set up Node → Install dependencies → Build → Validate feeds → AWS credentials → S3 sync → CloudFront invalidation.

### 1.7: done after Phase 2 passed

Deleted `Gemfile`, `Gemfile.lock`, `_config.yml`, `_plugins/`, `.ruby-version`, `jekyll-theme-clean-blog.gemspec`, `.jekyll-cache/` and `.github/scripts/validate-feeds.rb`. Updated `README.md` and `AGENTS.md` (the rules section is unchanged). After the removal, a clean install and build was re-run: validate OK, all four feed comparisons match, file lists identical, CSS identical, only `tags/index.html` differs.

### Accepted differences

| Difference | Reason |
|---|---|
| `<generator>` is Eleventy in both feeds | Build tool changed; allowed by the plan. |
| `/tags/` shows "title - subtitle" | Maintainer's request: every mix had the same title. |
| Whitespace inside HTML and feed content | markdown-it vs kramdown formatting; ignored by the comparisons. |
| Sitemap page order | Never stable: the baseline and live already differ. |
| Source edits in `about/`, `podcast/`, `cookies/` and `newformat.md` | Rewritten in the form kramdown served, so the output is unchanged (see Phase 1 notes). |
| `posts/index.html` uses `h2`/`h4` | Matches what live actually served (see Phase 1 notes). |

### Extra follow-ups found during the migration

- Normalise line endings (e.g. a `.gitattributes`). This changes the feed.xml `<summary>` of the two CRLF blog posts to their first paragraph, and the excerpts of episodes 9–16 on a Windows checkout.
- `posts/index.html` and `mixes/index.html` are now near-duplicates and could share an include.
- `/page/2/` repeats the home page's 5 latest posts (the home layout ignores pagination). Consider dropping home pagination, though that removes a URL.
