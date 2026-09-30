export const runtime = 'nodejs';
/** No add-on events accepted in the no-payment release. */
export async function POST(_request: Request) { return new Response('Disabled', {status:503}); }
