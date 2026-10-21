import { describe, expect, it, vi } from "vitest";
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

describe("Jev relay", () => {
  it("rejects missing keys before contacting TypeSafe", async () => {
    const response = await worker.fetch(
      new Request("http://local/v1/systemone", {
        method: "POST",
        headers: { Origin: "http://127.0.0.1:5173" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(401);
  });
  it("routes only to TypeSafe and keeps typing calls out of the generation budget", async () => {
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    try {
      for (let n = 0; n < 21; n++) {
        expect(
          (
            await worker.fetch(
              new Request("http://local/v1/systemone", {
                method: "POST",
                headers: {
                  Origin: "http://127.0.0.1:5173",
                  authorization: "Bearer fictional-key",
                  "CF-Connecting-IP": "eval-budget-test",
                },
                body: "{}",
              }),
            )
          ).status,
        ).toBe(200);
      }
      const result = await worker.fetch(
        new Request("http://local/v1/messages", {
          method: "POST",
          headers: {
            Origin: "http://127.0.0.1:5173",
            "x-api-key": "fictional-key",
            "CF-Connecting-IP": "eval-budget-test",
          },
          body: "{}",
        }),
      );
      expect(result.status).toBe(200);
      for (let n = 1; n <= 20; n++) {
        const generation = await worker.fetch(
          new Request("http://local/v1/messages", {
            method: "POST",
            headers: {
              Origin: "http://127.0.0.1:5173",
              "x-api-key": "fictional-key",
              "CF-Connecting-IP": "eval-budget-test",
            },
            body: "{}",
          }),
        );
        expect(generation.status).toBe(n === 20 ? 429 : 200);
      }

      expect(upstream.mock.calls[0][0]).toBe("https://api.typesafe.ai/v1/systemone");
      expect(upstream.mock.calls[0][1]?.headers).toEqual({
        "content-type": "application/json",
        authorization: "Bearer fictional-key",
      });
    } finally {
      upstream.mockRestore();
    }
  });
});
