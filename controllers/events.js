// controllers/events.js
const events = {};

export function on(event, handler) {
  if (!events[event]) events[event] = [];
  events[event].push(handler);
}

export function emit(event, data) {
  if (!events[event]) return;
  for (const handler of events[event]) {
    handler(data);
  }
}
