/**
 * The server side of `/upload/<user>/<project id>/<name>`: checks the ticket
 * and writes the file under the storage folder. Files can be written, never
 * read back, listed or deleted over HTTP.
 */

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import {
	isExpired,
	isFolderName,
	isTicket,
	safeFileName,
	type UploadTicket,
} from "./ticket";

export const DEFAULT_UPLOAD_DIR = "/mnt/sdc1/Rinku/OpenCut";

/** One file. Larger than any phone clip; small enough that a mistake can't fill the volume alone. */
export const MAX_UPLOAD_BYTES = 16 * 1024 ** 3;

const MIN_SECRET_LENGTH = 32;
const SECRET = /^[A-Za-z0-9_-]+$/;
const INCOMING_DIR = ".incoming";

/** The secret turns the feature on; one that is too weak to sign with counts as none. */
export function isUploadSecret({ secret }: { secret: string }): boolean {
	return secret.length >= MIN_SECRET_LENGTH && SECRET.test(secret);
}

/** What the embedding site signs: MD5 of "<expires>:<user>:<secret>", base64url without padding. */
export function signTicket({
	user,
	expires,
	secret,
}: {
	user: string;
	expires: string;
	secret: string;
}): string {
	return createHash("md5")
		.update(`${expires}:${user}:${secret}`)
		.digest("base64url");
}

export type TicketCheck = "ok" | "forbidden" | "expired";

export function checkTicket({
	ticket,
	secret,
	nowMs,
}: {
	ticket: UploadTicket;
	secret: string;
	nowMs: number;
}): TicketCheck {
	if (!isTicket({ ticket })) return "forbidden";

	const expected = Buffer.from(
		signTicket({ user: ticket.user, expires: ticket.expires, secret }),
	);
	const given = Buffer.from(ticket.signature);
	if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
		return "forbidden";
	}

	return isExpired({ ticket, nowMs }) ? "expired" : "ok";
}

export interface UploadTarget {
	user: string;
	projectId: string;
	name: string;
}

/**
 * Reads `/upload/<user>/<project id>/<name>` from a request path. The folders
 * must be plain names; the file name is made safe instead of refused, so a
 * file with an unusual name is still kept.
 */
export function parseUploadPath({
	pathname,
}: {
	pathname: string;
}): UploadTarget | null {
	const segments = pathname.split("/");
	if (segments.length !== 5 || segments[0] !== "" || segments[1] !== "upload") {
		return null;
	}

	const [user, projectId, encodedName] = segments.slice(2);
	if (!isFolderName({ value: user }) || !isFolderName({ value: projectId })) {
		return null;
	}

	let name: string;
	try {
		name = decodeURIComponent(encodedName);
	} catch {
		return null;
	}
	if (!name) return null;

	return { user, projectId, name: safeFileName({ name }) };
}

export class UploadTooLargeError extends Error {
	constructor() {
		super("The upload is larger than the server keeps");
	}
}

/**
 * Writes the body to `<root>/<user>/<project id>/<name>`. It is first written
 * next to it on the same volume and then renamed, so a file that is there is
 * always whole, and a newer upload of the same name replaces the older one.
 */
export async function storeUpload({
	root,
	target,
	body,
	maxBytes = MAX_UPLOAD_BYTES,
}: {
	root: string;
	target: UploadTarget;
	body: ReadableStream<Uint8Array>;
	maxBytes?: number;
}): Promise<{ bytes: number }> {
	const incomingDir = path.join(root, INCOMING_DIR);
	const targetDir = path.join(root, target.user, target.projectId);
	const incomingFile = path.join(incomingDir, randomUUID());

	await mkdir(incomingDir, { recursive: true });
	await mkdir(targetDir, { recursive: true });

	let bytes = 0;
	const limit = new Transform({
		transform(chunk: Buffer, _encoding, done) {
			bytes += chunk.length;
			done(bytes > maxBytes ? new UploadTooLargeError() : null, chunk);
		},
	});

	try {
		await pipeline(
			Readable.fromWeb(body as unknown as NodeReadableStream<Uint8Array>),
			limit,
			createWriteStream(incomingFile),
		);
		await rename(incomingFile, path.join(targetDir, target.name));
	} catch (error) {
		await rm(incomingFile, { force: true });
		throw error;
	}

	return { bytes };
}
