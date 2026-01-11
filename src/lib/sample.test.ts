import { describe, expect, it } from "vitest";

// サンプルテスト
describe("Sample Test", () => {
	it("should pass a simple test", () => {
		expect(1 + 1).toBe(2);
	});

	it("should work with async functions", async () => {
		const result = await Promise.resolve(42);
		expect(result).toBe(42);
	});
});
