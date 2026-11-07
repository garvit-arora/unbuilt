import { describe, expect, it } from "vitest";
import { PAYPAL_BUTTON_PROPS, paypalScriptOptions } from "@/components/checkout/paypal-options";

describe("paypal-options (design 9.9)", () => {
  it("loads the SDK for capture with only the PayPal wallet (card, Pay Later, Venmo disabled)", () => {
    const options = paypalScriptOptions("client-id-from-server");
    expect(options).toMatchObject({
      clientId: "client-id-from-server",
      currency: "USD",
      intent: "capture",
      components: "buttons",
      "disable-funding": "card,paylater,venmo",
      environment: "sandbox",
    });
    expect(Object.keys(options)).not.toContain("clientSecret");
  });

  it("renders the PayPal funding source button only", () => {
    expect(PAYPAL_BUTTON_PROPS.fundingSource).toBe("paypal");
    expect(PAYPAL_BUTTON_PROPS.style).toEqual({ layout: "vertical", shape: "rect", label: "pay" });
  });
});
