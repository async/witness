/**
 * Minimal Chrome DevTools Protocol client: JSON-RPC over a WebSocket-shaped
 * transport. Uses only the web-standard global `WebSocket`, so it runs on
 * every runtime Vite runs on. The transport is an injectable `CdpSocket` so
 * the id correlation and event dispatch are unit-testable with a fake socket.
 */

/** WebSocket-shaped transport carrying JSON text frames. */
export type CdpSocket = {
	send(data: string): void;
	close(): void;
	onMessage(listener: (data: string) => void): void;
	onClose(listener: () => void): void;
};

export type CdpEventParams = Record<string, unknown>;

export type CdpConnection = {
	/** Calls one CDP method and resolves with its result object. */
	send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
	/** Registers an event listener; every listener for the method fires. */
	on(method: string, listener: (params: CdpEventParams) => void): void;
	close(): void;
};

type IncomingFrame = {
	id?: number;
	result?: Record<string, unknown>;
	error?: { code?: number; message?: string };
	method?: string;
	params?: CdpEventParams;
};

type PendingCall = {
	method: string;
	resolve(result: Record<string, unknown>): void;
	reject(error: Error): void;
};

/** Connects the global WebSocket to a CDP endpoint and adapts it to CdpSocket. */
export function openCdpSocket(url: string): Promise<CdpSocket> {
	return new Promise((resolve, reject) => {
		const webSocket = new WebSocket(url);
		webSocket.addEventListener(
			'open',
			() => {
				resolve({
					send: (data) => webSocket.send(data),
					close: () => webSocket.close(),
					onMessage: (listener) => {
						webSocket.addEventListener('message', (event) => {
							if (typeof event.data === 'string') {
								listener(event.data);
							}
						});
					},
					onClose: (listener) => {
						webSocket.addEventListener('close', () => listener(), { once: true });
					},
				});
			},
			{ once: true },
		);
		webSocket.addEventListener(
			'error',
			() => reject(new Error(`CDP WebSocket connection to ${url} failed.`)),
			{ once: true },
		);
	});
}

export function createCdpConnection(socket: CdpSocket): CdpConnection {
	let nextId = 1;
	let isClosed = false;
	const pendingCalls = new Map<number, PendingCall>();
	const eventListeners = new Map<string, Array<(params: CdpEventParams) => void>>();

	const rejectAllPending = (reason: string): void => {
		for (const pending of pendingCalls.values()) {
			pending.reject(
				new Error(`CDP connection ${reason} before '${pending.method}' answered.`),
			);
		}
		pendingCalls.clear();
	};

	socket.onMessage((data) => {
		let frame: IncomingFrame;
		try {
			frame = JSON.parse(data) as IncomingFrame;
		} catch {
			return;
		}
		if (frame.id !== undefined) {
			const pending = pendingCalls.get(frame.id);
			if (pending === undefined) {
				return;
			}
			pendingCalls.delete(frame.id);
			if (frame.error !== undefined) {
				pending.reject(
					new Error(
						`${pending.method} failed: ${frame.error.message ?? 'unknown CDP error'}`,
					),
				);
				return;
			}
			pending.resolve(frame.result ?? {});
			return;
		}
		if (frame.method !== undefined) {
			for (const listener of eventListeners.get(frame.method) ?? []) {
				listener(frame.params ?? {});
			}
		}
	});

	socket.onClose(() => {
		isClosed = true;
		rejectAllPending('closed');
	});

	return {
		send: (method, params) => {
			if (isClosed) {
				return Promise.reject(new Error(`CDP connection closed; cannot send '${method}'.`));
			}
			const id = nextId++;
			return new Promise((resolve, reject) => {
				pendingCalls.set(id, { method, resolve, reject });
				socket.send(
					JSON.stringify(params === undefined ? { id, method } : { id, method, params }),
				);
			});
		},
		on: (method, listener) => {
			const listeners = eventListeners.get(method);
			if (listeners === undefined) {
				eventListeners.set(method, [listener]);
				return;
			}
			listeners.push(listener);
		},
		close: () => {
			if (isClosed) {
				return;
			}
			isClosed = true;
			rejectAllPending('closed');
			socket.close();
		},
	};
}
