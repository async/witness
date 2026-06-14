// Test-only host boundary (like host-file-system.ts): the no-NODE_ENV-leak
// tests must control the host process env to reproduce how an operator
// launches witness from a normal shell, and library/test code itself is not
// allowed to touch runtime env APIs.
type HostProcessLike = { env?: Record<string, string | undefined> };

function hostEnv(): Record<string, string | undefined> {
	const env = (globalThis as { process?: HostProcessLike }).process?.env;
	if (env === undefined) {
		throw new Error('this host runtime exposes no process env to adapt');
	}
	return env;
}

/** Runs fn with NODE_ENV unset (a plain `witness` shell launch), then restores. */
export async function withUnsetNodeEnv<T>(run: () => Promise<T>): Promise<T> {
	const env = hostEnv();
	const before = env.NODE_ENV;
	delete env.NODE_ENV;
	try {
		return await run();
	} finally {
		if (before === undefined) {
			delete env.NODE_ENV;
		} else {
			env.NODE_ENV = before;
		}
	}
}
