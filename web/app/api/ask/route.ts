import { authorizedApiHousehold } from '@/lib/auth/session';
import { askCampus, assistantEnabled } from '@/lib/db/ask-campus';
import { AskRequestError, parseAskRequest } from '@/lib/ask-request';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const ctx = await authorizedApiHousehold();
  if (!ctx) return new Response('Forbidden', { status:403 });
  if (!assistantEnabled()) return new Response('Ask Campus Passage unavailable', { status: 503 });
  try {
    const body = await parseAskRequest(request);
    const answer = await askCampus({ householdId: ctx.household.id, actorId: ctx.authUserId, studentId: body.studentId, question: body.question });
    return Response.json(answer, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof AskRequestError) return new Response(error.message, { status: error.status });
    return new Response('Question unavailable', { status: 400 });
  }
}
