/**
 * Whether paid subscriptions can be bought from the UI (ADR 013 addendum).
 *
 * Off until the operator's identification (name, IČO, address) is published
 * on the site — Czech law requires it for paid services to consumers. The
 * backend enforces the same switch (`BILLING_CHECKOUT_ENABLED`), so flipping
 * only this constant is not enough to start selling.
 *
 * While off: the pricing page shows only the Free plan, the quota modal
 * explains the monthly reset instead of upselling, and Settings / the usage
 * card show no upgrade buttons. Existing (legacy) subscribers still see
 * "Manage subscription".
 */
export const CHECKOUT_ENABLED = false

export function isCheckoutEnabled(): boolean {
  return CHECKOUT_ENABLED
}
