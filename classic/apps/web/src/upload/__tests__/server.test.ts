import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	UploadTooLargeError,
	checkTicket,
	isUploadSecret,
	parseUploadPath,
	signTicket,
	storeUpload,
} from "../server";

const SECRET = "a-shared-secret-of-thirty-two-chars";
const NOW_MS = 1_800_000_000_000;
const LATER = String(NOW_MS / 1000 + 3600);

function bodyOf({ text }: { text: string }): ReadableStream<Uint8Array> {
	const body = new Response(text).body;
	if (!body) throw new Error("no body");
	return body;
}

describe("upload ticket check", () => {
	test("accepts the signature the embedding site makes", () => {
		const signature = signTicket({
			user: "u_admin",
			expires: LATER,
			secret: SECRET,
		});
		// Fixed by the scheme both sides share: MD5 of "<expires>:<user>:<secret>", base64url.
		expect(signature).toMatch(/^[A-Za-z0-9_-]{22}$/);
		expect(
			checkTicket({
				ticket: { user: "u_admin", expires: LATER, signature },
				secret: SECRET,
				nowMs: NOW_MS,
			}),
		).toBe("ok");
	});

	test("a ticket for one folder does not open another", () => {
		const signature = signTicket({
			user: "u_admin",
			expires: LATER,
			secret: SECRET,
		});
		expect(
			checkTicket({
				ticket: { user: "u_other", expires: LATER, signature },
				secret: SECRET,
				nowMs: NOW_MS,
			}),
		).toBe("forbidden");
	});

	test("a later expiry cannot be claimed with the old signature", () => {
		const signature = signTicket({
			user: "u_admin",
			expires: LATER,
			secret: SECRET,
		});
		expect(
			checkTicket({
				ticket: {
					user: "u_admin",
					expires: String(Number(LATER) + 1),
					signature,
				},
				secret: SECRET,
				nowMs: NOW_MS,
			}),
		).toBe("forbidden");
	});

	test("stops working at its expiry", () => {
		const expires = String(NOW_MS / 1000 - 1);
		const signature = signTicket({ user: "u_admin", expires, secret: SECRET });
		expect(
			checkTicket({
				ticket: { user: "u_admin", expires, signature },
				secret: SECRET,
				nowMs: NOW_MS,
			}),
		).toBe("expired");
	});

	test("a short or unusual secret keeps the feature off", () => {
		expect(isUploadSecret({ secret: SECRET })).toBe(true);
		expect(isUploadSecret({ secret: "" })).toBe(false);
		expect(isUploadSecret({ secret: "short" })).toBe(false);
		expect(isUploadSecret({ secret: `${SECRET} with spaces` })).toBe(false);
	});
});

describe("upload path", () => {
	test("names the user, the project and a safe file name", () => {
		expect(
			parseUploadPath({ pathname: "/upload/u_admin/p-1/a%20b%3F.mp4" }),
		).toEqual({ user: "u_admin", projectId: "p-1", name: "a b_.mp4" });
	});

	test("is refused when a folder is not a plain name", () => {
		for (const pathname of [
			"/upload/u_admin/p-1",
			"/upload/u_admin/p-1/a/b",
			"/upload/../p-1/a.mp4",
			"/upload/u_admin/..%2F..%2Fetc/a.mp4",
			"/upload/u_admin/.incoming/a.mp4",
			"/upload/.incoming/p-1/a.mp4",
			"/upload/u_admin/p-1/%E0%A4%A",
			"/elsewhere/u_admin/p-1/a.mp4",
		]) {
			expect(parseUploadPath({ pathname })).toBeNull();
		}
	});

	test("an encoded path in the file name stays inside the project folder", () => {
		const target = parseUploadPath({
			pathname: "/upload/u_admin/p-1/..%2F..%2Foutside.txt",
		});
		expect(target?.name).not.toContain("/");
		expect(target?.name.startsWith(".")).toBe(false);
	});
});

describe("storeUpload", () => {
	let root = "";
	const target = { user: "u_admin", projectId: "p-1", name: "clip.mp4" };

	beforeAll(async () => {
		root = await mkdtemp(path.join(tmpdir(), "opencut-upload-"));
	});
	afterAll(async () => {
		await rm(root, { recursive: true, force: true });
	});

	test("writes the file into the user's project folder; a newer upload replaces it", async () => {
		await storeUpload({ root, target, body: bodyOf({ text: "first" }) });
		const result = await storeUpload({
			root,
			target,
			body: bodyOf({ text: "second" }),
		});

		expect(result.bytes).toBe(6);
		expect(
			await readFile(path.join(root, "u_admin", "p-1", "clip.mp4"), "utf8"),
		).toBe("second");
	});

	test("an upload over the limit leaves nothing behind", async () => {
		const tooLarge = { ...target, name: "large.mp4" };
		await expect(
			storeUpload({
				root,
				target: tooLarge,
				body: bodyOf({ text: "0123456789" }),
				maxBytes: 4,
			}),
		).rejects.toBeInstanceOf(UploadTooLargeError);

		expect(await readdir(path.join(root, "u_admin", "p-1"))).not.toContain(
			"large.mp4",
		);
		expect(await readdir(path.join(root, ".incoming"))).toEqual([]);
	});
});
