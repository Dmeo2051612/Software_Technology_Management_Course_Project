import { AI_INTENT_SCHEMA } from './llm-intent-parser';
import { deepseekGenerate } from './llm-providers';

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});
const respond = (status: number, body: unknown) => {
  const fetchMock = jest.fn(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

describe('deepseekGenerate', () => {
  it('gửi chế độ JSON, tắt suy nghĩ, kèm mô tả các khoá', async () => {
    const fetchMock = respond(200, {
      choices: [{ message: { content: '{"side":"sell"}' } }],
    });
    const out = await deepseekGenerate('sk-test', 'deepseek-flash', 8000)(
      'HƯỚNG DẪN',
      'bán 3 tạ tiêu',
      AI_INTENT_SCHEMA,
    );
    expect(out).toBe('{"side":"sell"}');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer sk-test',
    );
    const body = JSON.parse(init.body as string) as {
      model: string;
      response_format: unknown;
      thinking: unknown;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe('deepseek-flash');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.messages[0].content).toContain('HƯỚNG DẪN');
    expect(body.messages[0].content).toContain('- quantityKg: ');
    expect(body.messages[1]).toEqual({
      role: 'user',
      content: 'bán 3 tạ tiêu',
    });
  });

  it('lỗi HTTP giữ mã trạng thái để bộ phân tích biết khi nào nghỉ', async () => {
    respond(429, { error: { message: 'Rate limit reached' } });
    await expect(
      deepseekGenerate('sk-test', 'deepseek-flash', 8000)(
        'x',
        'y',
        AI_INTENT_SCHEMA,
      ),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('nội dung rỗng là lỗi', async () => {
    respond(200, { choices: [{ message: { content: '' } }] });
    await expect(
      deepseekGenerate('sk-test', 'deepseek-flash', 8000)(
        'x',
        'y',
        AI_INTENT_SCHEMA,
      ),
    ).rejects.toThrow('DeepSeek trả về rỗng');
  });
});
