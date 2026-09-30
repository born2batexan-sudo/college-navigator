export const runtime = 'nodejs';
/** Kept as a hard-disabled ingress. Payment code remains in lib/db/stripe-review. */
export async function POST(_request: Request) { return new Response('Disabled', {status:503}); }
