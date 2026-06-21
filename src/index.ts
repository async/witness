import type { Plugin } from 'vite';

export { box, isBoxDefinition } from './box.ts';
export { discoverBoxes } from './discovery.ts';
export { createFileSystem } from './filesystem.ts';
export { restorePendingEdits, runBoxes } from './runner.ts';
export { WitnessAssertionError } from './expect.ts';
export { WitnessTimeoutError } from './evidence.ts';
export type {
	FileSystemDirectoryEntry,
	WitnessFileSystem,
	WitnessFileSystemRuntime,
} from './filesystem.ts';
export type {
	BrowserConsoleMessage,
	BrowserLaunchOptions,
	BrowserNetworkConditions,
	BrowserNetworkRequest,
	BrowserPageError,
	BrowserRequestFailure,
	WitnessBrowser,
	WitnessBrowserPage,
	WitnessBrowserSession,
	PageHandle,
	PageInteraction,
	PageNavigation,
	PageRecord,
	PageSnapshot,
	TrackedPageEvent,
} from './browser.ts';
export type {
	EvidenceEvent,
	HotPayloadEvidence,
	HotUpdateHookEvidence,
	ServerListeningEvidence,
	ServerRestartEvidence,
	FileEditEvidence,
} from './evidence.ts';
export type {
	ArtifactHandle,
	ArtifactJsonPredicate,
	ArtifactTextExpectation,
	AssertionRecord,
	BoxContext,
	BoxDefinition,
	BoxOptions,
	BoxRunFn,
	BoxRunResult,
	BrowserEnvironmentAlias,
	BuildArtifact,
	BuildHandle,
	BuildRecord,
	DevServerHandle,
	DiscoveredBox,
	DiscoveryResult,
	BodyTextExpectation,
	EditApi,
	EditChange,
	EditChangeSummary,
	EditedFile,
	EditEnvironmentExpectation,
	EditExpectation,
	EditOutcomePredicate,
	EditReceipt,
	EnvironmentApi,
	EnvironmentEditOutcome,
	EnvironmentFetchInit,
	EnvironmentHandle,
	EnvironmentResponse,
	ExpectApi,
	ExpectWaitOptions,
	InvalidBoxFile,
	Measurement,
	NamedBoxDefinition,
	PageEventExpectation,
	PageExpectApi,
	PageOutcomeExpectation,
	PipelineApi,
	PipelineBuildOptions,
	PipelineDevOptions,
	PipelinePreviewOptions,
	PreviewHandle,
	PreviewRecord,
	ProjectApi,
	ReceiptApi,
	ResponseExpectation,
	RunBoxesOptions,
	RunBoxesResult,
	ViteErrorEvidence,
	ViteHotMessageEvidence,
	ViteModuleEvidence,
	VitePluginEvidence,
	ViteUpdateEvidence,
} from './types.ts';

export function witness(): Plugin {
	return {
		name: 'async-witness',
	};
}
