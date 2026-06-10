import { message } from './message';

const target = document.querySelector('#message');
if (target) {
	target.textContent = message;
}
