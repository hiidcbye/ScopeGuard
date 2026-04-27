require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.')); // serves index.html

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/analyze', async (req, res) => {
  const { scope, request, rate } = req.body;

  if (!scope || !request || !rate) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const systemPrompt = `You are an expert project manager and financial advocate for freelancers.

You will receive: an Original Scope, a New Client Request, and an Hourly Rate.

Your job:
1. Determine if the new request is "In Scope", "Out of Scope", or "Partially Out of Scope"
2. Estimate extra hours required for out-of-scope work (0 if fully in scope)
3. Calculate revenueRisk = estimatedHours × hourlyRate
4. Extract 2-3 bullet points of evidence showing what in the request is NOT in the original scope
5. Draft a polite professional email to the client offering to complete the extra work for the calculated fee

Return ONLY valid JSON, no markdown, no explanation:
{
  "verdict": "In Scope" | "Out of Scope" | "Partially Out of Scope",
  "estimatedHours": number,
  "revenueRisk": number,
  "evidence": ["string", "string"],
  "emailDraft": "full email as a string"
}`;

  // Retry helper: handles 429 rate-limit errors with exponential backoff
  async function retryWithBackoff(fn, retries = 3, delayMs = 2000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const isRateLimit = err?.message?.includes('429') || err?.status === 429;
        if (isRateLimit && attempt < retries) {
          console.warn(`Rate limited. Retrying in ${delayMs}ms... (attempt ${attempt}/${retries})`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          delayMs *= 2; // exponential backoff
        } else {
          throw err;
        }
      }
    }
  }

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash'
    });

    const prompt = `${systemPrompt}

Original Scope:
${scope}

Client's New Request:
${request}

Hourly Rate: ${rate}`;

    const result = await retryWithBackoff(() => model.generateContent(prompt));
    const text = result.response.text();
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    res.json(parsed);

  } catch (err) {
    console.error(err);
    const isRateLimit = err?.message?.includes('429') || err?.status === 429;
    res.status(isRateLimit ? 429 : 500).json({
      error: isRateLimit
        ? 'API rate limit exceeded. Please wait a moment and try again.'
        : err.message
    });
  }
});

app.listen(3000, () => console.log('ScopeGuard running at http://localhost:3000'));