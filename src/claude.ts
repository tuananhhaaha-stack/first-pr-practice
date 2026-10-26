import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import type { Frame, VideoMeta } from "./schemas.js";

export const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";

// Server-side fallback: if the primary model declines, the API re-runs the
// request on a recommended fallback model instead of returning a refusal.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

const client = new Anthropic();

export class ClaudeError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, "0");
  return `${m}:${s}`;
}

export function describeMeta(meta: Record<string, unknown>): string {
  const lines = Object.entries(meta)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `- ${k}: ${typeof v === "number" ? Math.round(v * 100) / 100 : v}`);
  return lines.join("\n");
}

/** Interleave a timestamp label before every frame so Claude can cite exact moments. */
export function framesToContent(frames: Frame[]): Anthropic.Beta.BetaContentBlockParam[] {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const f of frames) {
    blocks.push({ type: "text", text: `Khung hình tại ${fmt(f.t)} (${f.t.toFixed(1)}s):` });
    blocks.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: f.data },
    });
  }
  return blocks;
}

function checkStop(stop: string | null | undefined) {
  if (stop === "refusal") {
    throw new ClaudeError("Claude từ chối phân tích nội dung này.", 422);
  }
  if (stop === "max_tokens") {
    throw new ClaudeError("Phản hồi bị cắt do quá dài, hãy thử lại với video ngắn hơn.", 502);
  }
}

export async function structuredCall<S extends z.ZodType>(opts: {
  system: string;
  content: Anthropic.Beta.BetaContentBlockParam[];
  schema: S;
}): Promise<z.infer<S>> {
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 20000,
    betas: [FALLBACK_BETA],
    fallbacks: "default",
    system: opts.system,
    output_config: { effort: "high", format: betaZodOutputFormat(opts.schema) },
    messages: [{ role: "user", content: opts.content }],
  });
  checkStop(response.stop_reason);
  if (!response.parsed_output) {
    throw new ClaudeError("Không đọc được kết quả phân tích từ Claude.");
  }
  return response.parsed_output;
}

export async function webResearch(system: string, prompt: string): Promise<string> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
  // Server tools can pause a long turn; resume by sending the paused turn back.
  for (let i = 0; i < 5; i++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      system,
      output_config: { effort: "medium" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
      messages,
    });
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    checkStop(response.stop_reason);
    return response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  }
  throw new ClaudeError("Tìm kiếm xu hướng mất quá nhiều bước, hãy thử lại.");
}

export function errorToResponse(err: unknown): { status: number; message: string } {
  if (err instanceof ClaudeError) return { status: err.status, message: err.message };
  if (err instanceof Anthropic.AuthenticationError) {
    return { status: 500, message: "Thiếu hoặc sai ANTHROPIC_API_KEY trên server." };
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { status: 429, message: "Đang bị giới hạn tốc độ, thử lại sau ít phút." };
  }
  if (err instanceof Anthropic.BadRequestError) {
    return { status: 400, message: `Yêu cầu không hợp lệ: ${err.message}` };
  }
  if (err instanceof Anthropic.APIError) {
    return { status: 502, message: `Lỗi Claude API (${err.status}): ${err.message}` };
  }
  console.error(err);
  return { status: 500, message: "Lỗi không xác định trên server." };
}

export type { VideoMeta };
