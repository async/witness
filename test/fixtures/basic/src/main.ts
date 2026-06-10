import { customMessage } from './custom-message';
import { message } from './message';
import { silent } from './silent';

// Keep custom-message.ts in the client module graph; its HMR is handled by
// the fixture's custom hot protocol plugin, not by Vite update payloads.
console.log(customMessage);
// Keep silent.ts in the client module graph; the fixture's swallowed hot
// update plugin suppresses its HMR without sending any payload at all.
console.log(silent);

function render(value: string): void {
	const target = document.querySelector('#message');
	if (target) {
		target.textContent = value;
	}
}

render(message);

if (import.meta.hot) {
	// Accepting './message' makes edits to it an HMR update, not a full reload.
	import.meta.hot.accept('./message', (updated) => {
		if (updated) {
			render(updated.message as string);
		}
	});
}
