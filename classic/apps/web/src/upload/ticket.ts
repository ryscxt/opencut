/**
 * Server copies of what is made in the editor, for a host that keeps them.
 *
 * A page that embeds the editor adds `upload_user`, `upload_exp` and
 * `upload_sig` to the address: a ticket its own server signed for one user
 * (see the repository README, "Keeping projects on the server"). With a
 * ticket, every imported file, every saved project and every export is also
 * sent to `/upload/<user>/<project id>/<name>`. Without one nothing is sent.
 *
 * This file is shared by the browser and the server, so it has no imports.
 */

export interface UploadTicket {
	/** The folder everything of this user goes into. */
	user: string;
	/** Unix time, in seconds, after which the server refuses the ticket. */
	expires: string;
	signature: string;
}

const FOLDER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const EXPIRES = /^[0-9]{1,12}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{1,64}$/;

/** Characters no file name may hold on the filesystems a volume can have (exFAT, NTFS). */
const UNSAFE_NAME_CHARS = new Set([
	'"',
	"*",
	"/",
	":",
	"<",
	">",
	"?",
	"\\",
	"|",
]);
const FIRST_PRINTABLE_CODE = 0x20;
const DELETE_CODE = 0x7f;
/** In UTF-8 bytes, below the 255 a file name may have. */
const MAX_NAME_BYTES = 200;
const MAX_EXTENSION_LENGTH = 12;

/** A user or project folder: one path segment that cannot leave its parent. */
export function isFolderName({ value }: { value: string }): boolean {
	return FOLDER_NAME.test(value);
}

export function isTicket({ ticket }: { ticket: UploadTicket }): boolean {
	return (
		isFolderName({ value: ticket.user }) &&
		EXPIRES.test(ticket.expires) &&
		SIGNATURE.test(ticket.signature)
	);
}

/**
 * Reads the ticket from `location.search`. Its values become parts of a URL,
 * so anything outside the characters the server accepts means no ticket.
 */
export function parseTicket({ query }: { query: string }): UploadTicket | null {
	const params = new URLSearchParams(query);
	const ticket: UploadTicket = {
		user: params.get("upload_user") ?? "",
		expires: params.get("upload_exp") ?? "",
		signature: params.get("upload_sig") ?? "",
	};
	return isTicket({ ticket }) ? ticket : null;
}

export function isExpired({
	ticket,
	nowMs,
}: {
	ticket: UploadTicket;
	nowMs: number;
}): boolean {
	return Number(ticket.expires) * 1000 <= nowMs;
}

function isUnsafeNameChar({ char }: { char: string }): boolean {
	const code = char.codePointAt(0) ?? 0;
	return (
		code < FIRST_PRINTABLE_CODE ||
		code === DELETE_CODE ||
		UNSAFE_NAME_CHARS.has(char)
	);
}

function byteLength({ text }: { text: string }): number {
	return new TextEncoder().encode(text).length;
}

/**
 * The name a file is kept under: the name it has, without the characters the
 * volume's filesystem could refuse, never one that points out of its folder,
 * and short enough for any filesystem (the extension survives the cut).
 */
export function safeFileName({ name }: { name: string }): string {
	const cleaned = [...name]
		.map((char) => (isUnsafeNameChar({ char }) ? "_" : char))
		.join("")
		.replace(/^[\s.]+/, "")
		.replace(/[\s.]+$/, "");
	if (!cleaned) return "file";
	if (byteLength({ text: cleaned }) <= MAX_NAME_BYTES) return cleaned;

	const dot = cleaned.lastIndexOf(".");
	const hasExtension = dot > 0 && cleaned.length - dot <= MAX_EXTENSION_LENGTH;
	const extension = hasExtension ? cleaned.slice(dot) : "";
	const stem = [...(hasExtension ? cleaned.slice(0, dot) : cleaned)];
	while (byteLength({ text: stem.join("") + extension }) > MAX_NAME_BYTES) {
		stem.pop();
	}
	return stem.join("") + extension;
}

/** Where one file goes, from the site root. */
export function uploadPath({
	ticket,
	projectId,
	name,
}: {
	ticket: UploadTicket;
	projectId: string;
	name: string;
}): string {
	const file = encodeURIComponent(safeFileName({ name }));
	return `/upload/${ticket.user}/${projectId}/${file}?exp=${ticket.expires}&sig=${ticket.signature}`;
}
