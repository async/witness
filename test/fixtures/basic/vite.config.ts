// This config intentionally avoids importing 'vite' so the fixture can be
// copied to a temp directory (with no node_modules) and still load.
export default {
	define: {
		// The restart box replaces this marker to prove that a config-file
		// edit restarts the dev server.
		__GUMBOX_CONFIG_MARKER__: JSON.stringify('marker-before'),
	},
	environments: {
		// One extra server-runnable environment so environment isolation is testable.
		ssr: {},
	},
};
