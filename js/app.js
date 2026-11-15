import { initStore } from './store.js';
import { mountCalendar } from './views/calendar.js';
import { mountBody } from './views/body.js';

initStore();

const views = {
  calendar: mountCalendar(document.getElementById('view-calendar')),
  body: mountBody(document.getElementById('view-body')),
};

function show(name) {
  if (!views[name]) name = 'calendar';
  for (const key of Object.keys(views)) {
    document.getElementById(`view-${key}`).hidden = key !== name;
  }
  for (const a of document.querySelectorAll('.tabbar a')) {
    if (a.hash === `#${name}`) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  views[name].render();
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => show(location.hash.slice(1)));
show(location.hash.slice(1));
