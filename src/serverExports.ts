// Server-side copies of exports. Only the homelab nginx (nginx.conf) serves an
// exports/ directory that accepts PUT; on GitHub Pages it 404s and from a
// file:// double-click the fetch fails, so there everything stays download-only.

const EXPORTS_URL = "exports/";

let available: Promise<boolean> | null = null;

export function serverExportsAvailable(): Promise<boolean> {
	if (!available) {
		available = location.protocol.startsWith("http")
			? fetch(EXPORTS_URL, { method: "HEAD", cache: "no-store" })
					.then((r) => r.ok)
					.catch(() => false)
			: Promise.resolve(false);
	}
	return available;
}

export const EXPORTS_LISTING_URL = EXPORTS_URL;

// Store a copy on the server (same name overwrites, like saving a file).
// Silently does nothing where there is no export folder; alerts on a real
// upload failure since the user expects the copy to be there.
export async function storeOnServer(filename: string, blob: Blob): Promise<void> {
	if (!(await serverExportsAvailable())) return;
	const name = filename.replace(/[\\/:*?"<>|]+/g, "_").trim() || "export";
	try {
		const r = await fetch(EXPORTS_URL + encodeURIComponent(name), { method: "PUT", body: blob });
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
	} catch (err) {
		alert(`Downloaded "${name}", but storing a copy on the server failed (${String(err)}).`);
	}
}
