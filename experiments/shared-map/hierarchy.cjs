(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.mapHierarchy = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';
  function lineage(nodes, id) {
    const lookup = new Map(nodes.map(node => [node.id, node]));
    const seen = new Set(), result = [];
    while (lookup.has(id) && !seen.has(id)) {
      seen.add(id);
      const node = lookup.get(id);
      result.unshift(node);
      id = node.parentId;
    }
    return result;
  }
  function canParent(nodes, id, parentId) {
    return !parentId || (nodes.some(node => node.id === parentId) &&
      !lineage(nodes, parentId).some(node => node.id === id));
  }
  function outline(nodes) {
    const lookup = new Map(nodes.map(node => [node.id, node]));
    const children = new Map(), rows = [], seen = new Set();
    for (const node of nodes) {
      const parent = lookup.has(node.parentId) && canParent(nodes, node.id, node.parentId) ? node.parentId : null;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(node);
    }
    function walk(parent, depth) {
      for (const node of children.get(parent) || []) {
        if (seen.has(node.id)) continue;
        seen.add(node.id); rows.push({node, depth}); walk(node.id, depth + 1);
      }
    }
    walk(null, 0);
    for (const node of nodes) if (!seen.has(node.id)) { rows.push({node, depth: 0}); seen.add(node.id); }
    return rows;
  }
  return {lineage, canParent, outline};
});
