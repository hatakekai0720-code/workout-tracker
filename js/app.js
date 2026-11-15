import { initStore } from './store.js';
import { mountCalendar } from './views/calendar.js';

initStore();
mountCalendar(document.getElementById('app'));
