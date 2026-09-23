import { requireHousehold } from '@/lib/auth/session';
import { askCampus } from '@/lib/db/ask-campus';
export const runtime='nodejs';
export async function POST(request:Request) {
 try {
  if(Number(request.headers.get('content-length') ?? 0)>2048) return new Response('Too large',{status:413});
  const ctx=await requireHousehold();
  const body=await request.json();
  if(typeof body?.studentId!=='string' || typeof body?.question!=='string') return new Response('Invalid question',{status:400});
  const answer=await askCampus({householdId:ctx.household.id,actorId:ctx.authUserId,studentId:body.studentId,question:body.question});
  return Response.json(answer,{headers:{'Cache-Control':'no-store'}});
 } catch {return new Response('Question unavailable',{status:400});}
}
