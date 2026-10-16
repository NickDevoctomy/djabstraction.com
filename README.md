# djabstraction.com

[![Build](https://github.com/NickDevoctomy/djabstraction.com/actions/workflows/build.yml/badge.svg)](https://github.com/NickDevoctomy/djabstraction.com/actions/workflows/build.yml)
[![Deploy](https://github.com/NickDevoctomy/djabstraction.com/actions/workflows/deploy.yml/badge.svg)](https://github.com/NickDevoctomy/djabstraction.com/actions/workflows/deploy.yml)

This is the source code for djabstraction.com, built with the static site generator [Eleventy](https://www.11ty.dev/) and deployed to Amazon S3.

## Building & Testing Locally

The recommended setup is Ubuntu under WSL2, which matches the Ubuntu machine CI builds on. These steps were tested on Ubuntu 26.04 under WSL2.

### 1. Install Node.js

Run this **inside the Ubuntu shell** (a `user@host:~$` prompt), not in PowerShell. Windows 11 has its own `sudo`, so running this in PowerShell does nothing useful.

```bash
sudo apt-get update
sudo apt-get install -y nodejs npm
```

Ubuntu 26.04 packages Node 22. CI uses the major version in `.nvmrc`.

To run the install from PowerShell instead, without opening the distro:

```powershell
wsl -d Ubuntu-26.04 -u root -- sh -c "apt-get update && apt-get install -y nodejs npm"
```

### 2. Install the site's packages

From the repository root:

```bash
npm ci
```

This installs the exact versions in `package-lock.json` into `node_modules/`.

### 3. Build and serve

```bash
npm run build   # output goes to _site/
npm run serve   # http://localhost:8080, rebuilds when files change
```

The site is available from the Windows browser at http://localhost:8080. WSL2 forwards localhost automatically.

Post dates are shown in London time (`Europe/London`). The build sets this itself, so no `TZ` setting is needed.

Posts dated in the future are left out of the build. To preview one, temporarily give it a past date.

### 4. Validate the feeds

After a build, check that the podcast feed and Atom feed are valid:

```bash
npm run validate
```

CI runs this after every build. If it fails, the build fails, and a deploy stops before anything is uploaded to S3.

To compare the built feeds with the live site (whitespace, build times and date formatting are ignored):

```bash
npm run compare-feeds                                         # _site feeds vs https://www.djabstraction.com
npm run compare-feeds -- _site/feed/podcast.xml other/podcast.xml  # any two files or URLs
```

### Notes

* **Where to clone.** Working from the Windows drive (e.g. `/mnt/e/Source/GitHub/djabstraction.com`) works. File-change notifications don't reach Ubuntu there, so `npm run serve` polls for changes. For faster builds, clone inside the distro, e.g. `~/src/djabstraction.com`.
* **Sass warnings.** The build hides Sass deprecation warnings caused by `@import` in the vendored Bootstrap and Clean Blog SCSS. They're harmless for now.
* **systemd warning.** If `wsl` prints "Failed to start the systemd user session", you can ignore it; it doesn't affect the build. `wsl --shutdown` from PowerShell usually clears it.
* **Native Windows.** With Node 22 installed on Windows, `npm ci`, `npm run build` and `npm run serve` should also work in PowerShell. This route hasn't been tested; WSL2 is the supported setup.
* **Security audit.** `npm audit` checks the locked packages against the npm advisory database.

## Releasing

Merging to `main` does **not** deploy. The [Build](.github/workflows/build.yml) workflow builds and validates every push to any branch, and every pull request.

To publish, tag a commit on `main` and push the tag:

```bash
git checkout main && git pull
git tag -a v2026.10.16 -m "Release notes"
git push origin v2026.10.16
```

The [Deploy](.github/workflows/deploy.yml) workflow then builds the site, syncs it to S3, and invalidates the CloudFront cache. It refuses to deploy anything that isn't a `v*` tag on a commit in `main`. Use `vYYYY.MM.DD` for tags, and add `.1`, `.2` and so on for a second release on the same day.

Posts dated in the future aren't published until a deploy runs on or after their date. Tag on release day.

To redeploy an existing tag, run the Deploy workflow manually from the Actions tab and pick the tag as the ref.

## Acknowledgements

This site was derived from the Jekyll Theme, [Clean Blog](https://startbootstrap.com/theme/clean-blog-jekyll) by [StartBootstrap](https://github.com/StartBootstrap).
