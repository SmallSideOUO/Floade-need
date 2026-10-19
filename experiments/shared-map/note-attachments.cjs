(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./connections.cjs') : root.mapConnections);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.mapNotes = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function (connections) {
  'use strict';
  function attachment(node) {
    const box = connections.boxOf(node), x = box.x + box.w, y = box.y + box.h / 2;
    const end = {x: x + 34, y: box.y + 8};
    return {end, radius: 9, d: `M ${x} ${y} C ${x + 28} ${y} ${end.x - 20} ${end.y} ${end.x} ${end.y}`};
  }
  return {attachment};
});
