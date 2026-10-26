import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  MODEL,
  describeMeta,
  errorToResponse,
  framesToContent,
  structuredCall,
  webResearch,
} from "./claude.js";
import { ANALYZE_SYSTEM, RESEARCH_SYSTEM, TRENDS_SYSTEM } from "./prompts.js";
import {
  AnalyzeRequestSchema,
  ResearchRequestSchema,
  TrendsRequestSchema,
  VideoAnalysisSchema,
  ViralBreakdownSchema,
} from "./schemas.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "40mb" }));
app.use(express.static(path.join(here, "..", "public")));

type Handler = (body: unknown) => Promise<unknown>;

function route(handler: Handler): express.RequestHandler {
  return async (req, res) => {
    try {
      res.json(await handler(req.body));
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: "Dữ liệu gửi lên không hợp lệ", details: err.issues });
        return;
      }
      const { status, message } = errorToResponse(err);
      res.status(status).json({ error: message });
    }
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, model: MODEL, hasKey: Boolean(process.env.ANTHROPIC_API_KEY) });
});

// Analyze the user's own video and return an improvement report.
app.post(
  "/api/analyze",
  route(async (body) => {
    const { meta, frames, references } = AnalyzeRequestSchema.parse(body);
    const refText = references.length
      ? `\n\nCác video viral tham chiếu cùng ngách (đã được phân tích trước, dùng để so sánh và mượn công thức):\n${JSON.stringify(references, null, 1)}`
      : "\n\nKhông có video tham chiếu; đặt reference_comparison = null.";
    return structuredCall({
      system: ANALYZE_SYSTEM,
      schema: VideoAnalysisSchema,
      content: [
        { type: "text", text: `Thông tin video cần cải thiện:\n${describeMeta(meta)}${refText}` },
        ...framesToContent(frames),
        {
          type: "text",
          text: "Hãy phân tích video trên và đưa ra đề xuất cải thiện để tăng giữ chân người xem và tương tác.",
        },
      ],
    });
  }),
);

// Break down a viral video into a reusable formula.
app.post(
  "/api/research",
  route(async (body) => {
    const { meta, frames } = ResearchRequestSchema.parse(body);
    return structuredCall({
      system: RESEARCH_SYSTEM,
      schema: ViralBreakdownSchema,
      content: [
        { type: "text", text: `Thông tin video viral:\n${describeMeta(meta)}` },
        ...framesToContent(frames),
        { type: "text", text: "Hãy mổ xẻ vì sao video này viral và rút ra công thức áp dụng lại." },
      ],
    });
  }),
);

// Research current trends for a niche with web search.
app.post(
  "/api/trends",
  route(async (body) => {
    const { niche, platform, market } = TrendsRequestSchema.parse(body);
    const markdown = await webResearch(
      TRENDS_SYSTEM,
      `Ngách: ${niche}\nNền tảng: ${platform}\nThị trường: ${market}\nHãy nghiên cứu xu hướng nội dung viral hiện tại.`,
    );
    return { markdown };
  }),
);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`ViralLens chạy tại http://localhost:${port} (model: ${MODEL})`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("Chưa đặt ANTHROPIC_API_KEY — các API phân tích sẽ lỗi.");
  }
});
