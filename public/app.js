// ViralLens front-end: frame extraction, API calls, report rendering, viral library.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const fmtTime = (t) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
};

const MAX_FRAMES = 28;
const FRAME_MAX_SIDE = 768;
const LIB_KEY = "virallens.library.v1";

// ---------------- Tabs ----------------
$$(".tab").forEach((btn) =>
  btn.addEventListener("click", () => {
    $$(".tab").forEach((b) => b.classList.toggle("active", b === btn));
    $$(".panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${btn.dataset.tab}`));
    if (btn.dataset.tab === "library") renderLibrary();
  }),
);

// ---------------- File inputs ----------------
const files = { analyze: null, research: null };

function setupDrop(kind) {
  const drop = $(`.drop[data-input="${kind}-file"]`);
  const input = $(`#${kind}-file`);
  const preview = $(`#${kind}-preview`);
  const pick = (file) => {
    if (!file || !file.type.startsWith("video/")) return;
    files[kind] = file;
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
    drop.querySelector("span").textContent = `${file.name} — bấm để đổi video`;
  };
  input.addEventListener("change", () => pick(input.files[0]));
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    pick(e.dataTransfer.files[0]);
  });
}
setupDrop("analyze");
setupDrop("research");

// ---------------- Frame extraction ----------------
// The first 3 seconds are sampled densely (hook), the rest evenly.
function sampleTimes(duration) {
  const hook = [0, 0.5, 1, 1.5, 2, 2.5, 3].filter((t) => t < duration);
  const remaining = MAX_FRAMES - hook.length;
  const start = 3.5;
  const end = Math.max(start, duration - 0.15);
  const times = [...hook];
  if (duration > start && remaining > 0) {
    const n = Math.min(remaining, Math.ceil((end - start) / 0.75) + 1);
    for (let i = 0; i < n; i++) times.push(n === 1 ? start : start + ((end - start) * i) / (n - 1));
  }
  return times;
}

function loadVideo(file) {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = URL.createObjectURL(file);
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error("Trình duyệt không đọc được video này (thử MP4/H.264)."));
  });
}

function seek(video, t) {
  return new Promise((resolve) => {
    const done = () => { video.removeEventListener("seeked", done); resolve(); };
    video.addEventListener("seeked", done);
    video.currentTime = t;
  });
}

async function extractFrames(file, onProgress) {
  const video = await loadVideo(file);
  const { duration, videoWidth: w, videoHeight: h } = video;
  const scale = Math.min(1, FRAME_MAX_SIDE / Math.max(w, h));
  const canvas = $("#frame-canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  const frames = [];
  const times = sampleTimes(duration);
  for (const [i, t] of times.entries()) {
    await seek(video, t);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    frames.push({ t: Math.round(t * 10) / 10, data: canvas.toDataURL("image/jpeg", 0.72).split(",")[1] });
    onProgress?.(i + 1, times.length);
  }
  URL.revokeObjectURL(video.src);
  return { frames, duration, width: w, height: h };
}

// ---------------- API ----------------
async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Lỗi ${res.status}`);
  return json;
}

function setStatus(el, html, isError = false) {
  el.innerHTML = html;
  el.classList.toggle("error", isError);
}

const formData = (form) =>
  Object.fromEntries([...new FormData(form).entries()].filter(([, v]) => String(v).trim() !== ""));

function withTimer(statusEl, label) {
  const started = Date.now();
  const tick = () =>
    setStatus(statusEl, `<span class="spinner"></span>${label} (${Math.round((Date.now() - started) / 1000)}s) — thường mất 30-120 giây`);
  tick();
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
}

// ---------------- Analyze ----------------
let lastAnalysis = null;

$("#analyze-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const status = $("#analyze-status");
  const btn = form.querySelector("button[type=submit]");
  if (!files.analyze) return setStatus(status, "Hãy chọn video trước.", true);
  btn.disabled = true;
  let stop = () => {};
  try {
    const { frames, duration, width, height } = await extractFrames(files.analyze, (i, n) =>
      setStatus(status, `<span class="spinner"></span>Đang trích khung hình ${i}/${n}…`),
    );
    const refIds = $$("#ref-picker input:checked").map((i) => i.value);
    const references = loadLibrary()
      .filter((it) => refIds.includes(it.id))
      .map(({ name, niche, platform, stats, breakdown }) => ({ name, niche, platform, stats, breakdown }));
    stop = withTimer(status, "Claude đang phân tích video");
    const meta = { ...formData(form), fileName: files.analyze.name, duration, width, height };
    const result = await api("/api/analyze", { meta, frames, references });
    lastAnalysis = { meta, result };
    renderAnalysis(result, meta, frames);
    setStatus(status, "Xong! Bấm vào mốc thời gian để tua video tới đoạn đó.");
  } catch (err) {
    setStatus(status, esc(err.message), true);
  } finally {
    stop();
    btn.disabled = false;
  }
});

function seekPreview(kind, t) {
  const v = $(`#${kind}-preview`);
  if (!v.src) return;
  v.currentTime = t;
  v.scrollIntoView({ behavior: "smooth", block: "center" });
  v.play().catch(() => {});
}

const scoreColor = (n) => (n >= 75 ? "var(--good)" : n >= 50 ? "var(--mid)" : "var(--bad)");
const SCORE_LABELS = {
  viral_potential: "Tiềm năng viral",
  hook: "Hook",
  retention: "Giữ chân",
  pacing: "Nhịp dựng",
  visual: "Hình ảnh",
  storytelling: "Kể chuyện",
  engagement: "Tương tác",
};
const PRIORITY_LABELS = { high: "Ưu tiên cao", medium: "Trung bình", low: "Thấp" };
const RISK_LABELS = { high: "Dễ bị lướt", medium: "Cần cải thiện", low: "Ổn" };
const CATEGORY_LABELS = {
  hook: "Hook", pacing: "Nhịp", visual: "Hình ảnh", audio: "Âm thanh", text_overlay: "Text",
  story: "Câu chuyện", cta: "CTA", thumbnail: "Cover", caption: "Caption",
};
const STRENGTH_LABELS = { weak: "Yếu", medium: "Trung bình", strong: "Mạnh" };

const tsChip = (kind, t) =>
  t === null || t === undefined ? "" : `<button type="button" class="chip" data-seek="${kind}" data-t="${t}">⏱ ${fmtTime(t)}</button>`;

function renderAnalysis(r, meta, frames) {
  const root = $("#analyze-report");
  root.classList.remove("empty");
  const duration = meta.duration || 1;
  const order = { high: 0, medium: 1, low: 2 };
  const recs = [...r.recommendations].sort((a, b) => order[a.priority] - order[b.priority]);
  const thumb = frames.reduce((best, f) =>
    Math.abs(f.t - r.packaging.thumbnail_timestamp) < Math.abs(best.t - r.packaging.thumbnail_timestamp) ? f : best,
  );

  root.innerHTML = `
    <section>
      <div class="report-head">
        <div><h2>Báo cáo cải thiện</h2><p class="muted">${esc(meta.fileName)} · ${fmtTime(duration)} · ${esc(meta.platform)}</p></div>
        <div class="actions">
          <button class="ghost" data-act="json">Tải JSON</button>
          <button class="ghost" data-act="print">In / PDF</button>
        </div>
      </div>
      <p>${esc(r.summary)}</p>
      <div class="scores">
        ${Object.keys(SCORE_LABELS).map((k) => {
          const n = Math.round(r.scores[k]);
          return `<div class="score ${k === "viral_potential" ? "hero" : ""}">
            <div class="num" style="color:${scoreColor(n)}">${n}</div><div class="lbl">${SCORE_LABELS[k]}</div>
            <div class="bar"><i style="width:${n}%;background:${scoreColor(n)}"></i></div></div>`;
        }).join("")}
      </div>
    </section>

    <section>
      <h3>Hook 3 giây đầu — <span class="chip ${r.hook.strength === "strong" ? "p-low" : r.hook.strength === "medium" ? "p-medium" : "p-high"}">${STRENGTH_LABELS[r.hook.strength]}</span></h3>
      <p><b>Đang có:</b> ${esc(r.hook.what_happens)}</p>
      <p>${esc(r.hook.verdict)}</p>
      ${r.hook.issues.length ? `<ul class="tight">${r.hook.issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}
      <h4 style="margin-top:14px">Phương án hook mới</h4>
      <div class="hooks">
        ${r.hook.rewritten_hooks.map((h) => `<div class="hookopt"><b>${esc(h.style)}</b><p>“${esc(h.script)}”</p><p class="muted">🎬 ${esc(h.visual)}</p></div>`).join("")}
      </div>
    </section>

    <section>
      <h3>Timeline giữ chân người xem</h3>
      <div class="timeline">
        ${r.retention_timeline.map((s) => `<div class="risk-${s.risk}" data-seek="analyze" data-t="${s.start}"
            style="flex:${Math.max(0.3, s.end - s.start)}" title="${esc(s.label)} · ${RISK_LABELS[s.risk]}">${fmtTime(s.start)}</div>`).join("")}
      </div>
      ${r.retention_timeline.map((s) => `<div class="seg risk-${s.risk}">
          ${tsChip("analyze", s.start)}<b>${esc(s.label)}</b> <span class="muted">${fmtTime(s.start)}–${fmtTime(s.end)} · ${RISK_LABELS[s.risk]}</span>
          <div>${esc(s.observation)}</div><div>👉 ${esc(s.fix)}</div></div>`).join("")}
    </section>

    <section>
      <h3>Đề xuất chỉnh sửa</h3>
      <div class="recs">
        ${recs.map((x) => `<div class="rec">
            <span class="chip p-${x.priority}">${PRIORITY_LABELS[x.priority]}</span><span class="chip">${CATEGORY_LABELS[x.category] ?? x.category}</span>${tsChip("analyze", x.timestamp)}
            <p><b>Vấn đề:</b> ${esc(x.problem)}</p><p><b>Làm:</b> ${esc(x.action)}</p><p class="muted">Tác động: ${esc(x.expected_impact)}</p></div>`).join("")}
      </div>
    </section>

    <section>
      <h3>Tăng tương tác</h3>
      <ul class="tight">${r.engagement_tactics.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
    </section>

    <section>
      <h3>Đóng gói: tiêu đề, caption, cover</h3>
      ${r.packaging.titles.map((t) => copyRow(t)).join("")}
      <h4 style="margin-top:12px">Caption</h4>${copyRow(r.packaging.caption)}
      <h4 style="margin-top:12px">Hashtag</h4>${copyRow(r.packaging.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" "))}
      <h4 style="margin-top:12px">Cover gợi ý ${tsChip("analyze", r.packaging.thumbnail_timestamp)}</h4>
      <img src="data:image/jpeg;base64,${thumb.data}" alt="cover" style="max-width:220px;border-radius:10px;display:block;margin:6px 0" />
      <p class="muted">${esc(r.packaging.thumbnail_tip)}</p>
    </section>

    ${r.reference_comparison ? `<section><h3>So sánh với video viral tham chiếu</h3><p>${esc(r.reference_comparison)}</p></section>` : ""}

    <section>
      <h3>Checklist dựng lại</h3>
      <ol class="plan">${r.edit_plan.map((s) => `<li><label style="flex-direction:row;gap:8px;color:var(--text)"><input type="checkbox" /> ${esc(s)}</label></li>`).join("")}</ol>
    </section>`;
}

function copyRow(text) {
  return `<div class="copyable"><span>${esc(text)}</span><button type="button" class="ghost" data-copy="${esc(text)}">Copy</button></div>`;
}

document.addEventListener("click", (e) => {
  const seekEl = e.target.closest("[data-seek]");
  if (seekEl) return seekPreview(seekEl.dataset.seek, Number(seekEl.dataset.t));
  const copyEl = e.target.closest("[data-copy]");
  if (copyEl) {
    navigator.clipboard.writeText(copyEl.dataset.copy).then(() => {
      copyEl.textContent = "Đã copy";
      setTimeout(() => (copyEl.textContent = "Copy"), 1200);
    });
    return;
  }
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "print") window.print();
  if (act === "json" && lastAnalysis) download("virallens-report.json", lastAnalysis);
});

function download(name, data) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------- Research ----------------
$("#research-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const status = $("#research-status");
  const btn = form.querySelector("button[type=submit]");
  if (!files.research) return setStatus(status, "Hãy chọn video viral trước.", true);
  btn.disabled = true;
  let stop = () => {};
  try {
    const { frames, duration, width, height } = await extractFrames(files.research, (i, n) =>
      setStatus(status, `<span class="spinner"></span>Đang trích khung hình ${i}/${n}…`),
    );
    stop = withTimer(status, "Claude đang giải mã video viral");
    const meta = { ...formData(form), fileName: files.research.name, duration, width, height };
    const breakdown = await api("/api/research", { meta, frames });
    const item = {
      id: crypto.randomUUID(),
      name: meta.fileName,
      url: meta.url,
      niche: meta.niche,
      platform: meta.platform,
      stats: { views: meta.views, likes: meta.likes, comments: meta.comments, shares: meta.shares, duration: Math.round(duration) },
      thumb: frames[Math.min(2, frames.length - 1)].data,
      breakdown,
      savedAt: Date.now(),
    };
    saveLibrary([item, ...loadLibrary()]);
    renderBreakdown($("#research-report"), item, "research");
    setStatus(status, "Đã lưu vào Thư viện — có thể chọn làm tham chiếu khi phân tích video của bạn.");
  } catch (err) {
    setStatus(status, esc(err.message), true);
  } finally {
    stop();
    btn.disabled = false;
  }
});

function renderBreakdown(root, item, seekKind) {
  const b = item.breakdown;
  root.classList.remove("empty");
  root.innerHTML = `
    <section>
      <h2>${esc(item.name)}</h2>
      <p class="muted">${esc(item.platform ?? "")} ${item.niche ? "· " + esc(item.niche) : ""} ${statsLine(item.stats)}</p>
      <p>${esc(b.summary)}</p>
      <div class="tags">${b.pattern_tags.map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</div>
    </section>
    <section><h3>Vì sao viral</h3><ul class="tight">${b.why_viral.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>
    <section>
      <h3>Hook: ${esc(b.hook.type)} ${tsChip(seekKind, 0)}</h3>
      <p>${esc(b.hook.description)}</p><p class="muted">Kết thúc hook ở ~${b.hook.ends_at}s</p>
    </section>
    <section>
      <h3>Cấu trúc nhịp</h3>
      ${b.structure.map((s) => `<div class="seg risk-low">${tsChip(seekKind, s.start)}<b>${esc(s.beat)}</b> <span class="muted">${fmtTime(s.start)}–${fmtTime(s.end)}</span><div>${esc(s.purpose)}</div></div>`).join("")}
      <p class="muted">Nhịp: ~${b.pacing.avg_shot_seconds}s/cảnh. ${esc(b.pacing.notes)}</p>
    </section>
    <section>
      <h3>Kỹ thuật</h3>
      <div class="recs">${b.techniques.map((t) => `<div class="rec">${tsChip(seekKind, t.timestamp)}<b>${esc(t.name)}</b><p>${esc(t.how_used)}</p></div>`).join("")}</div>
    </section>
    <section>
      <h3>Cảm xúc &amp; động lực tương tác</h3>
      <div class="tags" style="margin-bottom:10px">${b.emotional_triggers.map((t) => `<span class="chip p-medium">${esc(t)}</span>`).join("")}</div>
      <ul class="tight">${b.engagement_drivers.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    </section>
    <section><h3>Công thức áp dụng lại</h3><ol class="plan">${b.replicable_template.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></section>`;
}

function statsLine(s = {}) {
  const parts = [
    s.views && `👁 ${esc(s.views)}`, s.likes && `❤ ${esc(s.likes)}`,
    s.comments && `💬 ${esc(s.comments)}`, s.shares && `↗ ${esc(s.shares)}`,
    s.duration && `⏱ ${fmtTime(s.duration)}`,
  ].filter(Boolean);
  return parts.length ? "· " + parts.join(" ") : "";
}

// ---------------- Library (localStorage) ----------------
function loadLibrary() {
  try {
    return JSON.parse(localStorage.getItem(LIB_KEY)) || [];
  } catch {
    return [];
  }
}

function saveLibrary(items) {
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(items));
  } catch {
    alert("Không lưu được thư viện (bộ nhớ trình duyệt đầy?).");
  }
  refreshLibraryUi();
}

function refreshLibraryUi() {
  const items = loadLibrary();
  $("#lib-count").textContent = items.length;
  const picker = $("#ref-picker");
  picker.innerHTML = `<legend>So sánh với video viral trong thư viện</legend>` +
    (items.length
      ? items.map((it) => `<label><input type="checkbox" value="${it.id}" /> ${esc(it.name)} <span class="muted">${esc(it.niche ?? "")}</span></label>`).join("")
      : `<p class="muted">Chưa có video nào. Hãy phân tích ở tab “Nghiên cứu viral”.</p>`);
}

function renderLibrary() {
  const items = loadLibrary();
  const list = $("#library-list");
  if (!items.length) {
    list.innerHTML = `<p class="muted">Thư viện trống. Mổ xẻ video viral ở tab “Nghiên cứu viral” để lưu công thức tại đây.</p>`;
    return;
  }
  list.innerHTML = items.map((it) => `
    <div class="libitem">
      <img src="data:image/jpeg;base64,${it.thumb}" alt="" />
      <div class="body">
        <b>${esc(it.name)}</b>
        <div class="stats">${esc(it.platform ?? "")} ${it.niche ? "· " + esc(it.niche) : ""} ${statsLine(it.stats)}</div>
        <div class="tags" style="margin-bottom:10px">${it.breakdown.pattern_tags.map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</div>
        <p class="muted" style="font-size:13px">${esc(it.breakdown.summary)}</p>
        <div class="actions">
          <button class="ghost" data-lib-open="${it.id}">Xem chi tiết</button>
          ${it.url ? `<a class="ghost" href="${esc(it.url)}" target="_blank" rel="noopener" style="text-decoration:none">Link gốc</a>` : ""}
          <button class="ghost" data-lib-del="${it.id}">Xoá</button>
        </div>
      </div>
    </div>`).join("");
}

$("#library-list").addEventListener("click", (e) => {
  const del = e.target.closest("[data-lib-del]")?.dataset.libDel;
  if (del && confirm("Xoá video này khỏi thư viện?")) {
    saveLibrary(loadLibrary().filter((it) => it.id !== del));
    renderLibrary();
  }
  const open = e.target.closest("[data-lib-open]")?.dataset.libOpen;
  if (open) {
    const item = loadLibrary().find((it) => it.id === open);
    $$(".tab").find((b) => b.dataset.tab === "research").click();
    renderBreakdown($("#research-report"), item, "research");
  }
});

refreshLibraryUi();

// ---------------- Trends ----------------
$("#trends-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const status = $("#trends-status");
  const out = $("#trends-report");
  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  const stop = withTimer(status, "Claude đang tìm kiếm & tổng hợp xu hướng");
  try {
    const { markdown } = await api("/api/trends", formData(form));
    out.innerHTML = renderMarkdown(markdown);
    out.hidden = false;
    setStatus(status, "");
  } catch (err) {
    setStatus(status, esc(err.message), true);
  } finally {
    stop();
    btn.disabled = false;
  }
});

// Minimal Markdown renderer (headings, lists, bold/italic, links, paragraphs).
function renderMarkdown(md) {
  const inline = (s) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<i>$2</i>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  const html = [];
  let list = null;
  const closeList = () => { if (list) { html.push(`</${list}>`); list = null; } };
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) {
      closeList();
      const level = Math.min(4, m[1].length + 1);
      html.push(`<h${level}>${inline(m[2])}</h${level}>`);
    } else if ((m = line.match(/^\s*[-*]\s+(.*)/)) || (m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      const type = /^\s*\d/.test(line) ? "ol" : "ul";
      if (list !== type) { closeList(); html.push(`<${type}>`); list = type; }
      html.push(`<li>${inline(m[1])}</li>`);
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList();
      html.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return html.join("\n");
}
