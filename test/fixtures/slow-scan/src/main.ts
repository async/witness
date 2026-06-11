// A bare import is the only thing the dependency scanner resolves through
// the plugin container, which is where the fixture config slows the scan.
import 'slow-to-resolve';

const message = document.querySelector('#message');
if (message !== null) {
	message.textContent = 'slow scan fixture';
}

export {};
