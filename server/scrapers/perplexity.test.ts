import { describe, it, expect } from "vitest";

describe("Perplexity API", () => {
  it("should have valid API key and connect successfully", async () => {
    const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
    
    expect(PERPLEXITY_API_KEY).toBeDefined();
    expect(PERPLEXITY_API_KEY).not.toBe("");
    expect(PERPLEXITY_API_KEY?.startsWith("pplx-")).toBe(true);

    // Test actual API connection
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          {
            role: "user",
            content: "Say OK",
          },
        ],
        max_tokens: 10,
      }),
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.log("API Error:", response.status, JSON.stringify(data));
    }
    
    expect(response.ok).toBe(true);
    expect(data.choices).toBeDefined();
    expect(data.choices.length).toBeGreaterThan(0);
  });
});
