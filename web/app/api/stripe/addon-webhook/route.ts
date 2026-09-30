import { addonStripeReady, reconcileAddonStripeWebhook } from '@/lib/db/stripe-college-addon';

export const runtime = 'nodejs';

/** Separate staging/test-only ingress for college add-on events. Base-payment webhook behavior is unchanged. */
export async function POST(request: Request) {
  if (!addonStripeReady()) return new Response('Disabled', { status: 503 });
  const raw = await request.text();
  try {
    const result = await reconcileAddonStripeWebhook(raw, request.headers.get('stripe-signature') ?? '');
    return Response.json({ received: true, result });
  } catch {
    // Signature/timestamp/parser failures are not acknowledged as valid webhook events.
    return new Response('Invalid webhook', { status: 400 });
  }
}
