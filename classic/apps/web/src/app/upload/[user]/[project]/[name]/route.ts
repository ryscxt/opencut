import { webEnv } from "@/env/web";
import {
	DEFAULT_UPLOAD_DIR,
	MAX_UPLOAD_BYTES,
	UploadTooLargeError,
	checkTicket,
	isUploadSecret,
	parseUploadPath,
	storeUpload,
} from "@/upload/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function answer({ status }: { status: number }): Response {
	return new Response(null, { status, headers: NO_STORE });
}

/**
 * Keeps one file of the editor on the server (see `@/upload/ticket`). Without
 * `OPENCUT_UPLOAD_SECRET` the address answers 404 and nothing is ever written.
 */
export async function PUT(request: Request): Promise<Response> {
	const secret = webEnv.OPENCUT_UPLOAD_SECRET ?? "";
	if (!isUploadSecret({ secret })) return answer({ status: 404 });

	const url = new URL(request.url);
	const target = parseUploadPath({ pathname: url.pathname });
	if (!target) return answer({ status: 404 });

	const check = checkTicket({
		ticket: {
			user: target.user,
			expires: url.searchParams.get("exp") ?? "",
			signature: url.searchParams.get("sig") ?? "",
		},
		secret,
		nowMs: Date.now(),
	});
	if (check === "forbidden") return answer({ status: 403 });
	if (check === "expired") return answer({ status: 410 });

	const declared = Number(request.headers.get("content-length") ?? 0);
	if (declared > MAX_UPLOAD_BYTES) return answer({ status: 413 });
	if (!request.body) return answer({ status: 400 });

	try {
		await storeUpload({
			root: webEnv.OPENCUT_UPLOAD_DIR || DEFAULT_UPLOAD_DIR,
			target,
			body: request.body,
		});
	} catch (error) {
		if (error instanceof UploadTooLargeError) return answer({ status: 413 });
		// Not console.error: the production build removes console calls.
		process.stderr.write(`Failed to keep an upload: ${String(error)}\n`);
		return answer({ status: 500 });
	}

	return answer({ status: 201 });
}
