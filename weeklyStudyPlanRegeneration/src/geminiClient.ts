const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 15_000;


export class GeminiRequestError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}
export interface GeminiGenerateOptions {
  systemInstruction: string;
  userContent: string;
  maxOutputTokens?: number;
  apiKeyIndex?: number;
}


export async function generateJsonContent(options: GeminiGenerateOptions): Promise<unknown> {
  const apiKeys = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
  ].filter((key, index, keys): key is string => Boolean(key?.trim()) && keys.indexOf(key) === index);

  const apiKeyIndex = options.apiKeyIndex ?? 0;
  const apiKey = apiKeys[apiKeyIndex];
  const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
  if (!apiKey) throw new GeminiRequestError(`Gemini API key ${apiKeyIndex + 1} is not configured.`);

  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;
  const body = {
    system_instruction: { parts: [{ text: options.systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: options.userContent }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: options.maxOutputTokens ?? 2048,
      temperature: 0.4,
    },
  };

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new GeminiRequestError(`Gemini request failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new GeminiRequestError(`Gemini API returned ${response.status}: ${text.slice(0, 300)}`, response.status);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: unknown }> };
    }>;
  };
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') {
    throw new GeminiRequestError('Gemini response had no text content.');
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new GeminiRequestError('Gemini response was not valid JSON.');
  }
}
