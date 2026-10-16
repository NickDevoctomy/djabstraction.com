# djabstraction.com

[![Build](https://github.com/NickDevoctomy/djabstraction.com/actions/workflows/build.yml/badge.svg)](https://github.com/NickDevoctomy/djabstraction.com/actions/workflows/build.yml)
[![Deploy](https://github.com/NickDevoctomy/djabstraction.com/actions/workflows/deploy.yml/badge.svg)](https://github.com/NickDevoctomy/djabstraction.com/actions/workflows/deploy.yml)

This is the source code for djabstraction.com, built with the static site generator Jekyll and deployed to Amazon S3.

## Building & Testing Locally

The recommended setup is Ubuntu under WSL2, which matches the Ubuntu machine CI builds on. These steps were tested on a fresh Ubuntu 26.04 WSL2 distro.

### 1. Install Ruby and build tools

Run this **inside the Ubuntu shell** (a `user@host:~$` prompt), not in PowerShell. Windows 11 has its own `sudo`, so running this in PowerShell does nothing useful.

```bash
sudo apt-get update
sudo apt-get install -y ruby-full build-essential zlib1g-dev
```

This installs Ubuntu's packaged Ruby (3.3 on 26.04) plus the compiler that some gems need (`eventmachine`, `ffi`, `http_parser.rb`). CI uses the exact version in `.ruby-version`; any 3.3.x works locally.

To run the install from PowerShell instead, without opening the distro:

```powershell
wsl -d Ubuntu-26.04 -u root -- sh -c "apt-get update && apt-get install -y ruby-full build-essential zlib1g-dev"
```

### 2. Install gems into your home folder

This lets you run `gem` and `bundle` without `sudo`:

```bash
cat >> ~/.bashrc <<'EOF'

# Ruby gems in user home (no sudo needed)
export GEM_HOME="$HOME/.gem"
export PATH="$GEM_HOME/bin:$PATH"
EOF
source ~/.bashrc
```

### 3. Install Bundler and the site's gems

From the repository root, install the Bundler version recorded in `Gemfile.lock`, then the gems:

```bash
gem install bundler -v "$(tail -1 Gemfile.lock | tr -d ' ')" --no-document
bundle install
```

### 4. Build and serve

```bash
bundle exec jekyll build                  # output goes to _site/
bundle exec jekyll serve --force_polling  # http://localhost:4000
bundle exec jekyll serve --force_polling --future  # include future-dated posts
```

The site is available from the Windows browser at http://localhost:4000. WSL2 forwards localhost automatically.

### 5. Validate the feeds

After a build, check that the podcast feed and Atom feed are valid:

```bash
bundle exec ruby .github/scripts/validate-feeds.rb
```

CI runs this after every build. If it fails, the build fails, and a deploy stops before anything is uploaded to S3.

### Notes

* **Where to clone.** Working from the Windows drive (e.g. `/mnt/e/Source/GitHub/djabstraction.com`) works, but each build takes 15–40 seconds and `--force_polling` is needed because file-change notifications don't reach Ubuntu there. For faster builds, clone inside the distro, e.g. `~/src/djabstraction.com`, and you can drop `--force_polling`.
* **Sass warnings.** Deprecation warnings about `@import` come from the vendored Bootstrap and Clean Blog SCSS. They're harmless for now.
* **systemd warning.** If `wsl` prints "Failed to start the systemd user session", you can ignore it; it doesn't affect the build. `wsl --shutdown` from PowerShell usually clears it.
* **Native Windows.** `Gemfile.lock` also includes the Windows platform, so building without WSL should work with [RubyInstaller](https://rubyinstaller.org/) (with DevKit) for the version in `.ruby-version`, followed by the same `gem install bundler` / `bundle install` / `bundle exec jekyll serve` steps in PowerShell. This route hasn't been tested; WSL2 is the supported setup.
* **Security audit.** `gem install bundler-audit && bundle-audit check --update` checks the locked gems against the Ruby advisory database.

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
