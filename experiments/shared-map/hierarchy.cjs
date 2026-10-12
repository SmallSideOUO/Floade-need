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
  function layout(nodes, {primaryId = 'world', gapX = 90, gapY = 120} = {}) {
    const rows = outline(nodes), children = new Map(), roots = [];
    const lookup = new Map(nodes.map(node => [node.id, node]));
    const size = node => ({w: node.width || (node.shape === 'circle' ? 140 : 210), h: node.height || (node.shape === 'circle' ? 140 : node.shape === 'diamond' ? 130 : 100)});
    for (const {node} of rows) {
      const parent = lookup.has(node.parentId) && canParent(nodes, node.id, node.parentId) ? node.parentId : null;
      if (parent) {
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(node);
      } else roots.push(node);
    }
    roots.sort((a, b) => a.id === primaryId ? -1 : b.id === primaryId ? 1 : 0);
    const widths = new Map(), heights = [], positions = [];
    function measure(node, depth) {
      const own = size(node), kids = children.get(node.id) || [];
      heights[depth] = Math.max(heights[depth] || 0, own.h);
      const width = Math.max(own.w, kids.reduce((sum, child) => sum + measure(child, depth + 1), 0) + Math.max(0, kids.length - 1) * gapX);
      widths.set(node.id, width);
      return width;
    }
    const primary = roots.some(node => node.id === primaryId);
    for (const root of roots) measure(root, primary && root.id !== primaryId ? 1 : 0);
    const levels = [0];
    for (let depth = 1; depth < heights.length; depth++) levels[depth] = levels[depth - 1] + (heights[depth - 1] || 100) + gapY;
    function place(node, left, depth) {
      const width = widths.get(node.id), kids = children.get(node.id) || [];
      positions.push({id: node.id, x: left + width / 2, y: levels[depth] || 0});
      const kidsWidth = kids.reduce((sum, child) => sum + widths.get(child.id), 0) + Math.max(0, kids.length - 1) * gapX;
      let cursor = left + (width - kidsWidth) / 2;
      for (const child of kids) { place(child, cursor, depth + 1); cursor += widths.get(child.id) + gapX; }
    }
    let cursor = 0;
    for (const root of roots) { place(root, cursor, primary && root.id !== primaryId ? 1 : 0); cursor += widths.get(root.id) + gapX * 2; }
    const origin = positions.find(node => node.id === primaryId)?.x || positions[0]?.x || 0;
    return positions.map(node => ({...node, x: node.x - origin}));
  }
  return {lineage, canParent, outline, layout};
});
