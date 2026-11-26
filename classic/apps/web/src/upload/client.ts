/**
 * The browser side of the server copies (see `./ticket`): what the editor
 * saves in the browser is also sent to the host that embeds it.
 *
 * The browser stays the place the editor works from. The copies are one-way:
 * a failed one never stops a save, is told to the user once, and is sent again
 * the next time the project is opened. Nothing is ever deleted on the server.
 */

import { toast } from "sonner";
import type { MediaAsset } from "@/media/types";
import type { SerializedProject } from "@/services/storage/types";
import {
	isExpired,
	isTicket,
	parseTicket,
	uploadPath,
	type UploadTicket,
} from "./ticket";

const TICKET_STORAGE_KEY = "opencut-upload-ticket";
const KEPT_MEDIA_KEY = "opencut-kept-media";
const KEPT_PROJECT_KEY = "opencut-kept-project";
const PROJECT_FILE_NAME = "project.json";
/** Saves come in bursts while editing; one copy is sent once they pause. */
const PROJECT_DELAY_MS = 3000;

let ticket: UploadTicket | null | undefined;
let queue: Promise<unknown> = Promise.resolve();
let hasToldFailure = false;
let isWatchingPageHide = false;
const pendingProjects = new Map<
	string,
	{ project: SerializedProject; timer: ReturnType<typeof setTimeout> }
>();

function readStored({
	storage,
	key,
}: {
	storage: "session" | "local";
	key: string;
}): string | null {
	try {
		const store = storage === "session" ? sessionStorage : localStorage;
		return store.getItem(key);
	} catch {
		return null;
	}
}

function writeStored({
	storage,
	key,
	value,
}: {
	storage: "session" | "local";
	key: string;
	value: string;
}): void {
	try {
		const store = storage === "session" ? sessionStorage : localStorage;
		store.setItem(key, value);
	} catch {
		// Storage can be blocked in a frame; the copies still work for this page.
	}
}

/**
 * The ticket of this page: from the address it was opened with, else the one
 * remembered for this tab (the address loses it on the way to the editor).
 */
function getTicket(): UploadTicket | null {
	if (typeof window === "undefined") return null;
	if (ticket !== undefined) return ticket;

	ticket = parseTicket({ query: window.location.search });
	if (ticket) {
		writeStored({
			storage: "session",
			key: TICKET_STORAGE_KEY,
			value: JSON.stringify(ticket),
		});
		return ticket;
	}

	try {
		const stored = JSON.parse(
			readStored({ storage: "session", key: TICKET_STORAGE_KEY }) ?? "null",
		) as UploadTicket | null;
		ticket = stored && isTicket({ ticket: stored }) ? stored : null;
	} catch {
		ticket = null;
	}
	return ticket;
}

function tellFailure({ expired }: { expired: boolean }): void {
	if (hasToldFailure) return;
	hasToldFailure = true;
	toast.error(expired ? "Server copies have stopped" : "A server copy failed", {
		description: expired
			? "This session is too old to keep copies on the server. Reload the page to continue; your work stays in this browser."
			: "Your work is saved in this browser, but a copy did not reach the server. Files and projects are sent again when the project is opened.",
	});
}

async function send({
	projectId,
	name,
	body,
}: {
	projectId: string;
	name: string;
	body: Blob;
}): Promise<boolean> {
	const current = getTicket();
	if (!current) return false;
	if (isExpired({ ticket: current, nowMs: Date.now() })) {
		tellFailure({ expired: true });
		return false;
	}

	try {
		const response = await fetch(
			uploadPath({ ticket: current, projectId, name }),
			{ method: "PUT", body },
		);
		if (response.ok) return true;
		tellFailure({ expired: response.status === 410 });
	} catch {
		tellFailure({ expired: false });
	}
	return false;
}

/** A copy follows a save and must never break it, whatever the browser refuses. */
function quietly({ run }: { run: () => void }): void {
	try {
		run();
	} catch {
		tellFailure({ expired: false });
	}
}

/** One upload at a time, in the order they were asked for. */
function enqueue<T>({ task }: { task: () => Promise<T> }): Promise<T> {
	const next = queue.then(task, task);
	queue = next.catch(() => undefined);
	return next;
}

function keptMediaKey({ projectId }: { projectId: string }): string {
	return `${KEPT_MEDIA_KEY}:${getTicket()?.user}:${projectId}`;
}

function readKeptMedia({ projectId }: { projectId: string }): Set<string> {
	try {
		const stored = JSON.parse(
			readStored({ storage: "local", key: keptMediaKey({ projectId }) }) ??
				"[]",
		);
		return new Set(Array.isArray(stored) ? (stored as string[]) : []);
	} catch {
		return new Set();
	}
}

function markMediaKept({
	projectId,
	id,
}: {
	projectId: string;
	id: string;
}): void {
	const kept = readKeptMedia({ projectId });
	kept.add(id);
	writeStored({
		storage: "local",
		key: keptMediaKey({ projectId }),
		value: JSON.stringify([...kept]),
	});
}

/** Sends a copy of one imported file: `<media id>_<its name>` in the project's folder. */
export function keepMediaAsset({
	projectId,
	asset,
}: {
	projectId: string;
	asset: Pick<MediaAsset, "id" | "name" | "file">;
}): void {
	quietly({
		run: () => {
			if (!getTicket()) return;

			void enqueue({
				task: async () => {
					const isKept = await send({
						projectId,
						name: `${asset.id}_${asset.name}`,
						body: asset.file,
					});
					if (isKept) markMediaKept({ projectId, id: asset.id });
				},
			});
		},
	});
}

/** Sends the files of an opened project that the server does not have yet. */
export function keepMissingMediaAssets({
	projectId,
	assets,
}: {
	projectId: string;
	assets: Pick<MediaAsset, "id" | "name" | "file">[];
}): void {
	quietly({
		run: () => {
			if (!getTicket()) return;

			const kept = readKeptMedia({ projectId });
			for (const asset of assets) {
				if (!kept.has(asset.id)) keepMediaAsset({ projectId, asset });
			}
		},
	});
}

function keptProjectKey({ projectId }: { projectId: string }): string {
	return `${KEPT_PROJECT_KEY}:${getTicket()?.user}:${projectId}`;
}

function flushProject({ projectId }: { projectId: string }): void {
	const pending = pendingProjects.get(projectId);
	if (!pending) return;
	clearTimeout(pending.timer);
	pendingProjects.delete(projectId);

	const { project } = pending;
	void enqueue({
		task: async () => {
			const isKept = await send({
				projectId,
				name: PROJECT_FILE_NAME,
				body: new Blob([JSON.stringify(project)], {
					type: "application/json",
				}),
			});
			if (isKept) {
				writeStored({
					storage: "local",
					key: keptProjectKey({ projectId }),
					value: project.metadata.updatedAt,
				});
			}
		},
	});
}

function watchPageHide(): void {
	if (isWatchingPageHide) return;
	isWatchingPageHide = true;
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState !== "hidden") return;
		for (const projectId of [...pendingProjects.keys()]) {
			flushProject({ projectId });
		}
	});
}

/** Sends a copy of a saved project (`project.json` in its folder), once saving pauses. */
export function keepProject({ project }: { project: SerializedProject }): void {
	quietly({
		run: () => {
			if (!getTicket()) return;
			watchPageHide();

			const projectId = project.metadata.id;
			const pending = pendingProjects.get(projectId);
			if (pending) clearTimeout(pending.timer);
			pendingProjects.set(projectId, {
				project,
				timer: setTimeout(() => flushProject({ projectId }), PROJECT_DELAY_MS),
			});
		},
	});
}

/** For a project read from the browser: sends it when the server's copy is older or missing. */
export function keepProjectIfChanged({
	project,
}: {
	project: SerializedProject;
}): void {
	quietly({
		run: () => {
			if (!getTicket()) return;

			const projectId = project.metadata.id;
			const keptAt = readStored({
				storage: "local",
				key: keptProjectKey({ projectId }),
			});
			if (keptAt === project.metadata.updatedAt) return;
			if (pendingProjects.has(projectId)) return;
			keepProject({ project });
		},
	});
}

function exportStamp({ date }: { date: Date }): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return (
		`${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
		`-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
	);
}

/** Sends a copy of an exported video: `export_<date>-<time>_<file name>` in the project's folder. */
export function keepExport({
	projectId,
	buffer,
	filename,
	mimeType,
}: {
	projectId: string;
	buffer: ArrayBuffer;
	filename: string;
	mimeType: string;
}): void {
	quietly({
		run: () => {
			if (!getTicket()) return;

			const name = `export_${exportStamp({ date: new Date() })}_${filename}`;
			void enqueue({
				task: () =>
					send({
						projectId,
						name,
						body: new Blob([buffer], { type: mimeType }),
					}),
			});
		},
	});
}
