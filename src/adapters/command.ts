export type AdapterCommand = {
	command: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
};

export type AdapterCommandResult = {
	stdout: string;
	stderr: string;
	exitCode: number | null;
};

export type AdapterCommandRunner = (command: AdapterCommand) => Promise<AdapterCommandResult>;

type HostProcessLike = {
	getBuiltinModule?(name: string): unknown;
	env?: Record<string, string | undefined>;
};

type NodeChildProcessLike = {
	execFile(
		command: string,
		args: string[],
		options: { cwd?: string; env?: Record<string, string | undefined> },
		callback: (error: unknown, stdout: string | Buffer, stderr: string | Buffer) => void,
	): void;
};

function nodeBuiltin<T>(name: string): T | undefined {
	return (
		globalThis as typeof globalThis & { process?: HostProcessLike }
	).process?.getBuiltinModule?.(name) as T | undefined;
}

export function createNodeCommandRunner(): AdapterCommandRunner {
	const childProcess = nodeBuiltin<NodeChildProcessLike>('child_process');
	if (childProcess === undefined) {
		throw new Error('pipeline adapter commands require a Node-compatible child_process host.');
	}
	return ({ command, args = [], cwd, env }) =>
		new Promise((resolve, reject) => {
			childProcess.execFile(
				command,
				args,
				{
					cwd,
					env: { ...(globalThis as { process?: HostProcessLike }).process?.env, ...env },
				},
				(error, stdout, stderr) => {
					const result = {
						stdout: stdout.toString(),
						stderr: stderr.toString(),
						exitCode:
							typeof error === 'object' &&
							error !== null &&
							typeof (error as { code?: unknown }).code === 'number'
								? (error as { code: number }).code
								: error === null
									? 0
									: null,
					};
					if (error !== null) {
						reject(
							Object.assign(
								new Error(result.stderr || result.stdout || String(error)),
								result,
							),
						);
						return;
					}
					resolve(result);
				},
			);
		});
}

export function parseJsonCommandOutput<T>(result: AdapterCommandResult, context: string): T {
	try {
		return JSON.parse(result.stdout) as T;
	} catch (error) {
		throw new Error(
			`${context} returned invalid JSON: ${error instanceof Error ? error.message : error}`,
		);
	}
}
