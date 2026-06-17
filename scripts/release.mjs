import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const releaseArgs = process.argv.slice(2).filter((argument) => argument !== '--');
const isDryRun = releaseArgs.includes('--dry-run');
const bumppArgs = releaseArgs.filter((argument) => argument !== '--dry-run');

await main();

async function main() {
	await preflight();

	await step('bump version in package.json', [
		'pnpm',
		'exec',
		'bumpp',
		'package.json',
		'--no-commit',
		'--no-tag',
		'--no-push',
		...bumppArgs,
	]);

	const version = await readReleasedVersion();
	const tag = `v${version}`;

	await step('build dist', ['pnpm', 'run', 'build']);

	if (isDryRun) {
		console.log(`\nrelease notes preview for ${tag}:\n`);
		console.log(await releaseNotes(version));
		await step('npm publish (dry run)', ['npm', 'publish', '--dry-run', '--access', 'public']);
		console.log(`\ndry run complete: ${tag} was not committed, tagged, or published.`);
		console.log('inspect the bump, then undo with: git restore package.json pnpm-lock.yaml');
		return;
	}

	await step(`stage release of ${tag}`, ['git', 'add', 'package.json', 'pnpm-lock.yaml']);
	await step(`commit ${tag}`, ['git', 'commit', '-m', `chore: release ${tag}`]);
	await step(`tag ${tag}`, ['git', 'tag', '-a', tag, '-m', tag]);

	try {
		await step('npm publish', ['npm', 'publish', '--access', 'public']);
		await step('push main and tag', ['git', 'push', 'origin', 'main', tag]);
		await createGithubRelease(tag, version);
	} catch (error) {
		console.error(`\nrelease ${tag} is committed and tagged locally but did not finish.`);
		console.error(
			'finish the remaining steps by hand, or delete the local tag and inspect the commit:',
		);
		console.error(`  git tag -d ${tag}`);
		throw error;
	}

	console.log(`\nreleased @async/witness ${tag}`);
}

async function preflight() {
	const branch = await capture(['git', 'rev-parse', '--abbrev-ref', 'HEAD']);
	if (branch !== 'main') {
		throw new Error(`releases ship from main; currently on '${branch}'.`);
	}

	const trackedChanges = await capture(['git', 'status', '--porcelain', '--untracked-files=no']);
	if (trackedChanges !== '') {
		throw new Error(
			`tracked files have local changes; commit or stash them first:\n${trackedChanges}`,
		);
	}

	await step('run tests', ['pnpm', 'run', 'test']);
}

async function readReleasedVersion() {
	const manifest = JSON.parse(await readFile('package.json', 'utf8'));
	if (typeof manifest.version !== 'string' || manifest.version === '') {
		throw new Error('package.json has no version after the bump.');
	}
	return manifest.version;
}

async function releaseNotes(version) {
	return capture(['pnpm', 'exec', 'changelogen', '-r', version]);
}

async function createGithubRelease(tag, version) {
	const notes = await releaseNotes(version);
	await mkdir('.tmp', { recursive: true });
	const notesFile = '.tmp/release-notes.md';

	try {
		await writeFile(notesFile, notes);
		await step(`create GitHub release ${tag}`, [
			'gh',
			'release',
			'create',
			tag,
			'--title',
			tag,
			'--notes-file',
			notesFile,
		]);
	} finally {
		await rm(notesFile, { force: true });
	}
}

async function step(label, command) {
	console.log(`\n> ${label}`);
	const { status } = await run(command, 'inherit');
	if (status !== 0) {
		throw new Error(`step failed: ${label} (${command.join(' ')})`);
	}
}

async function capture(command) {
	const { status, stdout, stderr } = await run(command, 'pipe');
	if (status !== 0) {
		throw new Error(`command failed: ${command.join(' ')}\n${stderr}`);
	}
	return stdout.trim();
}

function run(command, stdio) {
	const [executable, ...args] = command;

	return new Promise((resolve, reject) => {
		const child = spawn(executable, args, { stdio });
		let stdout = '';
		let stderr = '';

		if (child.stdout !== null) {
			child.stdout.on('data', (chunk) => {
				stdout += chunk;
			});
		}

		if (child.stderr !== null) {
			child.stderr.on('data', (chunk) => {
				stderr += chunk;
			});
		}

		child.on('error', reject);
		child.on('close', (status) => resolve({ status: status ?? 1, stdout, stderr }));
	});
}
