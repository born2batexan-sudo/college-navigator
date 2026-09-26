import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseAskRequest, AskRequestError } from '../lib/ask-request';
import { selectOfficialEvidence } from '../lib/ask-provider';
const payload = { studentId: 'student_1', question: 'What does housing require?' };
const request = (body: string, type = 'application/json') => new Request('https://example.com/api/ask', { method: 'POST', headers: { 'Content-Type': type }, body });
const evidence = [{ id: 'rule_1', title: 'Housing', quote: 'Housing opens in spring.', term: 'Fall 2027' }];
const envelope = (citationId: unknown) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ citationId }) }], usage: { input_tokens: 30, output_tokens: 5 } });
describe('assistant request and provider boundary', () => {
 it('validates exact JSON shape, type, length, missing or deceptive content-length', async () => {
  assert.deepEqual(await parseAskRequest(request(JSON.stringify(payload))), payload);
  for (const [req, status] of [
   [request('{}'),400], [request('{'),400], [request(JSON.stringify({ ...payload, extra: 1 })),400],
   [request(JSON.stringify({ ...payload, studentId: '../etc' })),400],
   [request(JSON.stringify({ ...payload, question: 'x'.repeat(501) })),400],
   [request(JSON.stringify(payload), 'text/plain'),415],
   [request(JSON.stringify({ ...payload, question: '😀'.repeat(700) })),413],
  ] as const) await assert.rejects(parseAskRequest(req), (e: unknown) => e instanceof AskRequestError && e.status === status);
 });
 it('constrains Anthropic call to a bounded JSON-schema evidence selector and validates ID', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-only';
  const fetcher: typeof fetch = async (url, init) => {
   assert.equal(url, 'https://api.anthropic.com/v1/messages');
   const body = JSON.parse(String(init?.body));
   assert.equal(body.max_tokens, 128); assert.equal(body.output_config.format.type, 'json_schema');
   assert.deepEqual(body.output_config.format.schema.properties.citationId.anyOf[0].enum, ['rule_1']);
   assert.equal(init?.signal instanceof AbortSignal, true);
   return Response.json(envelope('rule_1'));
  };
  assert.deepEqual(await selectOfficialEvidence({ question: 'Housing?', evidence }, fetcher), { citationId: 'rule_1', inputTokens: 30, outputTokens: 5 });
  for (const bad of ['unapproved', 42]) await assert.rejects(selectOfficialEvidence({ question: 'Housing?', evidence }, async () => Response.json(envelope(bad))));
  await assert.rejects(selectOfficialEvidence({ question: 'Housing?', evidence }, async () => Response.json({ ...envelope('rule_1'), stop_reason: 'max_tokens' })));
  await assert.rejects(selectOfficialEvidence({ question: 'Housing?', evidence }, async () => Response.json({ ...envelope('rule_1'), usage: { input_tokens: 999999, output_tokens: 5 } })));
  delete process.env.ANTHROPIC_API_KEY;
 });
});
