import { describe, expect, test } from "bun:test";
import { parseTicket, safeFileName, uploadPath } from "../ticket";

describe("upload ticket", () => {
	test("is read from the page address next to other parameters", () => {
		const ticket = parseTicket({
			query:
				"?view=grid&upload_user=u_admin&upload_exp=1800000000&upload_sig=aB-_9",
		});

		expect(ticket).not.toBeNull();
		if (!ticket) return;
		expect(uploadPath({ ticket, projectId: "p-1", name: "a b.mp4" })).toBe(
			"/upload/u_admin/p-1/a%20b.mp4?exp=1800000000&sig=aB-_9",
		);
	});

	// The values become parts of the upload address, so one that could leave
	// the user's folder or change the request must mean no ticket at all.
	test("is refused when a value could leave the user's folder", () => {
		for (const query of [
			"",
			"?upload_user=u&upload_exp=1",
			"?upload_user=../x&upload_exp=1&upload_sig=s",
			"?upload_user=.hidden&upload_exp=1&upload_sig=s",
			"?upload_user=a%2Fb&upload_exp=1&upload_sig=s",
			"?upload_user=u&upload_exp=soon&upload_sig=s",
			"?upload_user=u&upload_exp=1&upload_sig=s/../t",
			"?upload_user=u&upload_exp=1&upload_sig=s%26x%3D1",
		]) {
			expect(parseTicket({ query })).toBeNull();
		}
	});
});

describe("safeFileName", () => {
	test("keeps an ordinary name as it is", () => {
		expect(safeFileName({ name: "Wakacje 2026 (final).mp4" })).toBe(
			"Wakacje 2026 (final).mp4",
		);
	});

	test("never yields a path, a hidden file or an empty name", () => {
		for (const name of [
			"..",
			".",
			"",
			"../../etc/passwd",
			"a/b\\c",
			".env",
			" . ",
		]) {
			const safe = safeFileName({ name });
			expect(safe).not.toContain("/");
			expect(safe).not.toContain("\\");
			expect(safe.startsWith(".")).toBe(false);
			expect(safe.length).toBeGreaterThan(0);
		}
	});

	test("replaces what exFAT and NTFS refuse", () => {
		const safe = safeFileName({ name: 'clip: "take 2" <b>?*|\u0007.mov' });
		expect(safe).not.toMatch(/[":<>?*|]/);
		expect(safe.endsWith(".mov")).toBe(true);
	});

	test("shortens a long name below the filesystem limit and keeps its extension", () => {
		const safe = safeFileName({ name: `${"ż".repeat(400)}.webm` });
		expect(new TextEncoder().encode(safe).length).toBeLessThan(255);
		expect(safe.endsWith(".webm")).toBe(true);
	});
});
