import { GoogleGenAI, ThinkingLevel } from "@google/genai";

// ── Multi-key pool with random selection ─────────────────────────────────────
const GEMINI_KEYS = [
  process.env.EXPO_PUBLIC_GEMINI_API_KEY,
  process.env.EXPO_PUBLIC_GEMINI_API_KEY_2,
  process.env.EXPO_PUBLIC_GEMINI_API_KEY_3,
].filter(Boolean);

const MODEL = "gemma-4-31b-it";

function getClient(attempt: number): GoogleGenAI {
  const startIdx = Math.floor(Math.random() * GEMINI_KEYS.length);
  const idx = (startIdx + attempt) % GEMINI_KEYS.length;
  console.log(`[key-pool] Using key ${idx + 1}/${GEMINI_KEYS.length} (attempt ${attempt})`);
  return new GoogleGenAI({ apiKey: GEMINI_KEYS[idx] });
}

export async function evaluateWithGemini(
  fileBase64: string,
  mimeType: string,
  systemPrompt: string,
  examContext: string,
  studentPrompt: string,
  maxRetries = 3
): Promise<string> {
  const config = {
    thinkingConfig: {
      thinkingLevel: ThinkingLevel.HIGH,
    },
    responseMimeType: "application/json" as const,
    temperature: 0,
    maxOutputTokens: 65536,
  };

  const contents = [
    {
      role: "user" as const,
      parts: [
        { text: `${systemPrompt}\n\n${examContext}` },
        { inlineData: { mimeType, data: fileBase64 } },
        { text: studentPrompt },
      ],
    },
  ];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const ai = getClient(attempt);
      let fullText = "";
      
      const response = await ai.models.generateContentStream({
        model: MODEL,
        config,
        contents,
      });

      for await (const chunk of response) {
        if (chunk.text) {
          fullText += chunk.text;
        }
      }

      console.log("[evaluate] raw (first 500):", fullText.slice(0, 500));

      if (!fullText.trim()) {
        throw new Error("Empty response from Gemma");
      }

      return fullText;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable = msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("500") || msg.includes("overloaded") || msg.includes("high demand") || msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("fetch") || msg.includes("network") || msg.includes("ECONNRESET") || msg.includes("timeout");

      if (isRetryable && attempt < maxRetries) {
        const delay = 5000 * (attempt + 1);
        console.warn(`[evaluate] Retryable error (attempt ${attempt + 1}/${maxRetries}), waiting ${delay / 1000}s:`, msg.slice(0, 100));
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }

  throw new Error("Gemma evaluation failed after retries");
}
