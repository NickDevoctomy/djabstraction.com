// djabstraction.com front end.
//
// - Player: one <audio> element outside <main>, with a mini player bar, lock
//   screen controls (Media Session) and resume from the last position.
// - Navigation: same-site links swap <main> in place instead of loading a new
//   page, so the player keeps playing. Any failure falls back to a normal
//   page load.
// - Search, copy/share buttons, the menu, the cookie notice and the service
//   worker.
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // 3725 -> "01:02:05"
  const clock = (secs) => {
    const s = Math.max(0, Math.floor(secs || 0));
    return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, "0")).join(":");
  };
  const pad2 = (n) => String(n).padStart(2, "0");

  // localStorage can be missing or throw (private windows, blocked storage).
  const store = {
    get(key) {
      try {
        return JSON.parse(localStorage.getItem(key));
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* not available */
      }
    }
  };

  // --- Toast and clipboard ----------------------------------------------------

  let toastTimer;
  function toast(message) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2400);
  }

  async function copy(text, message) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const input = document.createElement("textarea");
      input.value = text;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      try {
        document.execCommand("copy");
      } catch {
        /* nothing more to try */
      }
      input.remove();
    }
    toast(message || "Copied");
  }

  // --- Player -----------------------------------------------------------------

  const Player = (() => {
    const audio = $("#audio");
    const bar = $("#miniplayer");
    const ui = {
      cover: $("[data-mp-cover]", bar),
      link: $("[data-mp-link]", bar),
      track: $("[data-mp-track]", bar),
      episode: $("[data-mp-episode]", bar),
      time: $("[data-mp-time]", bar),
      duration: $("[data-mp-duration]", bar),
      fill: $("[data-mp-fill]", bar),
      seek: $("[data-mp-seek]", bar),
      toggle: $("[data-mp-toggle]", bar)
    };
    const SAVE_KEY = "dja-player";
    const media = "mediaSession" in navigator ? navigator.mediaSession : null;

    let ep = null; // the loaded episode (see episode_json in _11ty/afterglow.js)
    let pending = null; // a seek waiting for the audio to load
    let chapter = -1;
    let lastSave = 0;
    let lastPosition = 0;
    let seeking = false;

    const playing = () => !!ep && !audio.paused;
    const now = () => (pending != null ? pending : audio.currentTime || 0);
    const length = () => (ep && ep.duration) || audio.duration || 0;

    function chapterAt(t) {
      if (!ep || !ep.tracks.length) return -1;
      let i = 0;
      ep.tracks.forEach((track, k) => {
        if (track.s <= t + 0.5) i = k;
      });
      return i;
    }

    function load(episode, { at = 0, play = false } = {}) {
      if (!ep || ep.id !== episode.id) {
        ep = episode;
        chapter = -1;
        pending = at || null;
        audio.src = ep.src;
        ui.cover.src = ep.cover;
        ui.link.href = ep.url;
        ui.episode.textContent = ep.title;
        ui.duration.textContent = clock(ep.duration);
      } else if (at != null) {
        seek(at);
      }
      bar.hidden = false;
      document.body.classList.add("has-player");
      if (play) start();
      render();
    }

    function start() {
      const result = audio.play();
      if (result && result.catch) result.catch(() => render());
    }

    function seek(t) {
      const target = Math.max(0, Math.min(t, length() || t));
      if (audio.readyState >= 1) {
        audio.currentTime = target;
        pending = null;
      } else {
        pending = target;
      }
      render();
    }

    // Play an episode, or toggle it if it's already loaded. With `at`, jump
    // there and play.
    function playEpisode(episode, at) {
      if (ep && ep.id === episode.id) {
        if (at != null) {
          seek(at);
          start();
        } else {
          toggle();
        }
      } else {
        load(episode, { at: at || 0, play: true });
      }
    }

    function toggle() {
      if (!ep) return;
      if (audio.paused) start();
      else audio.pause();
    }

    function skip(direction) {
      if (!ep) return;
      const i = chapterAt(now());
      if (direction < 0 && now() - ep.tracks[i].s > 5) return seek(ep.tracks[i].s);
      const next = ep.tracks[i + direction];
      if (next) seek(next.s);
    }

    function close() {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      ep = null;
      pending = null;
      bar.hidden = true;
      document.body.classList.remove("has-player");
      store.set(SAVE_KEY, null);
      if (media) media.metadata = null;
      render();
    }

    function save(force) {
      if (!ep) return;
      const stamp = Date.now();
      if (!force && stamp - lastSave < 5000) return;
      lastSave = stamp;
      store.set(SAVE_KEY, { ep, t: Math.floor(now()) });
    }

    function updateMediaSession(i) {
      if (!media || !ep) return;
      const track = ep.tracks[i] || {};
      try {
        media.metadata = new MediaMetadata({
          title: track.t || ep.title,
          artist: track.a || "DJ Abstraction",
          album: ep.title,
          artwork: ep.cover ? [{ src: ep.cover, sizes: "1400x1400", type: "image/jpeg" }] : []
        });
      } catch {
        /* MediaMetadata not supported */
      }
    }

    function updatePosition() {
      if (!media || !media.setPositionState || !ep) return;
      const duration = audio.duration;
      if (!isFinite(duration) || duration <= 0) return;
      try {
        media.setPositionState({ duration, playbackRate: audio.playbackRate, position: Math.min(audio.currentTime, duration) });
      } catch {
        /* ignore */
      }
    }

    // The mix page's player card, timeline and tracklist.
    function renderCard(t, i) {
      const card = $(".player-card[data-episode]");
      if (!card) return;
      if (!card._ep) card._ep = JSON.parse(card.dataset.episode);
      const cardEp = card._ep;
      const current = !!ep && ep.id === cardEp.id;
      const active = current ? i : -1;
      const time = current ? t : 0;

      let fill = 0;
      if (active >= 0) {
        const start = cardEp.tracks[active].s;
        const end = active + 1 < cardEp.tracks.length ? cardEp.tracks[active + 1].s : cardEp.duration;
        fill = Math.max(0, Math.min(1, (time - start) / Math.max(1, end - start)));
      }

      $$(".timeline__seg", card).forEach((seg, k) => {
        seg.classList.toggle("is-played", k < active);
        seg.classList.toggle("is-active", k === active);
        seg.style.setProperty("--fill", k === active ? `${(fill * 100).toFixed(1)}%` : "0%");
      });
      $$(".timeline__cue", card).forEach((cue, k) => cue.classList.toggle("is-reached", k <= active));
      $$(".tracklist .track").forEach((row, k) => row.classList.toggle("is-active", k === active));

      const shown = Math.max(0, active);
      const track = cardEp.tracks[shown];
      if (track) {
        $("[data-now-label]", card).textContent =
          `Track ${pad2(shown + 1)} of ${pad2(cardEp.tracks.length)} · starts ${clock(track.s)}`;
        $("[data-now-line]", card).textContent = `${track.a} — ${track.t}`;
      }
      $("[data-now-time]", card).textContent = clock(time);
    }

    function render() {
      const t = now();
      const i = chapterAt(t);

      if (ep) {
        const d = length();
        const pct = d ? Math.min(100, (t / d) * 100) : 0;
        ui.fill.style.width = `${pct}%`;
        if (!seeking) ui.seek.value = String(Math.round(pct * 10));
        ui.seek.setAttribute("aria-valuetext", `${clock(t)} of ${clock(d)}`);
        ui.time.textContent = clock(t);
        if (i !== chapter) {
          chapter = i;
          const track = ep.tracks[i];
          ui.track.textContent = track ? track.t : ep.title;
          ui.episode.textContent = track ? `${track.a} · ${ep.title}` : ep.title;
          updateMediaSession(i);
        }
      }

      const isPlaying = playing();
      bar.classList.toggle("is-playing", isPlaying);
      ui.toggle.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
      $$("[data-play-episode]").forEach((btn) => {
        const on = isPlaying && btn.dataset.playEpisode === ep.id;
        btn.classList.toggle("is-playing", on);
        btn.setAttribute("aria-pressed", String(on));
      });
      renderCard(t, i);
    }

    // Wiring.
    audio.addEventListener("loadedmetadata", () => {
      if (pending != null) {
        audio.currentTime = pending;
        pending = null;
      }
      updatePosition();
    });
    audio.addEventListener("timeupdate", () => {
      render();
      if (playing()) save(false);
      if (Math.abs(audio.currentTime - lastPosition) > 4) {
        lastPosition = audio.currentTime;
        updatePosition();
      }
    });
    for (const type of ["play", "pause", "seeked", "ended"]) {
      audio.addEventListener(type, () => {
        render();
        save(true);
        updatePosition();
        if (media) media.playbackState = audio.paused ? "paused" : "playing";
      });
    }

    ui.seek.addEventListener("input", () => {
      seeking = true;
      const d = length();
      ui.time.textContent = clock((Number(ui.seek.value) / 1000) * d);
      ui.fill.style.width = `${Number(ui.seek.value) / 10}%`;
    });
    ui.seek.addEventListener("change", () => {
      seeking = false;
      seek((Number(ui.seek.value) / 1000) * length());
    });

    if (media) {
      const handlers = {
        play: () => start(),
        pause: () => audio.pause(),
        previoustrack: () => skip(-1),
        nexttrack: () => skip(1),
        seekbackward: (d) => seek(now() - (d.seekOffset || 10)),
        seekforward: (d) => seek(now() + (d.seekOffset || 30)),
        seekto: (d) => seek(d.seekTime)
      };
      for (const [action, handler] of Object.entries(handlers)) {
        try {
          media.setActionHandler(action, handler);
        } catch {
          /* action not supported */
        }
      }
    }

    window.addEventListener("pagehide", () => save(true));

    // Pick up where the listener left off, paused.
    const saved = store.get(SAVE_KEY);
    if (saved && saved.ep && saved.ep.src) load(saved.ep, { at: saved.t || 0, play: false });

    return { playEpisode, toggle, skip, close, render };
  })();

  // The episode a button belongs to: its own data-episode, else the page's.
  function episodeFor(el) {
    const holder = el.closest("[data-episode]") || $(".player-card[data-episode]");
    if (!holder) return null;
    if (!holder._ep) holder._ep = JSON.parse(holder.dataset.episode);
    return holder._ep;
  }

  // --- Search -------------------------------------------------------------------

  function initSearch(root) {
    const indexEl = $("[data-search-index]", root);
    if (!indexEl) return;
    const items = JSON.parse(indexEl.textContent);
    const input = $("[data-search-input]", root);
    const list = $("[data-search-results]", root);
    const empty = $("[data-search-empty]", root);
    const summary = $("[data-search-summary]", root);
    const sortBtn = $("[data-search-sort]", root);
    const typeGroup = $('[data-filter="type"]', root);
    const tagGroup = $('[data-filter="tags"]', root);
    const yearGroup = $('[data-filter="year"]', root);

    const params = new URLSearchParams(location.search);
    const state = {
      q: params.get("q") || "",
      type: params.get("type") || "all",
      tags: params.getAll("tag").flatMap((t) => t.split(",")).filter(Boolean),
      year: params.get("year") || "",
      oldest: params.get("sort") === "oldest"
    };

    // Searchable text for each item, worked out once.
    for (const item of items) {
      item._text = [item.title, item.genre, item.excerpt, item.tags.join(" ")].join(" ").toLowerCase();
      item._tracks = item.tracks.map((t) => `${t.artist} ${t.title} ${t.label}`.toLowerCase());
    }

    const count = (key) => {
      const counts = new Map();
      for (const item of items) for (const value of [].concat(item[key])) counts.set(value, (counts.get(value) || 0) + 1);
      return counts;
    };
    const tagCounts = [...count("tags")].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const years = [...count("year").keys()].sort().reverse();

    const pill = (label, value, extra) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill";
      btn.dataset.value = value;
      btn.textContent = label;
      if (extra != null) {
        const small = document.createElement("small");
        small.textContent = extra;
        btn.append(" ", small);
      }
      return btn;
    };
    tagGroup.replaceChildren(...tagCounts.map(([tag, n]) => pill(tag, tag, n)));
    yearGroup.replaceChildren(pill("Any", ""), ...years.map((y) => pill(y, y)));

    function matches(item, words) {
      let track = null;
      for (const word of words) {
        if (item._text.includes(word)) continue;
        const k = item._tracks.findIndex((t) => t.includes(word));
        if (k < 0) return null;
        if (!track) track = item.tracks[k];
      }
      // Show a track hit even when the text matched too, if one fits the whole query.
      if (!track && words.length) {
        const k = item._tracks.findIndex((t) => words.every((w) => t.includes(w)));
        if (k >= 0 && !item.title.toLowerCase().includes(words.join(" "))) track = item.tracks[k];
      }
      return { track };
    }

    function resultEl(item, hit) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.className = "result";
      a.href = hit.track && hit.track.start ? `${item.url}?t=${encodeURIComponent(hit.track.start)}` : item.url;

      if (item.image) {
        const img = document.createElement("img");
        img.className = "result__art";
        img.src = item.image;
        img.alt = "";
        img.width = 96;
        img.height = 96;
        img.loading = "lazy";
        a.append(img);
      } else {
        const ph = document.createElement("span");
        ph.className = "result__art result__art--post";
        ph.innerHTML =
          '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M9 11h7M9 15h7M9 7h3"/></svg>';
        a.append(ph);
      }

      const text = document.createElement("span");
      text.className = "result__text";
      const meta = document.createElement("span");
      meta.className = "result__meta";
      meta.textContent = [item.type === "mix" ? `Mix · ${item.genre}` : "Post", item.dateLabel, item.duration]
        .filter(Boolean)
        .join(" · ");
      const title = document.createElement("strong");
      title.className = "result__title";
      title.textContent = item.title;
      const excerpt = document.createElement("span");
      excerpt.className = "result__excerpt";
      excerpt.textContent = item.excerpt;
      text.append(meta, title, excerpt);
      if (hit.track) {
        const match = document.createElement("span");
        match.className = "result__match";
        match.textContent = `Track: ${hit.track.artist} — ${hit.track.title}${hit.track.start ? ` · ${hit.track.start}` : ""}`;
        text.append(match);
      }
      a.append(text);
      li.append(a);
      return li;
    }

    function render() {
      const q = state.q.trim().toLowerCase();
      const words = q.split(/\s+/).filter(Boolean);
      let results = [];
      for (const item of items) {
        if (state.type !== "all" && item.type !== state.type) continue;
        if (state.year && item.year !== state.year) continue;
        if (!state.tags.every((t) => item.tags.includes(t))) continue;
        const hit = matches(item, words);
        if (hit) results.push([item, hit]);
      }
      if (state.oldest) results = results.reverse();

      list.replaceChildren(...results.map(([item, hit]) => resultEl(item, hit)));
      empty.hidden = results.length > 0;
      summary.textContent = `${results.length} ${results.length === 1 ? "result" : "results"}${q ? ` for “${state.q.trim()}”` : ""}`;
      sortBtn.textContent = state.oldest ? "Sort: Oldest first" : "Sort: Newest first";

      for (const btn of $$("button", typeGroup)) btn.setAttribute("aria-pressed", String(btn.dataset.value === state.type));
      for (const btn of $$("button", tagGroup)) btn.setAttribute("aria-pressed", String(state.tags.includes(btn.dataset.value)));
      for (const btn of $$("button", yearGroup)) btn.setAttribute("aria-pressed", String(btn.dataset.value === state.year));

      const next = new URLSearchParams();
      if (state.q.trim()) next.set("q", state.q.trim());
      if (state.type !== "all") next.set("type", state.type);
      if (state.tags.length) next.set("tag", state.tags.join(","));
      if (state.year) next.set("year", state.year);
      if (state.oldest) next.set("sort", "oldest");
      const qs = next.toString();
      history.replaceState(history.state, "", `${location.pathname}${qs ? `?${qs}` : ""}`);
    }

    input.value = state.q;
    input.addEventListener("input", () => {
      state.q = input.value;
      render();
    });
    $("[data-search-form]", root).addEventListener("submit", (e) => {
      e.preventDefault();
      input.blur();
    });
    typeGroup.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      state.type = btn.dataset.value;
      render();
    });
    tagGroup.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const tag = btn.dataset.value;
      state.tags = state.tags.includes(tag) ? state.tags.filter((t) => t !== tag) : state.tags.concat(tag);
      render();
    });
    yearGroup.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      state.year = btn.dataset.value;
      render();
    });
    sortBtn.addEventListener("click", () => {
      state.oldest = !state.oldest;
      render();
    });
    $("[data-search-reset]", root).addEventListener("click", () => {
      Object.assign(state, { q: "", type: "all", tags: [], year: "", oldest: false });
      input.value = "";
      render();
    });

    render();
    if (!state.q && matchMedia("(pointer: fine)").matches) input.focus({ preventScroll: true });
  }

  // --- Per-page setup (first load and after every swap) ------------------------

  function initPage() {
    const main = $("#main");

    // Long mix stories start collapsed.
    for (const box of $$("[data-clamp]", main)) {
      const toggle = box.parentElement.querySelector("[data-clamp-toggle]");
      if (box.scrollHeight > 460 && toggle) {
        box.classList.add("is-clamped");
        toggle.hidden = false;
      }
    }

    // Arriving from a search track hit: /2025/06/08/x.html?t=00:53:59
    const t = new URLSearchParams(location.search).get("t");
    if (t) {
      const secs = t.split(":").reduce((acc, n) => acc * 60 + Number(n), 0);
      const row = $$(".track", main).find((li) => {
        const btn = $("[data-seek]", li);
        return btn && Number(btn.dataset.seek) === secs;
      });
      if (row) {
        row.classList.add("is-highlighted");
        row.scrollIntoView({ block: "center" });
      }
    }

    initSearch(main);
    Player.render();
  }

  // --- Clicks ---------------------------------------------------------------------

  const header = $("#site-header");

  function setMenu(open) {
    header.classList.toggle("is-open", open);
    $("[data-menu-toggle]").setAttribute("aria-expanded", String(open));
  }

  document.addEventListener("click", (e) => {
    const target = e.target.closest(
      "[data-play-episode], [data-seek], [data-copy], [data-copy-page], [data-share], [data-clamp-toggle], [data-menu-toggle], [data-cookie-ok], [data-mp-toggle], [data-mp-prev], [data-mp-next], [data-mp-close]"
    );
    if (!target) return;
    const d = target.dataset;

    if ("playEpisode" in d) {
      const ep = episodeFor(target);
      if (ep) Player.playEpisode(ep);
    } else if ("seek" in d) {
      const ep = episodeFor(target);
      if (ep) Player.playEpisode(ep, Number(d.seek));
    } else if ("copy" in d) {
      copy(d.copy, d.copyMessage);
    } else if ("copyPage" in d) {
      copy(location.href.split("?")[0], "Link copied");
    } else if ("share" in d) {
      const url = location.href.split("?")[0];
      if (navigator.share) navigator.share({ title: d.shareTitle || document.title, url }).catch(() => {});
      else copy(url, "Link copied");
    } else if ("clampToggle" in d) {
      const box = target.parentElement.querySelector("[data-clamp]");
      if (box) box.classList.remove("is-clamped");
      target.hidden = true;
    } else if ("menuToggle" in d) {
      setMenu(!header.classList.contains("is-open"));
    } else if ("cookieOk" in d) {
      document.cookie = "cookieconsent_status=ok; max-age=157680000; path=/; SameSite=Lax";
      $("#cookie-notice").hidden = true;
    } else if ("mpToggle" in d) {
      Player.toggle();
    } else if ("mpPrev" in d) {
      Player.skip(-1);
    } else if ("mpNext" in d) {
      Player.skip(1);
    } else if ("mpClose" in d) {
      Player.close();
    }
  });

  // --- In-place navigation -------------------------------------------------------

  const SKIP_EXT = /\.(xml|xsl|zip|mp3|json|png|jpe?g|webp|gif|svg|ico|txt|pdf)$/i;

  function swappable(a, e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
    if ((a.target && a.target !== "_self") || a.hasAttribute("download") || "noSwap" in a.dataset) return null;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || SKIP_EXT.test(url.pathname)) return null;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return null;
    return url;
  }

  let navId = 0;
  async function navigate(url, { push = true, scroll = 0 } = {}) {
    const id = ++navId;
    setMenu(false);
    document.documentElement.classList.add("is-loading");
    try {
      const res = await fetch(url.href, { headers: { Accept: "text/html" } });
      const type = res.headers.get("content-type") || "";
      if (!res.ok || !type.includes("text/html")) throw new Error("not a page");
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      const next = doc.getElementById("main");
      if (!next) throw new Error("no <main>");
      if (id !== navId) return;

      if (push) {
        history.replaceState({ ...history.state, scroll: window.scrollY }, "");
        history.pushState({ scroll: 0 }, "", url.href);
      }
      document.title = doc.title;
      for (const sel of ['meta[name="description"]', 'link[rel="canonical"]']) {
        const fresh = doc.head.querySelector(sel);
        const old = document.head.querySelector(sel);
        if (fresh && old) old.replaceWith(fresh);
      }
      $("#main").replaceWith(document.adoptNode(next));

      for (const link of $$("[data-nav]", header)) {
        if (link.dataset.nav === next.dataset.nav) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      }

      const anchor = url.hash && document.getElementById(decodeURIComponent(url.hash.slice(1)));
      if (anchor) anchor.scrollIntoView();
      else window.scrollTo(0, scroll);
      next.focus({ preventScroll: true });

      initPage();
      if (window.dataLayer) window.dataLayer.push({ event: "virtual_pageview", page_path: url.pathname + url.search });
    } catch {
      location.assign(url.href);
    } finally {
      document.documentElement.classList.remove("is-loading");
    }
  }

  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a) return;
    const url = swappable(a, e);
    if (!url) return;
    e.preventDefault();
    navigate(url);
  });

  window.addEventListener("popstate", (e) => {
    navigate(new URL(location.href), { push: false, scroll: (e.state && e.state.scroll) || 0 });
  });

  // --- Header, cookie notice, service worker ----------------------------------------

  const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  if (!/(^|;\s*)cookieconsent_status=/.test(document.cookie)) $("#cookie-notice").hidden = false;

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  history.replaceState({ ...history.state, scroll: window.scrollY }, "");
  initPage();
})();
