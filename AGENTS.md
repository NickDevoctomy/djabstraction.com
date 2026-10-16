# AGENTS.md

Instructions for AI coding agents working in this repository.

## Rules

1. **Never run git commands that change anything, unless the user explicitly asks for that exact action in their current message.** This includes `add`, `commit`, `amend`, `reset`, `checkout`/`switch`, `stash`, `rebase`, `merge`, `tag`, `push` and branch create/delete. It also covers anything that changes GitHub: `gh pr create/merge/close`, `gh api` writes, releases and repository settings.
   - Read-only commands are fine: `git status`, `git log`, `git diff`, `git show`, `git branch --list`, `gh pr view`.
   - A question about the release flow ("then we push and tag?") is a question, not an instruction.
   - Leave changes uncommitted in the working tree. The maintainer reviews, commits and pushes.
2. **No AI attribution.** Never add `Co-Authored-By`, "Generated with…" or similar lines to commits, PRs, tags or files.
3. **Pushing a `v*` tag deploys the live site.** Never create or push tags.
4. If an action is blocked or fails, stop and report it. Don't substitute a different or more destructive action.

## Project

- Eleventy (11ty) static site for djabstraction.com (DJ mixes plus a podcast feed). It's served from S3 behind CloudFront. It was migrated from Jekyll and is built to give the same output, URLs and feeds. See `docs/plans/eleventy-migration.md`.
- Config: `eleventy.config.js`. Jekyll-compatible Liquid filters, Markdown settings and the post excerpt live in `_11ty/jekyll.js`. Site settings (`site.*`) are in `_data/site.js`.
- Posts: `_posts/`. Mix pages use `layout: mix` with `tracklist`, `mp3streamurl`, `downloadurl` and `duration` front matter. `_posts/_posts.11tydata.js` sets the `/YYYY/MM/DD/<slug>.html` permalinks (London date) and drops future-dated posts.
- Templates are Liquid. Front matter is read as top-level variables (`title`, `background`); `page.url` and `page.date` are Eleventy's.
- Feeds:
  - `feed/podcast.xml` is a **hand-written Liquid template** for the podcast RSS. Changes to it, or to post front matter, can break podcast apps.
  - `feed.xml` (Atom) and `sitemap.xml` are hand-written templates that reproduce the old `jekyll-feed` and `jekyll-sitemap` output.
- Post URLs are podcast GUIDs. Never change a post's date or file name after it's published.
- Theme ("Afterglow"): `_sass/styles.scss` compiles to `/assets/main.css`. Icons are inline SVGs from `_includes/icon.html` (pass the size as `px=`; `include.size` is Liquid's argument count). Template helpers (cover thumbnails, mix timeline, player and search data) are in `_11ty/afterglow.js`.
- Front end: `assets/app.js` runs the player, in-place page loading, search and the cookie notice. Same-site links swap `<main id="main">` instead of loading a new page, so the player keeps playing. Keep each page's content inside `<main>`, and don't put inline `<script>` in page content: it won't run after an in-place load. Use `data-*` hooks handled in `app.js` instead. Add `data-no-swap` to links that must load normally.
- Search: `/search/` gets its index from `collections.paginatedPosts` at build time (hidden posts are left out). `/tags/` only redirects there.
- Installable web app: `manifest.json`, `sw.liquid` (built to `/sw.js`) and the icons in `img/icons/`. The service worker never caches audio.
- The footer version comes from `_data/build.js`: the deploy's tag, else the tag on `HEAD`, else the short commit hash.
- `assets/vendor/` holds the old theme's vendored Bootstrap, Font Awesome and Clean Blog. The site no longer uses or publishes them. Don't edit them.
- `docs/plans/` holds design and refactor plans. `docs/` is excluded from the built site.

## Build

The supported environment is WSL2 Ubuntu. See `README.md` for setup.

```bash
npm ci
npm run build          # output in _site/
npm run serve          # http://localhost:8080
npm run validate       # check the built feeds
npm run compare-feeds  # compare the built feeds with the live site
```

- Node version: `.nvmrc`. Keep dependencies pinned to exact versions, and commit `package-lock.json`.
- Before handing back changes that affect output, run a build and then `npm run validate`. For template or front-matter changes, also run `npm run compare-feeds`. Any difference it reports must be intended.

## CI/CD

- `.github/workflows/build.yml` builds every push to any branch and every PR, then validates the feeds. It never deploys.
- `.github/workflows/deploy.yml` deploys only from `v*` tags on commits in `main`: Eleventy build, feed validation, `aws s3 sync --delete`, then a CloudFront invalidation. A feed validation failure stops the deploy before anything is uploaded.
- `scripts/validate-feeds.mjs` checks that both feeds are well-formed XML and that every podcast episode has the required fields with valid values (enclosure URL and length, guid, pubDate, duration, episode number, artwork, chapter times). When adding a field to the podcast template, add a check here too.
- Dates are shown in Europe/London time (set in `eleventy.config.js`). That also decides when future-dated posts appear.
