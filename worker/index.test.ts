import { describe, expect, it } from "vitest";
import worker, { isAllowedOrigin } from "./index";

describe("AI proxy origin policy", () => {
  it("accepts arbitrary localhost ports used by Vite and Conductor", () => {
    expect(isAllowedOrigin("http://localhost:5175")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:61342")).toBe(true);
  });

  it("does not accept lookalike or insecure origins", () => {
    expect(isAllowedOrigin("https://localhost:5175")).toBe(false);
    expect(isAllowedOrigin("http://localhost.example.com:5175")).toBe(false);
    expect(isAllowedOrigin("null")).toBe(false);
    expect(isAllowedOrigin(null)).toBe(false);
  });

  it("returns CORS headers for a local preflight", async () => {
    const response = await worker.fetch(
      new Request("https://proxy.example/v1/messages", {
        method: "OPTIONS",
        headers: { Origin: "http://localhost:5175" },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5175");
  });
});
