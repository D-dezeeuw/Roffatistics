import { setValue } from 'spektrum';

const el = document.getElementById('panel');

export function showPanel(data) {
  setValue('panel.name', data.name ?? '');
  setValue('panel.code', data.code ?? '');
  setValue('panel.visible', true);
  el.setAttribute('aria-hidden', 'false');
}

export function hidePanel() {
  setValue('panel.visible', false);
  el.setAttribute('aria-hidden', 'true');
}
