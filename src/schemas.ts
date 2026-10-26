import { z } from "zod";

// ---------- Request payloads (from the browser) ----------

export const FrameSchema = z.object({
  t: z.number(), // timestamp in seconds
  data: z.string(), // base64 JPEG, no data: prefix
});

export const VideoMetaSchema = z.object({
  fileName: z.string().optional(),
  duration: z.number(),
  width: z.number(),
  height: z.number(),
  platform: z.string().default("TikTok"),
  niche: z.string().optional(),
  goal: z.string().optional(),
  title: z.string().optional(),
  caption: z.string().optional(),
  transcript: z.string().optional(),
  url: z.string().optional(),
  stats: z.string().optional(), // performance so far, for videos already posted
});

export const AnalyzeRequestSchema = z.object({
  meta: VideoMetaSchema,
  frames: z.array(FrameSchema).min(1).max(60),
  references: z.array(z.unknown()).max(10).default([]),
});

export const ResearchRequestSchema = z.object({
  meta: VideoMetaSchema.extend({
    views: z.string().optional(),
    likes: z.string().optional(),
    comments: z.string().optional(),
    shares: z.string().optional(),
    url: z.string().optional(),
  }),
  frames: z.array(FrameSchema).min(1).max(60),
});

export const ImportRequestSchema = z.object({
  url: z.string().min(1),
});

export const TrendsRequestSchema = z.object({
  niche: z.string().min(1),
  platform: z.string().default("TikTok"),
  market: z.string().default("Việt Nam"),
});

// ---------- Structured outputs (from Claude) ----------

const Priority = z.enum(["high", "medium", "low"]);
const Risk = z.enum(["low", "medium", "high"]);

export const VideoAnalysisSchema = z.object({
  summary: z.string().describe("Nhận xét tổng quan 2-4 câu"),
  scores: z.object({
    hook: z.number().describe("0-100"),
    retention: z.number().describe("0-100"),
    pacing: z.number().describe("0-100"),
    visual: z.number().describe("0-100"),
    storytelling: z.number().describe("0-100"),
    engagement: z.number().describe("0-100, khả năng kéo like/comment/share/save"),
    viral_potential: z.number().describe("0-100"),
  }),
  hook: z.object({
    strength: z.enum(["weak", "medium", "strong"]),
    what_happens: z.string().describe("Điều người xem thấy/nghe trong 0-3 giây đầu"),
    verdict: z.string(),
    issues: z.array(z.string()),
    rewritten_hooks: z
      .array(
        z.object({
          style: z.string().describe("Kiểu hook, ví dụ: câu hỏi gây tò mò, kết quả trước, phản trực giác"),
          script: z.string().describe("Câu thoại / text on-screen cụ thể"),
          visual: z.string().describe("Cảnh quay / chuyển động gợi ý cho 3 giây đầu"),
        }),
      )
      .describe("3 phương án hook thay thế"),
  }),
  retention_timeline: z
    .array(
      z.object({
        start: z.number(),
        end: z.number(),
        label: z.string().describe("Tên đoạn ngắn gọn"),
        risk: Risk.describe("Nguy cơ người xem lướt đi trong đoạn này"),
        observation: z.string(),
        fix: z.string(),
      }),
    )
    .describe("Chia toàn bộ video thành các đoạn liên tiếp, phủ từ 0 tới hết thời lượng"),
  recommendations: z.array(
    z.object({
      priority: Priority,
      category: z.enum([
        "hook",
        "pacing",
        "visual",
        "audio",
        "text_overlay",
        "story",
        "cta",
        "thumbnail",
        "caption",
      ]),
      timestamp: z.number().nullable().describe("Giây cần sửa, null nếu áp dụng toàn video"),
      problem: z.string(),
      action: z.string().describe("Hành động chỉnh sửa cụ thể, làm được ngay"),
      expected_impact: z.string(),
    }),
  ),
  engagement_tactics: z
    .array(z.string())
    .describe("Chiến thuật kéo comment/share/save/xem lại (loop, câu hỏi cuối, pinned comment...)"),
  packaging: z.object({
    titles: z.array(z.string()).describe("3-5 tiêu đề / text cover"),
    caption: z.string(),
    hashtags: z.array(z.string()),
    thumbnail_timestamp: z.number().describe("Giây có khung hình đẹp nhất làm cover"),
    thumbnail_tip: z.string(),
  }),
  reference_comparison: z
    .string()
    .nullable()
    .describe("So sánh với các mẫu viral tham chiếu, null nếu không có tham chiếu"),
  edit_plan: z.array(z.string()).describe("Checklist dựng lại video theo thứ tự thực hiện"),
});

export const ViralBreakdownSchema = z.object({
  summary: z.string(),
  why_viral: z.array(z.string()).describe("Các lý do chính khiến video lan truyền"),
  hook: z.object({
    type: z.string(),
    description: z.string(),
    ends_at: z.number().describe("Giây hook kết thúc"),
  }),
  structure: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      beat: z.string().describe("Nhịp nội dung, ví dụ: hook, setup, twist, payoff, CTA"),
      purpose: z.string(),
    }),
  ),
  techniques: z.array(
    z.object({
      name: z.string(),
      how_used: z.string(),
      timestamp: z.number().nullable(),
    }),
  ),
  emotional_triggers: z.array(z.string()),
  engagement_drivers: z.array(z.string()),
  pacing: z.object({
    avg_shot_seconds: z.number().describe("Ước lượng độ dài trung bình mỗi cảnh"),
    notes: z.string(),
  }),
  replicable_template: z
    .array(z.string())
    .describe("Công thức từng bước để áp dụng cho video khác cùng ngách"),
  pattern_tags: z.array(z.string()).describe("Nhãn ngắn mô tả pattern, ví dụ: 'POV', 'before-after'"),
});

export type VideoMeta = z.infer<typeof VideoMetaSchema>;
export type Frame = z.infer<typeof FrameSchema>;
