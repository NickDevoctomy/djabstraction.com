# Plan: Build & Deploy Refactor

**Status:** In progress. CI split, toolchain and docs done (2026-10-16). AWS OIDC deferred. GitHub tag ruleset and branch protection pending.
**Date:** 2026-10-16
**Scope:** CI/CD trigger, local build tooling and docs, static site generator choice

## Current state (as of `3bf6fd8`)

| Area | Today | Problem |
|---|---|---|
| CI trigger | `.github/workflows/jekyll_build.yml` runs on **every push to `main`** | Every merge deploys straight to production. PRs are never built, so a broken build is only found after merging. |
| CI actions | `actions/checkout@v2`, `aws-actions/configure-aws-credentials@v1` | Both are deprecated majors running on old Node runtimes. |
| AWS auth | Long-lived `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` secrets | Static keys. GitHub OIDC with an IAM role is the current recommended approach. |
| Legacy CI | `.travis.yml` still in the repo | Dead config that suggests Travis is still in use. |
| Ruby version | Workflow uses `3.2.0`, README says `3.2.2`, no `.ruby-version` | Versions don't match. Ruby 3.2 reached end of life in March 2026. |
| Bundler | README says `2.5.22`, `Gemfile.lock` says `BUNDLED WITH 2.5.11` | The documentation doesn't match the lockfile. |
| Gemfile | `gem "jekyll", ">= 3.8.5"` | No upper bound, so the version can change silently. The lockfile currently pins 4.3.3. |
| Lockfile platforms | `ruby`, `x86_64-linux-gnu` only | `bundle install` on native Windows has to re-resolve, and `wdm ~> 0.1.0` fails to compile on Ruby 3.x. |
| Timezone | No `timezone:` in `_config.yml`; posts dated `00:00:00` | Whether a post counts as "future" depends on the build machine's clock (UTC on GitHub runners). |
| Leftovers | `package.json` (Clean Blog theme's gulp setup), `script/cibuild` (Travis only) | Not used by the real build. They make it look like Node is a dependency. |

---

## 1. Deploy only on tags pushed from `main`

### Goal

- **Pull requests:** build the site (to validate it), never deploy.
- **Push to `main`:** build only (optional, keeps the badge meaningful).
- **Push of a release tag that points at a commit on `main`:** build, sync to S3 and invalidate CloudFront.
- **Manual re-run:** `workflow_dispatch` for an existing tag.

### Tag convention

Use date-based tags, which suit episodic releases:

```
vYYYY.MM.DD        e.g. v2025.06.08
vYYYY.MM.DD.N      second release on the same day, e.g. v2025.06.08.1
```

Release flow:

```bash
git checkout main && git pull
git tag -a v2025.06.08 -m "Warmup Sessions 16"
git push origin v2025.06.08
# or: gh release create v2025.06.08 --generate-notes
```

### Proposed workflow layout

Split the single file into two:

- `.github/workflows/build.yml`: runs on `pull_request` and `push` to `main`, and only builds.
- `.github/workflows/deploy.yml`: runs on `push: tags: ['v*']` and `workflow_dispatch`, and builds and deploys.

Sketch of `deploy.yml`:

```yaml
name: Deploy

on:
  push:
    tags: ['v*']
  workflow_dispatch:

permissions:
  contents: read
  id-token: write          # for AWS OIDC

concurrency:
  group: deploy-production
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production  # optional: lets you add required reviewers
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0     # needed for the ancestry check

      - name: Ensure tag is on main
        run: |
          git fetch origin main
          git merge-base --is-ancestor "$GITHUB_SHA" origin/main \
            || { echo "::error::$GITHUB_REF_NAME is not on main"; exit 1; }

      - uses: ruby/setup-ruby@v1
        with:
          bundler-cache: true  # reads .ruby-version, caches gems

      - run: bundle exec jekyll build
        env:
          JEKYLL_ENV: production

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: eu-west-1

      - run: aws s3 sync ./_site "s3://${{ secrets.DESTINATION_BUCKET }}" --delete --acl public-read

      - run: aws cloudfront create-invalidation --distribution-id "${{ secrets.CLOUDFRONT_DISTRIBUTION_ID }}" --paths "/*"
```

`build.yml` uses the same checkout, Ruby setup and build steps, with no AWS steps and no `id-token` permission.

### Supporting changes

1. **AWS OIDC** (recommended, can be done separately). Add the GitHub OIDC identity provider in IAM. Create a role whose trust policy is limited to `repo:devoctomy/djabstraction.com:ref:refs/tags/v*` (or to the `production` environment). Grant only `s3:ListBucket`, `s3:PutObject`, `s3:PutObjectAcl`, `s3:DeleteObject` on the bucket and `cloudfront:CreateInvalidation` on the distribution. Then delete the static key secrets and deactivate the IAM user's keys.
   - Fallback: keep the existing key secrets and only bump the action to `@v4`.
2. **Tag protection.** Add a repository ruleset so that only admins can create, update or delete `v*` tags. The ancestry check stops deploys of tags that aren't on `main`. The ruleset stops anyone else from creating tags.
3. **Branch protection on `main`.** Require the `build` check to pass before merging.
4. **Delete `.travis.yml` and `script/cibuild`.** If the IAM user that Travis used is no longer needed, deactivate it too.
5. **Pin the timezone.** Add `timezone: Europe/London` to `_config.yml` so that future-dated posts are included or excluded the same way locally and in CI. Remove the `Check Date and Time` debug step.
6. **Update the README badge** to point at the new workflow file(s).

### Behaviour change to be aware of

Today, a future-dated post goes live on the next push to `main` after its date. With tag-based deploys, **nothing goes live until you push a tag**. To keep "merge early, publish on the date", add an optional `schedule:` trigger to `deploy.yml` (e.g. daily) that checks out the latest `v*` tag and rebuilds. This is not needed if you always tag on release day.

### Acceptance criteria

- [ ] A PR that breaks the Jekyll build fails its check and can't be merged.
- [ ] Merging to `main` does not change the live site.
- [ ] Pushing `vYYYY.MM.DD` from `main` deploys, and CloudFront is invalidated.
- [ ] Pushing a `v*` tag on a commit that isn't on `main` fails at the ancestry check.
- [ ] `.travis.yml` is removed.
- [ ] Deploys use OIDC (or, as the fallback, the existing key secrets with the `@v4` action).

---

## 2. Build options and documentation

### Short answer

**Jekyll builds on both Windows and Linux.** Nothing in this repo is Linux-only: the only custom plugin is `_plugins/time_to_seconds.rb`, which is plain Ruby. However, Windows is the less smooth path for Ruby and native gems. **WSL2 is the recommended primary environment**, because it matches CI (`ubuntu-latest`) exactly. Native Windows remains a supported fallback.

### Options compared

| Option | Matches CI | Setup effort | Notes |
|---|---|---|---|
| **A. WSL2 (Ubuntu)**, recommended | Yes | Low | Clone into the Linux filesystem (`~/src/...`), not `/mnt/e/...`. File watching and IO across `/mnt` are slow and inotify doesn't fire there. `localhost:4000` is reachable from the Windows browser. VS Code works through the WSL extension. |
| **B. Native Windows** (RubyInstaller + DevKit) | No | Medium | Works after the lockfile and Gemfile fixes below. Good if you want to stay entirely in Windows tooling. |
| **C. Docker / Dev Container** | Yes | Medium | Docker Desktop on the WSL2 backend with a `ruby:<ver>` image, or a `.devcontainer/` for VS Code. Avoid the `jekyll/jekyll` image, which is unmaintained and ships an old Jekyll. Most useful if other people will contribute. |

### Repo changes needed for these to work cleanly

1. **Add `.ruby-version`** with a supported Ruby (the current 3.4.x, or newer if CI and gems allow). The workflows (`ruby/setup-ruby` reads it automatically), rbenv/asdf in WSL, and the docs all use this one file.
2. **Upgrade Jekyll to 4.4.x** and pin `gem "jekyll", "~> 4.4"`. Jekyll 4.4 declares `csv`, `base64` and similar gems that Ruby 3.4 no longer bundles by default. On 4.3.3 with Ruby 3.4 you'd need to add them to the Gemfile yourself.
3. **Fix Windows gem issues.** Change `gem "wdm", "~> 0.1.0"` to `">= 0.2"` (0.1.x doesn't compile on Ruby 3.x), or remove it and use `--force_polling`. Keep `tzinfo-data`.
4. **Add lockfile platforms.** Run `bundle lock --add-platform x64-mingw-ucrt x86_64-linux` so that WSL, Windows and CI all resolve the same lockfile (`sass-embedded` and `google-protobuf` ship per-platform builds). Commit the regenerated `Gemfile.lock` and record the actual Bundler version in the docs.
5. **Delete `package.json`.** It's the theme's unused gulp/browser-sync setup, and Node isn't part of the build. Vendored Bootstrap and Font Awesome are already under `assets/vendor/`.
6. **Optional:** a `.devcontainer/devcontainer.json` for option C.

### Documentation deliverable

Rewrite the README "Building & Testing Locally" section (it also fixes the "Buidling" and "dervied" typos), or move it into `docs/building.md` and link to it from the README. Contents:

- **Prerequisites:** the Ruby version from `.ruby-version` and Bundler from `Gemfile.lock`. No hard-coded versions in prose.
- **WSL2 (recommended):**
  ```bash
  sudo apt update && sudo apt install -y build-essential git libyaml-dev libffi-dev zlib1g-dev libssl-dev
  # install rbenv + ruby-build (or mise/asdf), then:
  rbenv install "$(cat .ruby-version)"
  gem install bundler
  bundle install
  bundle exec jekyll serve --livereload            # http://localhost:4000
  bundle exec jekyll serve --livereload --future   # preview future-dated episodes
  ```
  Add a note to clone under `~`, not `/mnt/e`. If you must work from `/mnt/e`, add `--force_polling`.
- **Native Windows:** install RubyInstaller *with DevKit* for the version in `.ruby-version`, run `ridk install` (option 3), then the same `bundle` commands in PowerShell.
- **Docker / Dev Container:** a one-liner or "Reopen in Container".
- **Releasing:** the tag flow from section 1.
- **Troubleshooting:** platform missing from the lockfile, `wdm` build failures, port 4000 already in use, and file watching not firing under `/mnt`.

### Acceptance criteria

- [ ] A fresh WSL2 Ubuntu clone builds and serves using only the documented steps.
- [ ] A fresh native Windows machine builds and serves using only the documented steps.
- [ ] CI, `.ruby-version` and the docs all reference the same Ruby version.
- [ ] `bundle install` doesn't modify `Gemfile.lock` on any of the three platforms.

---

## 3. Keep Jekyll or switch?

### What the site actually uses

- About 20 posts with rich front matter (`tracklist`, `mp3streamurl`, `downloadurl`, `duration`, `background`, `tags`).
- Liquid layouts and includes (`default`, `home`, `mix`, `page`, `post`) based on the Clean Blog theme.
- A **hand-written podcast RSS feed** (`feed/podcast.xml`) with iTunes, Google Play and Podcasting 2.0 namespaces, plus an XSL stylesheet.
- One custom filter (`time_seconds`).
- Plugins: `jekyll-paginate-v2`, `jekyll-feed`, `jekyll-sitemap`.
- The output is plain static files synced to S3 with no server logic.

### Alternatives

| Generator | Language | Windows story | Migration cost for this repo | Notes |
|---|---|---|---|---|
| **Jekyll** (stay) | Ruby | OK after the section 2 fixes | None | Mature and stable, but development has slowed. Ruby is the main source of friction locally. |
| **Eleventy (11ty)** | Node | Excellent | **Low.** It supports Liquid natively, so layouts, includes, `_posts` front matter and `podcast.xml` port with little change. `time_seconds` is a few lines of JS. Pagination is built in. Sitemap is a template or plugin. | The closest drop-in replacement. Single `npm install`. |
| **Hugo** | Go (single binary) | Excellent (`winget install Hugo.Hugo.Extended`) | **Medium–high.** Every Liquid template must be rewritten in Go templates, and the podcast feed rewritten as a custom output format. | Fastest builds and no runtime dependencies. Template syntax is less friendly. |
| **Astro** | Node | Excellent | High. Rewrite as components. | More than a static blog plus feed needs. |
| **Zola** | Rust (single binary) | Good | High. Tera templates. | Small ecosystem. |

### Recommendation

**Keep Jekyll for now.** Do sections 1 and 2 first. Most of the current pain comes from CI being wired to `main` and from Ruby being under-documented on Windows, not from Jekyll itself. Once `.ruby-version`, the lockfile platforms and WSL2 docs are in place, Jekyll is low-maintenance for a site this size.

**If you later decide to switch, choose Eleventy over Hugo.** Because Eleventy speaks Liquid, the custom podcast feed and the `mix` layout (the parts most likely to break subtly) can move across almost unchanged. You would also lose Ruby entirely and gain a first-class native Windows workflow.

Revisit the decision if any of these happen:
- a Jekyll or plugin release blocks upgrading Ruby (for example, `jekyll-paginate-v2` hasn't had a release since 2019 and is the most likely to break);
- you want to stop using WSL2 or Docker and build natively on Windows;
- the site grows to need components or interactive pages.

If a migration does happen, it should be its own plan (`docs/plans/eleventy-migration.md`). Validate it by diffing the generated `_site` (especially `feed/podcast.xml`, `sitemap.xml` and permalinks) against the Jekyll output before switching the deploy.

---

## Suggested order of work

Done so far:
- PR 1 file changes. `.travis.yml` was removed separately in `4990d51`. `bin/cibuild`, `gulpfile.js` and `package-lock.json` were removed as well. `_config.yml` also excludes `docs/`, `README.md`, `LICENSE` and the theme gemspec from the published site.
- PR 3 (`.ruby-version` is 3.3.8 to match Ubuntu 26.04's packaged Ruby, Jekyll 4.4.1, Bundler 4.0.23, all advisories cleared).
- PR 4 (README covers WSL2 setup, native Windows as an untested option, and releasing). Docker and dev container docs were not added.

1. **PR 1 (CI):** add `build.yml` and `deploy.yml`, delete `jekyll_build.yml`, `.travis.yml` and `script/cibuild`, set the timezone, update the README badge. Then set up the tag ruleset and branch protection in GitHub settings.
2. **PR 2 (AWS OIDC):** create the IAM role, switch `deploy.yml` to `role-to-assume`, and remove the static key secrets.
3. **PR 3 (toolchain):** add `.ruby-version`, upgrade Ruby and Jekyll, fix the Gemfile, add lockfile platforms, delete `package.json`, update the CI Ruby setup.
4. **PR 4 (docs):** rewrite the local build docs for WSL2, Windows and Docker, plus the release process.
5. **Later and optional:** the Eleventy spike, behind its own plan.
