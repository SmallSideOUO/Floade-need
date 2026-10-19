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
  function path(points, cornerRadius = 16) {
    if (!points.length) return '';
    let result = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[i - 1], b = points[i], c = points[i + 1], ab = Math.hypot(b.x - a.x, b.y - a.y), bc = Math.hypot(c.x - b.x, c.y - b.y), radius = Math.min(cornerRadius, ab / 2, bc / 2);
      if (!radius) { result += ` L ${b.x} ${b.y}`; continue; }
      const before = {x: b.x + (a.x - b.x) * radius / ab, y: b.y + (a.y - b.y) * radius / ab}, after = {x: b.x + (c.x - b.x) * radius / bc, y: b.y + (c.y - b.y) * radius / bc};
      result += ` L ${before.x} ${before.y} Q ${b.x} ${b.y} ${after.x} ${after.y}`;
    }
    const last = points.at(-1); return result + ` L ${last.x} ${last.y}`;
  }
  function orthogonalRoute(a, b, obstacles = [], edge = {}) {
    let best;
    const margin = Math.max(20, Math.max(a.w, a.h, b.w, b.h) * .02 + 12);
    const left = Math.min(a.x, b.x, ...obstacles.map(box => box.x)) - 24, right = Math.max(a.x + a.w, b.x + b.w, ...obstacles.map(box => box.x + box.w)) + 24;
    const top = Math.min(a.y, b.y, ...obstacles.map(box => box.y)) - 24, bottom = Math.max(a.y + a.h, b.y + b.h, ...obstacles.map(box => box.y + box.h)) + 24;
    const nearby = obstacles.filter(box => box.id !== a.id && box.id !== b.id && box.x <= Math.max(a.x + a.w, b.x + b.w) && box.x + box.w >= Math.min(a.x, b.x) && box.y <= Math.max(a.y + a.h, b.y + b.h) && box.y + box.h >= Math.min(a.y, b.y)).slice(0, 3);
    for (const from of ports(a).filter(port=>!edge.fromPort||edge.fromPort==='auto'||port.side===edge.fromPort)) for (const to of ports(b).filter(port=>!edge.toPort||edge.toPort==='auto'||port.side===edge.toPort)) {
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
  function cubic(p, c1, c2, q) {
    const points = Array.from({length: 41}, (_, i) => {
      const t = i / 40, u = 1 - t;
      return {x: u*u*u*p.x + 3*u*u*t*c1.x + 3*u*t*t*c2.x + t*t*t*q.x, y: u*u*u*p.y + 3*u*u*t*c1.y + 3*u*t*t*c2.y + t*t*t*q.y};
    });
    return {points, d: `M ${p.x} ${p.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${q.x} ${q.y}`};
  }
  function curveCost(points, a, b, obstacles, occupied) {
    let collisions = 0, length = 0, overlap = 0;
    for (let i = 1; i < points.length; i++) {
      const p = points[i]; length += Math.hypot(p.x - points[i-1].x, p.y - points[i-1].y);
      for (const box of obstacles) {
        if (box.id === a.id && i < 5 || box.id === b.id && i > points.length - 6) continue;
        if (p.x > box.x - 8 && p.x < box.x + box.w + 8 && p.y > box.y - 8 && p.y < box.y + box.h + 8) collisions++;
      }
      if (i > 7 && i < points.length - 8) for (const other of occupied) {
        if (other.points?.some(q => Math.hypot(p.x-q.x,p.y-q.y) < 12)) overlap += 18;
      }
    }
    return {collisions, score: collisions * 100000 + length + overlap};
  }
  function route(a, b, obstacles = [], edge = {}, occupied = []) {
    if (edge.routing === 'rounded' && !edge.waypoints?.length && !edge.controlPoints) {
      const result = orthogonalRoute(a, b, obstacles, edge); return {...result, d: path(result.points, edge.cornerRadius ?? 32)};
    }
    const fromPorts = ports(a).filter(port => !edge.fromPort || edge.fromPort === 'auto' || port.side === edge.fromPort);
    const toPorts = ports(b).filter(port => !edge.toPort || edge.toPort === 'auto' || port.side === edge.toPort);
    let best;
    for (const from of fromPorts) for (const to of toPorts) {
      let result;
      if (edge.waypoints?.length) {
        const points = [from, ...edge.waypoints, to];
        result = {points, d: path(points, edge.cornerRadius ?? 40)};
      } else {
        const dx = to.x-from.x, dy = to.y-from.y, distance = Math.hypot(dx,dy);
        const reach = Math.max(24, Math.min(320, distance * (edge.curvature ?? .38)));
        const offset = edge.offset || 0, nx = -dy/Math.max(1,distance), ny = dx/Math.max(1,distance);
        const controls = edge.controlPoints || [{x: from.x+from.dx*reach+nx*offset, y: from.y+from.dy*reach+ny*offset}, {x: to.x+to.dx*reach+nx*offset, y: to.y+to.dy*reach+ny*offset}];
        result = cubic(from, controls[0], controls[1], to);
      }
      const cost = curveCost(result.points,a,b,obstacles,occupied);
      if (!best || cost.score < best.score) best = {...result,...cost,fromPort:from.side,toPort:to.side};
    }
    if (best.collisions && !edge.controlPoints && !edge.waypoints?.length && (!edge.fromPort || edge.fromPort==='auto') && (!edge.toPort || edge.toPort==='auto')) {
      const fallback = orthogonalRoute(a,b,obstacles);
      if (!fallback.collisions) return {...fallback,d:path(fallback.points,edge.cornerRadius ?? 48)};
    }
    return best;
  }
  function boxOf(node) {
    return {id:node.id,x:node.x-(node.width || (node.shape==='circle'?140:210))/2,y:node.y,w:node.width || (node.shape==='circle'?140:210),h:node.height || (node.shape==='circle'?140:node.shape==='diamond'?130:100)};
  }
  function shapePath(node) {
    if (node.shape==='circle'||node.shape==='ellipse') return 'M 50 2 A 48 48 0 1 1 49.99 2 Z';
    if (node.shape==='diamond') return 'M 50 2 L 98 50 L 50 98 L 2 50 Z';
    return node.shape==='rectangle'?'M 2 2 H 98 V 98 H 2 Z':'M 10 2 H 90 Q 98 2 98 10 V 90 Q 98 98 90 98 H 10 Q 2 98 2 90 V 10 Q 2 2 10 2 Z';
  }
  function routes(graph) {
    const boxes=graph.nodes.map(boxOf), lookup=new Map(boxes.map(box=>[box.id,box])), result=new Map();
    if (graph.treeMode) {
      for (const edge of graph.edges) {
        const parent = lookup.get(edge.from), child = lookup.get(edge.to); if (!parent || !child) continue;
        const siblings = graph.edges.filter(item => item.from === edge.from && lookup.has(item.to)).map(item => lookup.get(item.to));
        const start = {x: parent.x + parent.w / 2, y: parent.y + parent.h}, end = {x: child.x + child.w / 2, y: child.y};
        const junction = (start.y + Math.min(...siblings.map(box => box.y))) / 2;
        const points = [start, {x: start.x, y: junction}, {x: end.x, y: junction}, end];
        result.set(edge.id, {points, d: path(points, 0), fromPort: 'bottom', toPort: 'top', collisions: 0});
      }
      return result;
    }
    for(const edge of graph.edges) if(lookup.has(edge.from)&&lookup.has(edge.to)) result.set(edge.id,route(lookup.get(edge.from),lookup.get(edge.to),boxes,edge,[...result.values()]));
    return result;
  }
  return {materialize, removeEdge, removeNode, style, ports, path, route, boxOf, shapePath, routes};
});
