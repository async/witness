/**
 * Pure file-URL <-> path helpers built on web-standard URL parsing only, so
 * library code never reaches for `node:url` (or wrappers like mlly that lean
 * on it). Covers the shapes witness meets: posix paths, Windows drive-letter
 * paths, and UNC hosts. Output paths use forward slashes, matching pathe.
 */

export function fileURLToPath(url: string | URL): string {
	const parsed = typeof url === 'string' ? new URL(url) : url;
	if (parsed.protocol !== 'file:') {
		throw new Error(`fileURLToPath('${String(url)}') expects a file:// URL.`);
	}
	const pathname = decodeURIComponent(parsed.pathname);
	if (parsed.hostname !== '') {
		// file://server/share -> UNC path //server/share
		return `//${parsed.hostname}${pathname}`;
	}
	if (isWindowsDrivePathname(pathname)) {
		// file:///C:/dir carries a URL-only leading slash before the drive.
		return pathname.slice(1);
	}
	return pathname;
}

function isWindowsDrivePathname(pathname: string): boolean {
	return /^\/[A-Za-z]:(\/|$)/.test(pathname);
}

export function pathToFileURL(filePath: string): string {
	const withForwardSlashes = filePath.replace(/\\/g, '/');
	// %, ? and # would be parsed as URL syntax; the URL parser encodes the
	// rest (spaces and friends) itself.
	const encoded = withForwardSlashes.replace(/[%?#]/g, (char) => encodeURIComponent(char));
	if (withForwardSlashes.startsWith('//')) {
		// UNC path //server/share -> file://server/share
		return new URL(`file:${encoded}`).href;
	}
	const prefix = withForwardSlashes.startsWith('/') ? 'file://' : 'file:///';
	return new URL(`${prefix}${encoded}`).href;
}
