import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Download a video from a social link with yt-dlp, plus its metadata and subtitles.

const YTDLP = process.env.YTDLP_PATH ?? "yt-dlp";
const ROOT = path.join(os.tmpdir(), "virallens");
const KEEP_MS = 60 * 60 * 1000; // downloaded files are deleted after 1 hour
const MAX_DURATION_SEC = 30 * 60;

// Only well-known video platforms, so the server can't be pointed at arbitrary/internal URLs.
const ALLOWED_HOSTS = ["tiktok.com", "youtube.com", "youtu.be", "instagram.com", "facebook.com", "fb.watch"];

export class ImportError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export interface ImportResult {
  id: string;
  fileName: string;
  meta: {
    url: string;
    platform?: string;
    title?: string;
    caption?: string;
    uploader?: string;
    views?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    duration?: number;
    uploadDate?: string;
  };
  transcript?: string;
}

function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ImportError("Link không hợp lệ.");
  }
  const host = url.hostname.toLowerCase();
  const allowed = ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  if (!/^https?:$/.test(url.protocol) || !allowed) {
    throw new ImportError("Chỉ hỗ trợ link TikTok, YouTube, Instagram và Facebook.");
  }
  return url;
}

function run(args: string[]): Promise<{ stderr: string; failed: boolean }> {
  return new Promise((resolve, reject) => {
    execFile(YTDLP, args, { timeout: 5 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new ImportError("Server chưa cài yt-dlp (pip install yt-dlp).", 500));
        return;
      }
      resolve({ stderr: String(stderr), failed: Boolean(err) });
    });
  });
}

function platformName(extractor: string | undefined, url: URL, info: Record<string, any>): string | undefined {
  switch ((extractor ?? "").toLowerCase()) {
    case "tiktok":
      return "TikTok";
    case "instagram":
      return "Instagram Reels";
    case "facebook":
      return "Facebook Reels";
    case "youtube": {
      const vertical = info.height && info.width && info.height > info.width;
      return url.pathname.startsWith("/shorts/") || (vertical && info.duration <= 180)
        ? "YouTube Shorts"
        : "YouTube (dài)";
    }
  }
  return undefined;
}

/** Turn a WebVTT file into "m:ss text" lines, dropping the rolling duplicates of auto-captions. */
export function vttToTranscript(vtt: string): string {
  const out: string[] = [];
  const seen = new Set<string>();
  let start: number | null = null;
  for (const raw of vtt.split(/\r?\n/)) {
    const line = raw.trim();
    const timing = line.match(/^(?:(\d+):)?(\d{2}):(\d{2})\.\d{3}\s+-->/);
    if (timing) {
      start = Number(timing[1] ?? 0) * 3600 + Number(timing[2]) * 60 + Number(timing[3]);
      continue;
    }
    if (start === null || !line || /^(WEBVTT|NOTE|Kind:|Language:)/.test(line)) continue;
    const text = line.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const m = Math.floor(start / 60);
    const s = String(start % 60).padStart(2, "0");
    out.push(`${m}:${s} ${text}`);
  }
  return out.join("\n").slice(0, 12000);
}

function pickSubtitle(files: string[]): string | undefined {
  const vtts = files.filter((f) => f.endsWith(".vtt"));
  return vtts.find((f) => /\.vi[.-]/.test(f)) ?? vtts.find((f) => /\.en[.-]/.test(f)) ?? vtts[0];
}

export async function importFromUrl(raw: string): Promise<ImportResult> {
  const url = checkUrl(raw);
  const id = randomUUID();
  const dir = path.join(ROOT, id);
  await mkdir(dir, { recursive: true });
  setTimeout(() => rm(dir, { recursive: true, force: true }).catch(() => {}), KEEP_MS).unref();

  const { stderr } = await run([
    "--no-playlist",
    "--no-progress",
    "--max-filesize", "300M",
    "--match-filter", `duration <= ${MAX_DURATION_SEC}`,
    // Prefer H.264 MP4 so every browser can decode it for frame extraction.
    "-f", "bv*[height<=720][vcodec^=avc1]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/b",
    "--merge-output-format", "mp4",
    "--write-info-json",
    "--write-subs", "--write-auto-subs",
    "--sub-langs", "vi.*,vi,en.*,en",
    "--sub-format", "vtt",
    "-o", path.join(dir, "video.%(ext)s"),
    "--",
    url.href,
  ]);

  const files = await readdir(dir);
  const video = files.find((f) => /^video\.(mp4|webm|mkv|mov)$/.test(f));
  if (!video) {
    await rm(dir, { recursive: true, force: true });
    if (/does not pass filter/.test(stderr)) {
      throw new ImportError(`Video dài quá ${MAX_DURATION_SEC / 60} phút.`);
    }
    const reason = stderr.split("\n").filter((l) => l.startsWith("ERROR")).pop();
    throw new ImportError(
      `Không tải được video (video riêng tư, bị chặn, hoặc link sai).${reason ? ` Chi tiết: ${reason.replace(/^ERROR:\s*/, "")}` : ""}`,
      502,
    );
  }

  let info: Record<string, any> = {};
  try {
    info = JSON.parse(await readFile(path.join(dir, "video.info.json"), "utf8"));
  } catch {
    // metadata is optional
  }
  const sub = pickSubtitle(files);
  const transcript = sub ? vttToTranscript(await readFile(path.join(dir, sub), "utf8")) : undefined;

  const description: string | undefined = info.description || undefined;
  const title: string | undefined = info.title && info.title !== description ? info.title : undefined;
  return {
    id,
    fileName: `${(info.title || info.id || "video").toString().slice(0, 60)}.${video.split(".").pop()}`,
    meta: {
      url: url.href,
      platform: platformName(info.extractor_key, url, info),
      title,
      caption: description,
      uploader: info.uploader || info.channel || undefined,
      views: info.view_count ?? undefined,
      likes: info.like_count ?? undefined,
      comments: info.comment_count ?? undefined,
      shares: info.repost_count ?? undefined,
      duration: info.duration ?? undefined,
      uploadDate: info.upload_date ?? undefined,
    },
    transcript: transcript || undefined,
  };
}

/** Absolute path of a downloaded video, or null if the id is unknown/expired. */
export async function mediaPath(id: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const dir = path.join(ROOT, id);
  try {
    const video = (await readdir(dir)).find((f) => /^video\.(mp4|webm|mkv|mov)$/.test(f));
    return video ? path.join(dir, video) : null;
  } catch {
    return null;
  }
}
