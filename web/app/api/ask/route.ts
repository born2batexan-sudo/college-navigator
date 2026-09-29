import { authorizedApiHousehold } from '@/lib/auth/session';
import { askCampus, assistantEnabled, HouseholdAccessError } from '@/lib/db/ask-campus';
import { AskRequestError, parseAskRequest } from '@/lib/ask-request';
export const runtime = 'nodejs';

const privateText = (message: string, status: number) => new Response(message, {
  status,
  headers: { 'Cache-Control': 'no-store' },
});

export async function POST(request: Request) {
  const ctx = await authorizedApiHousehold();
  if (!ctx) return new Response('Forbidden', { status:403, headers: { 'Cache-Control': 'no-store' } });
  if (!assistantEnabled()) return privateText('Ask Campus Passage unavailable', 503);
  try {
    const body = await parseAskRequest(request);
    const answer = await askCampus({ householdId: ctx.household.id, actorId: ctx.authUserId, studentId: body.studentId, question: body.question });
    return Response.json(answer, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof AskRequestError) return privateText(error.message, error.status);
    if (error instanceof HouseholdAccessError) return privateText('Question unavailable', 404);
    return privateText('Question unavailable', 400);
  }
}
