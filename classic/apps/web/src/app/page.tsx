import { redirect } from "next/navigation";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * This host has no landing page: the site opens on the list of projects. The
 * query goes along, so an address signed for server copies (`@/upload/ticket`)
 * works here too.
 */
export default async function Home({
	searchParams,
}: {
	searchParams: Promise<SearchParams>;
}) {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(await searchParams)) {
		for (const item of [value].flat()) {
			if (item !== undefined) query.append(key, item);
		}
	}

	const suffix = query.size > 0 ? `?${query.toString()}` : "";
	redirect(`/projects${suffix}`);
}
