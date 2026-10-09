import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { GenerateJson } from './llm-intent-parser';

/** Gemini qua SDK chính thức @google/genai, trả JSON theo schema, suy nghĩ ở mức thấp. */
export function geminiGenerate(
  apiKey: string,
  model: string,
  timeoutMs: number,
): GenerateJson {
  // Không đặt httpOptions.timeout: SDK gửi nó thành hạn chót cho máy chủ, mà Google đòi tối thiểu 10 giây.
  // Ngắt phía mình bằng abortSignal bên dưới.
  const ai = new GoogleGenAI({ apiKey });
  return async (system, text, schema) => {
    const res = await ai.models.generateContent({
      model,
      contents: text,
      config: {
        systemInstruction: system,
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        maxOutputTokens: 2048,
        abortSignal: AbortSignal.timeout(timeoutMs),
      },
    });
    if (!res.text) throw new Error('Gemini trả về rỗng');
    return res.text;
  };
}

type DeepSeekResponse = {
  choices?: { message?: { content?: string | null } }[];
  error?: { message?: string };
};
type SchemaProps = Record<string, { description?: string; enum?: string[] }>;

/**
 * DeepSeek qua API kiểu OpenAI (https://api.deepseek.com/chat/completions), chế độ JSON, tắt suy nghĩ.
 * Chế độ JSON không ép theo schema, nên gửi kèm mô tả từng khoá; giá trị sai đã có bước kiểm tra phía sau.
 */
export function deepseekGenerate(
  apiKey: string,
  model: string,
  timeoutMs: number,
): GenerateJson {
  return async (system, text, schema) => {
    const props = (schema as { properties: SchemaProps }).properties;
    const keys = Object.entries(props)
      .map(
        ([k, p]) =>
          `- ${k}: ${p.description ?? `một trong ${JSON.stringify(p.enum)}`}`,
      )
      .join('\n');
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `${system}\n\nCác khoá của đối tượng json:\n${keys}`,
          },
          { role: 'user', content: text },
        ],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        temperature: 0,
        max_tokens: 1024,
        stream: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = (await res.json().catch(() => ({}))) as DeepSeekResponse;
    if (!res.ok)
      throw Object.assign(
        new Error(`DeepSeek HTTP ${res.status}: ${body.error?.message ?? ''}`),
        { status: res.status },
      );
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error('DeepSeek trả về rỗng');
    return content;
  };
}
