import { describe, expect, it } from "vitest";
import { basicPassword, constantTimeEqual, ledgerAccess } from "@/lib/demo/auth";

const basic = (user: string, password: string) => `Basic ${btoa(`${user}:${password}`)}`;

describe("ledger access", () => {
  it("is open in the demo, where each visitor has a private sandbox", () => {
    expect(ledgerAccess(null, {})).toBe("open");
  });

  it("refuses to serve a shared ledger that has no password set", () => {
    expect(ledgerAccess(basic("me", "anything"), { RADAR_TOKEN: "t" })).toBe("unconfigured");
  });

  it("needs the password in shared mode, with any user name", () => {
    const env = { RADAR_TOKEN: "t", LEDGER_PASSWORD: "correct horse" };
    expect(ledgerAccess(null, env)).toBe("denied");
    expect(ledgerAccess(basic("me", "wrong"), env)).toBe("denied");
    expect(ledgerAccess("Bearer correct horse", env)).toBe("denied");
    expect(ledgerAccess(basic("anyone", "correct horse"), env)).toBe("granted");
  });

  it("reads a password that itself contains a colon", () => {
    expect(basicPassword(basic("me", "a:b"))).toBe("a:b");
    expect(basicPassword("Basic !!!")).toBeNull();
    expect(basicPassword(`Basic ${btoa("no-colon")}`)).toBeNull();
  });

  it("compares without stopping at the first difference", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });
});
