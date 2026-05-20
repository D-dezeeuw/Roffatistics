import { bindDOM, run, setValue } from 'spektrum';
import { initMap } from './modules/map.js';
import { initOverlays } from './modules/overlays.js';

setValue('panel.visible', false);
setValue('panel.name', '');
setValue('panel.code', '');

bindDOM();
run();

initMap();
initOverlays();
