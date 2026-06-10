import { message } from './message';
import { serverSecret } from './server-secret';

export function render(): string {
	return `<main data-secret="${serverSecret}">${message}</main>`;
}
