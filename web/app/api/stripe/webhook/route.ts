import { reconcileStripeWebhook, stripeReady } from '@/lib/db/stripe-review';
export const runtime = 'nodejs';
export async function POST(request: Request) {
 if (!stripeReady()) return new Response('Disabled', {status:503});
 const raw = await request.text();
 try {
  const result = await reconcileStripeWebhook(raw,request.headers.get('stripe-signature') ?? '');
  return Response.json({received:true,result});
 } catch { return new Response('Invalid webhook', {status:400}); }
}
