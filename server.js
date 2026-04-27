require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public")); // serves public/index.html

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL_CANDIDATES = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
];

app.post("/analyze", async (req, res) => {
  const { scope, request, rate } = req.body;

  if (!scope || !request || !rate) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  const systemPrompt = `
You are an expert project manager and financial advocate for freelancers.

You MUST:
- Read the Original Scope and New Client Request carefully.
- Use ONLY the information given. Do NOT make up facts or numbers.
- Return strictly valid JSON. No markdown, no backticks, no comments.

Steps:
1. Decide verdict: "In Scope", "Out of Scope", or "Partially Out of Scope".
2. Estimate extra hours required for the out-of-scope work (0 if fully in scope).
3. Calculate revenueRisk = estimatedHours * hourlyRate.
4. Extract 2-3 short bullet points showing what in the request is NOT in the original scope.
5. Draft a concise, polite professional email to the client offering to complete the extra work for the calculated fee.

Return ONLY valid minified JSON exactly in this shape:

{
  "verdict": "In Scope",
  "estimatedHours": 0,
  "revenueRisk": 0,
  "evidence": ["string 1", "string 2"],
  "emailDraft": "string"
}

If you do not have enough information to answer correctly, set estimatedHours to 0 and clearly state the uncertainty in emailDraft.
`;

  // Retry helper: handles 429 rate-limit errors with exponential backoff
  async function retryWithBackoff(fn, retries = 3, delayMs = 2000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const isRateLimit =
          err?.message?.includes("429") || err?.status === 429;
        if (isRateLimit && attempt < retries) {
          console.warn(
            `Rate limited. Retrying in ${delayMs}ms... (attempt ${attempt}/${retries})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          delayMs *= 2; // exponential backoff
        } else {
          throw err;
        }
      }
    }
  }

  async function generateWithFallback(prompt) {
    let lastError;

    for (const modelName of MODEL_CANDIDATES) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        return await retryWithBackoff(() => model.generateContent(prompt));
      } catch (err) {
        lastError = err;
        const isModelMissing =
          err?.status === 404 ||
          String(err?.message || "").includes("not found") ||
          String(err?.message || "").includes("is not supported");

        if (!isModelMissing) {
          throw err;
        }

        console.warn(
          `Model ${modelName} is unavailable, trying the next candidate.`,
        );
      }
    }

    throw lastError;
  }

  // Extract first {...} block from text
  function extractJson(text) {
    const m = String(text).match(/\{[\s\S]*\}/);
    return m ? m[0] : String(text);
  }

  // Simple heuristic repairs for common LLM JSON issues
  function repairJson(s) {
    let out = String(s);
    out = out.replace(/```json|```/g, "");
    out = out.replace(/[‘’“”`]/g, '"');
    out = out.replace(/,\s*([}\]])/g, "$1");
    out = out.replace(/([\{,\s])([A-Za-z0-9_\-]+)\s*:/g, '$1"$2":');
    return out.trim();
  }

  // Basic schema validation
  function validateResult(obj) {
    if (typeof obj !== "object" || obj === null)
      throw new Error("Response is not an object");
    if (typeof obj.verdict !== "string") throw new Error("Invalid verdict");
    if (typeof obj.estimatedHours !== "number")
      throw new Error("Invalid estimatedHours");
    if (typeof obj.revenueRisk !== "number")
      throw new Error("Invalid revenueRisk");
    if (!Array.isArray(obj.evidence)) throw new Error("Invalid evidence");
    if (typeof obj.emailDraft !== "string")
      throw new Error("Invalid emailDraft");
    return obj;
  }

  // Schema validation for the analysis-only response (no emailDraft)
  function validateAnalysis(obj) {
    if (typeof obj !== "object" || obj === null)
      throw new Error("Analysis is not an object");
    if (typeof obj.verdict !== "string") throw new Error("Invalid verdict");
    if (typeof obj.estimatedHours !== "number")
      throw new Error("Invalid estimatedHours");
    if (typeof obj.revenueRisk !== "number")
      throw new Error("Invalid revenueRisk");
    if (!Array.isArray(obj.evidence)) throw new Error("Invalid evidence");
    return obj;
  }

  try {
    const prompt = `${systemPrompt}

Original Scope:
${scope}

Client's New Request:
${request}

Hourly Rate: ${rate}`;

    // --- Two-step pattern: analyzer -> writer ---
    // 1) Analyzer: ask model to return compact JSON (no emailDraft)
    const analysisPrompt = `${systemPrompt}

Perform ONLY the analysis. DO NOT produce an email. Return ONLY minified JSON in this shape:
{"verdict":"In Scope","estimatedHours":0,"revenueRisk":0,"evidence":["string1","string2"]}

Original Scope:
${scope}

Client's New Request:
${request}

Hourly Rate: ${rate}`;

    // parse and validate analysis
    let analysis;
    let parseErr;
    const maxAnalysisAttempts = 2;
    for (let attempt = 0; attempt <= maxAnalysisAttempts; attempt++) {
      try {
        const result = await generateWithFallback(analysisPrompt);
        let raw = result.response.text();
        if (typeof raw !== "string") raw = String(raw);

        let extracted = extractJson(raw)
          .replace(/```json|```/g, "")
          .trim();

        try {
          analysis = JSON.parse(extracted);
        } catch (e) {
          const repaired = repairJson(extracted);
          analysis = JSON.parse(repaired);
        }

        validateAnalysis(analysis);
        break;
      } catch (e) {
        parseErr = e;
        console.warn("Analysis parse attempt failed:", e.message || e);
        if (attempt === maxAnalysisAttempts)
          throw new Error(
            "Failed to parse/validate analysis: " + String(e.message || e),
          );
      }
    }

    // 2) Writer: generate email using only computed numbers and evidence
    const emailPrompt = `You are a concise professional project manager. Using ONLY the analysis below (do not change numbers) and the original scope and request, draft a concise polite email to the client offering to complete the extra work for the calculated fee. State the hours, hourly rate, and total. Return ONLY the plain email text, no JSON, no markdown, no commentary.

ANALYSIS_JSON:
${JSON.stringify(analysis)}

Original Scope:
${scope}

Client Request:
${request}`;

    let emailDraft = "";
    try {
      const writerResult = await generateWithFallback(emailPrompt);
      emailDraft =
        writerResult.response.text() || String(writerResult.response);
      emailDraft = emailDraft.replace(/```/g, "").trim();
    } catch (e) {
      console.warn("Email generation failed:", e.message || e);
      emailDraft = "(Failed to generate email: " + String(e.message || e) + ")";
    }

    // attach emailDraft and respond
    analysis.emailDraft = emailDraft;
    return res.json(analysis);
  } catch (err) {
    console.error(err);
    const isRateLimit = err?.message?.includes("429") || err?.status === 429;
    res.status(isRateLimit ? 429 : 500).json({
      error: isRateLimit
        ? "API rate limit exceeded. Please wait a moment and try again."
        : err.message,
    });
  }
});

app.listen(3000, () =>
  console.log("ScopeGuard running at http://localhost:3000"),
);
