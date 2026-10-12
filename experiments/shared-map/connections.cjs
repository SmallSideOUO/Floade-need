(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.mapConnections = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';
  function materialize(graph) {
    const ids = new Set(graph.nodes.map(node => node.id));
    for (const node of graph.nodes) {
      if (!node.parentId || node.parentId === node.id || !ids.has(node.parentId)) continue;
      if (!graph.edges.some(edge => edge.from === node.parentId && edge.to === node.id || edge.to === node.parentId && edge.from === node.id)) {
        let id = 'context:' + node.id;
        while (graph.edges.some(edge => edge.id === id)) id += ':1';
        graph.edges.push({id, from: node.parentId, to: node.id, label: ''});
      }
    }
    return graph;
  }
  function removeEdge(graph, id) {
    const edge = graph.edges.find(item => item.id === id);
    if (!edge) return;
    for (const node of graph.nodes) if (node.id === edge.from && node.parentId === edge.to || node.id === edge.to && node.parentId === edge.from) node.parentId = null;
    graph.edges = graph.edges.filter(item => item.id !== id);
  }
  function removeNode(graph, id) {
    graph.nodes = graph.nodes.filter(node => node.id !== id);
    for (const node of graph.nodes) if (node.parentId === id) node.parentId = null;
    graph.edges = graph.edges.filter(edge => edge.from !== id && edge.to !== id);
    if (graph.current === id) graph.current = null;
  }
  function style(edge) {
    return {color: /^#[0-9a-f]{6}$/i.test(edge.color || '') ? edge.color : '#64768d', width: Math.max(.5, Math.min(12, Number(edge.width) || 1.5)), lineStyle: edge.lineStyle === 'dashed' ? 'dashed' : 'solid'};
  }
  function ports(box) {
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    return [{side: 'top', x: cx, y: box.y + box.h * .02, dx: 0, dy: -1}, {side: 'right', x: box.x + box.w * .98, y: cy, dx: 1, dy: 0}, {side: 'bottom', x: cx, y: box.y + box.h * .98, dx: 0, dy: 1}, {side: 'left', x: box.x + box.w * .02, y: cy, dx: -1, dy: 0}];
  }
  function simplify(points) {
    const result = [];
    for (const point of points) {
      if (result.length && result.at(-1).x === point.x && result.at(-1).y === point.y) continue;
      result.push(point);
      while (result.length >= 3) {
        const a = result.at(-3), b = result.at(-2), c = result.at(-1);
        if ((a.x === b.x && b.x === c.x || a.y === b.y && b.y === c.y) && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0) result.splice(result.length - 2, 1);
        else break;
      }
    }
    return result;
  }
  function intersects(a, b, box, padding = 8) {
    const left = box.x - padding, right = box.x + box.w + padding, top = box.y - padding, bottom = box.y + box.h + padding;
    if (a.x === b.x) return a.x > left && a.x < right && Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom;
    return a.y > top && a.y < bottom && Math.max(a.x, b.x) > left && Math.min(a.x, b.x) < right;
  }
  function path(points) {
    if (!points.length) return '';
    let result = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[i - 1], b = points[i], c = points[i + 1], ab = Math.hypot(b.x - a.x, b.y - a.y), bc = Math.hypot(c.x - b.x, c.y - b.y), radius = Math.min(16, ab / 2, bc / 2);
      if (!radius) continue;
      const before = {x: b.x + (a.x - b.x) * radius / ab, y: b.y + (a.y - b.y) * radius / ab}, after = {x: b.x + (c.x - b.x) * radius / bc, y: b.y + (c.y - b.y) * radius / bc};
      result += ` L ${before.x} ${before.y} Q ${b.x} ${b.y} ${after.x} ${after.y}`;
    }
    const last = points.at(-1); return result + ` L ${last.x} ${last.y}`;
  }
  function route(a, b, obstacles = []) {
    let best;
    const margin = Math.max(20, Math.max(a.w, a.h, b.w, b.h) * .02 + 12);
    const left = Math.min(a.x, b.x, ...obstacles.map(box => box.x)) - 24, right = Math.max(a.x + a.w, b.x + b.w, ...obstacles.map(box => box.x + box.w)) + 24;
    const top = Math.min(a.y, b.y, ...obstacles.map(box => box.y)) - 24, bottom = Math.max(a.y + a.h, b.y + b.h, ...obstacles.map(box => box.y + box.h)) + 24;
    const nearby = obstacles.filter(box => box.id !== a.id && box.id !== b.id && box.x <= Math.max(a.x + a.w, b.x + b.w) && box.x + box.w >= Math.min(a.x, b.x) && box.y <= Math.max(a.y + a.h, b.y + b.h) && box.y + box.h >= Math.min(a.y, b.y)).slice(0, 3);
    for (const from of ports(a)) for (const to of ports(b)) {
      const s = {x: from.x + from.dx * margin, y: from.y + from.dy * margin}, t = {x: to.x + to.dx * margin, y: to.y + to.dy * margin};
      const candidates = [[from, s, {x: t.x, y: s.y}, t, to], [from, s, {x: s.x, y: t.y}, t, to]];
      for (const x of [(s.x + t.x) / 2, left, right, ...nearby.flatMap(box => [box.x - 24, box.x + box.w + 24])]) candidates.push([from, s, {x, y: s.y}, {x, y: t.y}, t, to]);
      for (const y of [(s.y + t.y) / 2, top, bottom, ...nearby.flatMap(box => [box.y - 24, box.y + box.h + 24])]) candidates.push([from, s, {x: s.x, y}, {x: t.x, y}, t, to]);
      for (const raw of candidates) {
        const points = simplify(raw); let length = 0, collisions = 0;
        for (let i = 1; i < points.length; i++) {
          const p = points[i - 1], q = points[i]; length += Math.hypot(q.x - p.x, q.y - p.y);
          for (const box of obstacles) {
            if (box.id === a.id && i === 1 || box.id === b.id && i === points.length - 1) continue;
            if (intersects(p, q, box)) collisions++;
          }
        }
        const score = collisions * 100000 + length + (points.length - 2) * 18;
        if (!best || score < best.score) best = {points, score, collisions, fromPort: from.side, toPort: to.side};
      }
    }
    return {...best, d: path(best.points)};
  }
  return {materialize, removeEdge, removeNode, style, ports, path, route};
});
