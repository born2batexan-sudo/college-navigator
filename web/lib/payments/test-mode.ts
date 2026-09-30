import { HOUSEHOLD_CYCLE_BASE_CENTS } from './contract';

/** This guard is deliberately stricter than the legacy review flag. Staging/test only:
 * live keys, production deployments, and an unreviewed price all fail closed.
 * The merchant's legal/tax setup and paid-college quota still require separate review.
 */
export function paymentTestModeConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return env.PAYMENTS_TEST_MODE_ENABLED === '1'
    && env.PAYMENTS_DEPLOYMENT_ENV === 'staging'
    && env.VERCEL_ENV !== 'production'
    && env.STRIPE_REVIEW_ENABLED === '1'
    && env.STRIPE_EXPECT_LIVEMODE === '0'
    && /^sk_test_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY ?? '')
    && /^whsec_[A-Za-z0-9_-]+$/.test(env.STRIPE_WEBHOOK_SECRET ?? '')
    && /^price_[A-Za-z0-9]+$/.test(env.STRIPE_PRICE_ID ?? '')
    && env.STRIPE_EXPECTED_AMOUNT_CENTS === String(HOUSEHOLD_CYCLE_BASE_CENTS)
    && validStagingOrigin(env.APP_ORIGIN);
}

function validStagingOrigin(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.origin === value && (url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)));
  } catch { return false; }
}
