/**
 * PayPal JS SDK configuration (design 9.9). Only the PayPal wallet button is offered: card, Pay Later and Venmo are
 * disabled, matching the order's `payment_source.paypal` experience context and the Sandbox personal-account flow.
 * The client id is passed at runtime from the server (public by design); the secret never reaches the browser.
 */

export const DISABLED_FUNDING = "card,paylater,venmo";

export function paypalScriptOptions(clientId: string, currency = "USD", environment: "sandbox" | "production" = "sandbox") {
  return {
    clientId,
    currency,
    intent: "capture",
    components: "buttons",
    "disable-funding": DISABLED_FUNDING,
    environment,
  } as const;
}

export const PAYPAL_BUTTON_PROPS = {
  fundingSource: "paypal",
  style: { layout: "vertical", shape: "rect", label: "pay" },
} as const;
