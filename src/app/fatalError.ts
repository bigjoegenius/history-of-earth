/**
 * Full-screen message shown when the app cannot start (usually missing or blocked WebGL),
 * instead of a blank page. The error text is inserted as text, never as HTML.
 */

const WEBGL_HINT =
  'The 3D globe needs WebGL, which this browser or graphics driver could not provide. ' +
  'Try an up-to-date Chrome, Edge, Firefox or Safari, and check that hardware acceleration is turned on.';
const GENERIC_HINT = 'Something went wrong while starting History of Earth. Reloading the page often helps.';

function describe(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

export function showFatalError(root: HTMLElement, err: unknown): void {
  console.error(err);
  const message = describe(err);
  const isWebGL = /webgl|graphics|context/i.test(message);

  const el = document.createElement('div');
  el.className = 'hoe-fatal';
  el.setAttribute('role', 'alert');
  const card = document.createElement('div');
  card.className = 'hoe-fatal__card';

  const title = document.createElement('h1');
  title.textContent = isWebGL ? 'The globe could not start' : 'History of Earth could not start';
  const hint = document.createElement('p');
  hint.textContent = isWebGL ? WEBGL_HINT : GENERIC_HINT;
  const details = document.createElement('pre');
  details.textContent = message;
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = 'Reload';
  reload.addEventListener('click', () => location.reload());

  card.append(title, hint, details, reload);
  el.append(card);
  root.append(el);
}
