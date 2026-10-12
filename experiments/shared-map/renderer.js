'use strict';
(async () => {
  const $ = selector => document.querySelector(selector);
  const canvas = $('#canvas'), layer = $('#nodes'), lines = $('#lines'), panelLayer = $('#panels'), menu = $('#context-menu');
  const {route, ports, style, removeEdge, removeNode} = window.mapConnections;
  let graph, view = {x: 0, y: 0, z: .6}, settings = {aiMode: 'protected', visualMode: 'selective'};
  let selected = null, gesture = null, menuPoint = null, saveTimer, ready = false, panelOrder = 0;
  const panels = new Map(), revealed = new Set();
  const by = id => graph.nodes.find(node => node.id === id);
  const edgeBy = id => graph.edges.find(edge => edge.id === id);
  const baseSize = node => ({w: node.width || (node.shape === 'circle' ? 140 : 210), h: node.height || (node.shape === 'circle' ? 140 : node.shape === 'diamond' ? 130 : 100)});
  const dims = node => { const size = baseSize(node); return {w: size.w * view.z, h: size.h * view.z}; };
  const at = point => ({x: view.x + point.x * view.z, y: view.y + point.y * view.z});
  const visual = node => !node ? 'object' : settings.visualMode === 'show' || revealed.has(node.id) ? 'full' : settings.visualMode === 'mask' ? (node.visualVisibility === 'object' ? 'object' : 'text') : node.visualVisibility || 'full';
  const label = node => !node ? '未指定' : visual(node) === 'full' ? node.title || '未命名' : '••••••';
  const payload = () => ({graph, view, settings, panels: [...panels.values()].map(({kind, id, x, y}) => ({kind, id, x, y}))});

  function save() {
    clearTimeout(saveTimer);
    $('#save-status').textContent = '儲存中…';
    saveTimer = setTimeout(async () => {
      try { await window.mapStore.save(payload()); $('#save-status').textContent = '已儲存 · AI 版本已更新'; }
      catch (error) { $('#save-status').textContent = '儲存失敗：' + error.message; }
    }, 130);
  }
  function svg(name, attrs = {}) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    return element;
  }
  function shapePath(node) {
    if (node.shape === 'circle' || node.shape === 'ellipse') return 'M 50 2 A 48 48 0 1 1 49.99 2 Z';
    if (node.shape === 'diamond') return 'M 50 2 L 98 50 L 50 98 L 2 50 Z';
    return node.shape === 'rectangle' ? 'M 2 2 H 98 V 98 H 2 Z' : 'M 10 2 H 90 Q 98 2 98 10 V 90 Q 98 98 90 98 H 10 Q 2 98 2 90 V 10 Q 2 2 10 2 Z';
  }
  let routeKey = '', routeCache = new Map();
  const boxOf = node => { const size = baseSize(node); return {id: node.id, x: node.x - size.w / 2, y: node.y, w: size.w, h: size.h}; };
  function linkTarget(event) { const node = document.elementFromPoint(event.clientX, event.clientY)?.closest('.node'); return node?.dataset.id || null; }
  function draw() {
    const bounds = canvas.getBoundingClientRect(), boxes = graph.nodes.filter(node => visual(node) !== 'object').map(boxOf);
    const key = JSON.stringify([boxes, graph.edges.map(edge => [edge.id, edge.from, edge.to])]);
    if (key !== routeKey) {
      routeKey = key; routeCache = new Map(); const lookup = new Map(boxes.map(box => [box.id, box]));
      for (const edge of graph.edges) if (lookup.has(edge.from) && lookup.has(edge.to)) routeCache.set(edge.id, route(lookup.get(edge.from), lookup.get(edge.to), boxes));
    }
    lines.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`); lines.replaceChildren(); layer.replaceChildren();
    const drawing = svg('g', {transform: `translate(${view.x} ${view.y}) scale(${view.z})`}); lines.append(drawing);
    for (const edge of graph.edges) {
      const result = routeCache.get(edge.id); if (!result) continue;
      const appearance = style(edge), a = by(edge.from), b = by(edge.to);
      const line = svg('path', {d: result.d, fill: 'none', stroke: appearance.color, 'stroke-width': appearance.width, 'vector-effect': 'non-scaling-stroke', class: 'connection-line', 'data-edge-id': edge.id, 'data-open': panels.has('edge:' + edge.id)});
      if (appearance.lineStyle === 'dashed') line.setAttribute('stroke-dasharray', '7 5');
      line.style.opacity = String(Math.min(a.opacity ?? 1, b.opacity ?? 1)); drawing.append(line);
      const hit = svg('path', {d: result.d, fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(14, appearance.width + 10), 'vector-effect': 'non-scaling-stroke', class: 'connection-hit', 'data-edge-id': edge.id, role: 'button', tabindex: 0, 'aria-label': '編輯連線：' + label(a) + ' ↔ ' + label(b)});
      hit.addEventListener('click', event => { if (event.detail === 0 && !gesture) { openPanel('edge', edge.id); draw(); save(); } });
      hit.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPanel('edge', edge.id); draw(); save(); } }); drawing.append(hit);
      if (edge.label && view.z >= .65 && visual(a) === 'full' && visual(b) === 'full') {
        const middle = result.points[Math.floor(result.points.length / 2)], text = svg('text', {x: middle.x, y: middle.y - 9 / view.z, fill: '#9999a5', 'font-size': 11 / view.z, 'text-anchor': 'middle'}); text.textContent = edge.label; drawing.append(text);
      }
    }
    if (gesture?.type === 'link') {
      const node = by(gesture.node), start = ports(boxOf(node)).find(port => port.side === gesture.port), end = gesture.point;
      const distance = Math.max(40, Math.hypot(end.x - start.x, end.y - start.y) * .35);
      const preview = svg('path', {d: `M ${start.x} ${start.y} C ${start.x + start.dx * distance} ${start.y + start.dy * distance} ${end.x} ${end.y} ${end.x} ${end.y}`, fill: 'none', stroke: '#78aef8', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', class: 'connection-preview'}); drawing.append(preview);
    }
    for (const node of graph.nodes) {
      if (visual(node) === 'object') continue;
      const point = at(node), size = dims(node), button = document.createElement('button');
      button.type = 'button'; button.className = 'node'; button.dataset.id = node.id;
      for (const [key, value] of Object.entries({selected: node.id === selected, linking: gesture?.type === 'link' && gesture.node === node.id, linkTarget: gesture?.type === 'link' && gesture.target === node.id && gesture.node !== node.id, masked: visual(node) !== 'full'})) button.dataset[key] = String(value);
      button.setAttribute('aria-label', label(node));
      Object.assign(button.style, {left: point.x - size.w / 2 + 'px', top: point.y + 'px', width: size.w + 'px', height: size.h + 'px', color: node.textColor || '#eeeef1', opacity: String(node.opacity ?? 1)});
      const image = svg('svg', {viewBox: '0 0 100 100', preserveAspectRatio: 'none'}), shape = svg('path', {d: shapePath(node), class: 'node-shape'});
      shape.style.fill = node.background || '#17171b'; image.append(shape); button.append(image);
      const copy = document.createElement('span'), title = document.createElement('strong'); copy.className = 'node-copy'; copy.style.fontSize = Math.max(9, Math.min(15, 13 * view.z)) + 'px'; title.textContent = label(node); copy.append(title);
      if (view.z >= .65 && visual(node) === 'full' && node.mark) { const mark = document.createElement('small'); mark.textContent = node.mark; copy.append(mark); }
      button.append(copy); button.addEventListener('click', event => { if (event.detail === 0) select(node.id); }); layer.append(button);
      for (const side of ['top', 'right', 'bottom', 'left']) { const port = document.createElement('span'); port.className = 'connection-port'; port.dataset.port = side; port.setAttribute('aria-hidden', 'true'); button.append(port); }
      if (node.id === selected) {
        const handle = document.createElement('button'); handle.className = 'resize-handle'; handle.dataset.resize = node.id; handle.type = 'button'; handle.setAttribute('aria-label', '拖曳調整物件大小'); handle.style.left = point.x + size.w / 2 - 5 + 'px'; handle.style.top = point.y + size.h - 5 + 'px'; layer.append(handle);
      }
    }
    $('#scale').textContent = Math.round(view.z * 100) + '%'; syncPanels();
  }
  function overview() {
    const nodes = graph.nodes.filter(node => visual(node) !== 'object'), bounds = canvas.getBoundingClientRect();
    if (!nodes.length) { view = {x: bounds.width / 2, y: bounds.height / 2, z: .6}; draw(); return; }
    const left = Math.min(...nodes.map(node => node.x - baseSize(node).w / 2)), right = Math.max(...nodes.map(node => node.x + baseSize(node).w / 2));
    const top = Math.min(...nodes.map(node => node.y)), bottom = Math.max(...nodes.map(node => node.y + baseSize(node).h));
    view.z = Math.max(.15, Math.min(1, (bounds.width - 100) / Math.max(1, right - left), (bounds.height - 90) / Math.max(1, bottom - top)));
    view.x = bounds.width / 2 - (left + right) * view.z / 2; view.y = 40 - top * view.z; draw();
  }
  function zoomAt(x, y, factor) {
    const old = view.z, zoom = Math.max(.15, Math.min(2, old * factor));
    view.x = x - (x - view.x) * zoom / old; view.y = y - (y - view.y) * zoom / old; view.z = zoom; draw();
  }
  function positionPanel(panel) { const point = at(panel); panel.element.style.left = point.x + 'px'; panel.element.style.top = point.y + 'px'; }
  function raise(panel) { panel.element.style.zIndex = String(++panelOrder); }
  function closePanel(key) {
    const panel = panels.get(key); if (!panel) return;
    // Removing a focused field can synchronously dispatch blur/change events.
    // Retire the panel first so those events cannot try to remove it again.
    panels.delete(key);
    if (panel.kind === 'node') revealed.delete(panel.id);
    panel.element.remove();
  }
  function openPanel(kind, id, restored) {
    const key = kind + ':' + id, existing = panels.get(key);
    if (existing) {
      const rect = existing.element.getBoundingClientRect(), bounds = canvas.getBoundingClientRect();
      if (rect.left < bounds.left + 12 || rect.right > bounds.right - 12 || rect.top < bounds.top + 12 || rect.top > bounds.bottom - 80) {
        const point = at(kind === 'node' ? by(id) : by(edgeBy(id).from));
        existing.x = (Math.max(12, Math.min(bounds.width - 316, point.x + 24)) - view.x) / view.z;
        existing.y = (Math.max(12, Math.min(bounds.height - 220, point.y)) - view.y) / view.z;
        positionPanel(existing);
      }
      raise(existing); return existing;
    }
    const node = kind === 'node' ? by(id) : by(edgeBy(id)?.from);
    if (!node || visual(node) === 'object') return null;
    if (kind === 'edge' && visual(by(edgeBy(id)?.to)) === 'object') return null;
    const element = document.createElement('section'); element.className = 'object-panel'; element.dataset.panelId = id; element.dataset.kind = kind; element.setAttribute('aria-label', kind === 'node' ? '物件編輯面板' : '連線編輯面板');
    element.append($('#' + kind + '-panel-template').content.cloneNode(true));
    const bounds = canvas.getBoundingClientRect(), point = at(node), size = dims(node);
    let x = point.x + size.w / 2 + 14, y = point.y;
    if (x + 304 > bounds.width - 12) x = point.x - size.w / 2 - 318;
    x = Math.max(12, Math.min(bounds.width - 316, x)); y = Math.max(12, Math.min(bounds.height - 220, y));
    for (const other of panels.values()) { const spot = at(other); if (Math.abs(spot.x - x) < 24 && Math.abs(spot.y - y) < 24) { x = Math.max(12, Math.min(bounds.width - 316, x + 36)); y += 36; } }
    const panel = {kind, id, element, x: restored?.x ?? (x - view.x) / view.z, y: restored?.y ?? (y - view.y) / view.z};
    panels.set(key, panel); panelLayer.append(element); raise(panel);
    element.addEventListener('pointerdown', () => raise(panel));
    element.addEventListener('input', event => editPanel(panel, event));
    element.addEventListener('change', event => editPanel(panel, event));
    element.addEventListener('click', event => panelAction(panel, event));
    element.querySelector('.panel-heading').addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button')) return;
      event.preventDefault(); event.stopPropagation(); raise(panel);
      gesture = {id: event.pointerId, type: 'panel', key, sx: event.clientX, sy: event.clientY, x: panel.x, y: panel.y, moved: false};
      event.currentTarget.setPointerCapture(event.pointerId);
    });
    syncPanels(); return panel;
  }
  function setField(panel, name, value, disabled = false) {
    const field = panel.element.querySelector(`[data-field="${name}"]`);
    if (!field) return;
    if (field.value !== String(value)) field.value = String(value);
    field.disabled = disabled;
  }
  function syncPanels() {
    for (const [key, panel] of panels) {
      const node = panel.kind === 'node' ? by(panel.id) : null, edge = panel.kind === 'edge' ? edgeBy(panel.id) : null;
      if ((!node && !edge) || node && visual(node) === 'object' || edge && (visual(by(edge.from)) === 'object' || visual(by(edge.to)) === 'object')) { closePanel(key); continue; }
      positionPanel(panel);
      if (edge) {
        const a = by(edge.from), b = by(edge.to), masked = visual(a) !== 'full' || visual(b) !== 'full';
        panel.element.querySelector('[data-heading]').textContent = label(a) + ' ↔ ' + label(b);
        setField(panel, 'edgeLabel', masked ? '[視覺遮蔽]' : edge.label || '', masked);
        const appearance = style(edge); setField(panel, 'edgeColor', appearance.color); setField(panel, 'edgeWidth', appearance.width); setField(panel, 'edgeStyle', appearance.lineStyle); continue;
      }
      const masked = visual(node) !== 'full', size = baseSize(node);
      panel.element.querySelector('[data-heading]').textContent = label(node);
      setField(panel, 'title', masked ? '[視覺遮蔽]' : node.title || '', masked); setField(panel, 'note', masked ? '[視覺遮蔽]' : node.note || '', masked);
      panel.element.querySelector('[data-action="reveal"]').hidden = !masked;
      for (const [name, value] of Object.entries({shape: node.shape, background: node.background || '#17171b', textColor: node.textColor || '#eeeef1', width: Math.round(size.w), height: Math.round(size.h), opacity: Math.round((node.opacity ?? 1) * 100), aiVisibility: node.aiVisibility || 'full', visualVisibility: node.visualVisibility || 'full'})) setField(panel, name, value);
      panel.element.querySelector('[data-opacity]').textContent = Math.round((node.opacity ?? 1) * 100) + '%';
      const related = panel.element.querySelector('[data-related]'); related.replaceChildren();
      for (const relation of graph.edges.filter(edge => edge.from === node.id || edge.to === node.id)) {
        const other = by(relation.from === node.id ? relation.to : relation.from); if (visual(other) === 'object') continue;
        const button = document.createElement('button'); button.textContent = label(other); button.type = 'button'; button.addEventListener('click', () => { openPanel('edge', relation.id); draw(); save(); }); related.append(button);
      }
    }
  }
  function editPanel(panel, event) {
    if (panels.get(panel.kind + ':' + panel.id) !== panel) return;
    const field = event.target.closest('[data-field]'); if (!field || field.disabled) return;
    const name = field.dataset.field;
    if (event.type === 'input' && ['shape', 'aiVisibility', 'visualVisibility', 'width', 'height', 'edgeWidth'].includes(name)) return;
    if (panel.kind === 'edge') {
      const edge = edgeBy(panel.id); if (!edge) return;
      if (name === 'edgeLabel') edge.label = field.value;
      if (name === 'edgeColor') edge.color = field.value;
      if (name === 'edgeStyle') edge.lineStyle = field.value === 'dashed' ? 'dashed' : 'solid';
      if (name === 'edgeWidth') { const value = Number(field.value); if (!Number.isFinite(value)) return; edge.width = Math.max(.5, Math.min(12, value)); }
      draw(); save(); return;
    }
    const node = by(panel.id); if (!node) return;
    if (name === 'width' || name === 'height') { const value = Number(field.value); if (!Number.isFinite(value)) return; node[name] = Math.round(Math.max(name === 'width' ? 70 : 50, Math.min(name === 'width' ? 600 : 500, value))); if (node.shape === 'circle') node.width = node.height = node[name]; }
    else if (name === 'opacity') node.opacity = Number(field.value) / 100;
    else if (name === 'shape') { node.shape = field.value; delete node.width; delete node.height; }
    else { node[name] = field.value; if (name === 'visualVisibility') revealed.delete(node.id); }
    draw(); save();
  }
  function panelAction(panel, event) {
    const action = event.target.closest('[data-action]')?.dataset.action; if (!action) return;
    if (action === 'close') closePanel(panel.kind + ':' + panel.id);
    const node = panel.kind === 'node' ? by(panel.id) : null;
    if (action === 'reveal' && node) revealed.add(node.id);
    if (action === 'delete' && node) deleteNode(node.id);
    if (action === 'edge-delete') removeEdge(graph, panel.id);
    draw(); save();
  }
  function select(id) {
    selected = id; openPanel('node', id); draw(); save();
  }
  function create(point) {
    const node = {id: crypto.randomUUID(), title: '新想法', note: '', shape: 'ellipse', x: point.x, y: point.y - 50};
    graph.nodes.push(node); selected = node.id; const panel = openPanel('node', node.id); draw(); save();
    const field = panel?.element.querySelector('[data-field="title"]'); field?.focus(); field?.select();
  }
  function deleteNode(id) { removeNode(graph, id); if (selected === id) selected = null; }
  function dismissMenu() { menu.hidden = true; menuPoint = null; }
  canvas.addEventListener('contextmenu', event => {
    if (event.target.closest('.object-panel')) return;
    event.preventDefault(); if (event.target.closest('.zoom')) return;
    const bounds = canvas.getBoundingClientRect(), x = event.clientX - bounds.left, y = event.clientY - bounds.top;
    const nodeId = event.target.closest('.node')?.dataset.id;
    menuPoint = {x: (x - view.x) / view.z, y: (y - view.y) / view.z, nodeId};
    menu.querySelector('[data-menu="create"]').hidden = Boolean(nodeId); menu.querySelector('[data-menu="delete"]').hidden = !nodeId; menu.hidden = false;
    menu.style.left = Math.max(6, Math.min(bounds.width - menu.offsetWidth - 6, x)) + 'px'; menu.style.top = Math.max(6, Math.min(bounds.height - menu.offsetHeight - 6, y)) + 'px';
  });
  menu.addEventListener('click', event => { const action = event.target.closest('[data-menu]')?.dataset.menu, point = menuPoint; if (!action) return; dismissMenu(); if (action === 'create' && point) create(point); if (action === 'delete' && point?.nodeId) { deleteNode(point.nodeId); draw(); save(); } });
  canvas.addEventListener('pointerdown', event => {
    if (event.target.closest('#context-menu,.zoom') || event.button !== 0 && event.button !== 1) return;
    dismissMenu();
    if (event.button === 0 && event.target.closest('.object-panel')) return;
    event.preventDefault(); gesture = null;
    const node = event.target.closest('.node'), resize = event.target.closest('[data-resize]'), port = event.target.closest('[data-port]'), hit = event.target.closest('.connection-hit');
    if (event.button === 1) { gesture = {id: event.pointerId, type: 'pan', sx: event.clientX, sy: event.clientY, x: view.x, y: view.y, moved: false}; canvas.classList.add('panning'); }
    else if (port && node) { const bounds = canvas.getBoundingClientRect(); gesture = {id: event.pointerId, type: 'link', node: node.dataset.id, port: port.dataset.port, point: {x: (event.clientX - bounds.left - view.x) / view.z, y: (event.clientY - bounds.top - view.y) / view.z}, sx: event.clientX, sy: event.clientY, moved: false}; draw(); }
    else if (hit) gesture = {id: event.pointerId, type: 'edge', edge: hit.dataset.edgeId, sx: event.clientX, sy: event.clientY, moved: false};
    else if (resize) { const item = by(resize.dataset.resize), size = baseSize(item); gesture = {id: event.pointerId, type: 'resize', node: item.id, sx: event.clientX, sy: event.clientY, w: size.w, h: size.h, moved: false}; }
    else if (node) { const item = by(node.dataset.id); gesture = {id: event.pointerId, type: 'node', node: item.id, sx: event.clientX, sy: event.clientY, x: item.x, y: item.y, moved: false}; }
    else { selected = null; draw(); return; }
    canvas.setPointerCapture(event.pointerId);
  });
  window.addEventListener('pointermove', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.sx, dy = event.clientY - gesture.sy; if (Math.hypot(dx, dy) > 3) gesture.moved = true; if (!gesture.moved) return;
    if (gesture.type === 'edge') return;
    if (gesture.type === 'link') { const bounds = canvas.getBoundingClientRect(); gesture.point = {x: (event.clientX - bounds.left - view.x) / view.z, y: (event.clientY - bounds.top - view.y) / view.z}; gesture.target = linkTarget(event); }
    else if (gesture.type === 'pan') { view.x = gesture.x + dx; view.y = gesture.y + dy; }
    else if (gesture.type === 'panel') { const panel = panels.get(gesture.key); if (!panel) return; panel.x = gesture.x + dx / view.z; panel.y = gesture.y + dy / view.z; }
    else if (gesture.type === 'resize') { const node = by(gesture.node); node.width = Math.round(Math.max(70, Math.min(600, gesture.w + dx / view.z))); node.height = Math.round(Math.max(50, Math.min(500, gesture.h + dy / view.z))); if (node.shape === 'circle') node.width = node.height = Math.max(node.width, node.height); }
    else { const node = by(gesture.node), panel = panels.get('node:' + node.id), nx = gesture.x + dx / view.z, ny = gesture.y + dy / view.z; if (panel) { panel.x += nx - node.x; panel.y += ny - node.y; } node.x = nx; node.y = ny; }
    draw();
  });
  function finish(event) {
    if (!gesture || gesture.id !== event.pointerId) return;
    const previous = gesture; gesture = null; canvas.classList.remove('panning');
    if (previous.type === 'link') {
      const target = linkTarget(event);
      if (event.type === 'pointerup' && previous.moved && target && target !== previous.node && visual(by(target)) !== 'object' && !graph.edges.some(edge => edge.from === previous.node && edge.to === target || edge.to === previous.node && edge.from === target)) graph.edges.push({id: crypto.randomUUID(), from: previous.node, to: target, label: '', color: '#64768d', width: 1.5, lineStyle: 'solid'});
      draw(); save(); return;
    }
    if (previous.moved) save(); else if (previous.type === 'node' && event.type === 'pointerup') select(previous.node);
    else if (previous.type === 'edge' && event.type === 'pointerup') { openPanel('edge', previous.edge); draw(); save(); }
  }
  window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish);
  window.addEventListener('blur', () => { dismissMenu(); if (gesture) { gesture = null; canvas.classList.remove('panning'); draw(); save(); } });
  canvas.addEventListener('auxclick', event => { if (event.button === 1) event.preventDefault(); });
  canvas.addEventListener('wheel', event => { if (event.target.closest('.object-panel,#context-menu')) return; event.preventDefault(); dismissMenu(); const bounds = canvas.getBoundingClientRect(); zoomAt(event.clientX - bounds.left, event.clientY - bounds.top, Math.exp(-event.deltaY * .001)); save(); }, {passive: false});
  $('#ai-mode').addEventListener('change', event => { settings.aiMode = event.target.value; save(); });
  $('#visual-mode').addEventListener('change', event => { settings.visualMode = event.target.value; revealed.clear(); draw(); save(); });
  document.addEventListener('pointerdown', event => { if (!canvas.contains(event.target)) dismissMenu(); });
  document.addEventListener('click', event => { if (event.target.closest('.object-panel')) return; const action = event.target.closest('[data-action]')?.dataset.action; if (action === 'minus' || action === 'plus') { const bounds = canvas.getBoundingClientRect(); zoomAt(bounds.width / 2, bounds.height / 2, action === 'plus' ? 1.2 : 1 / 1.2); save(); } });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') { dismissMenu(); if (gesture?.type === 'link') gesture = null; selected = null; revealed.clear(); draw(); return; }
    if (event.target.closest('input,textarea,select') || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.toLowerCase() === 'f') { overview(); save(); }
  });
  window.addEventListener('beforeunload', () => { if (ready) { clearTimeout(saveTimer); window.mapStore.saveNow(payload()); } });
  try {
    const state = await window.mapStore.load(); graph = state.graph;
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('地圖格式無效');
    for (const node of graph.nodes) if (!['circle', 'ellipse', 'diamond', 'rounded', 'rectangle'].includes(node.shape)) node.shape = 'ellipse';
    settings = {...settings, ...state.settings}; $('#ai-mode').value = settings.aiMode; $('#visual-mode').value = settings.visualMode;
    if (state.view && ['x', 'y', 'z'].every(key => Number.isFinite(state.view[key])) && state.view.z > 0) { view = state.view; draw(); } else overview();
    for (const panel of state.panels || []) if (['node', 'edge'].includes(panel.kind) && Number.isFinite(panel.x) && Number.isFinite(panel.y)) openPanel(panel.kind, panel.id, panel);
    ready = true; $('#save-status').textContent = '本機加密儲存 · AI 版本已產生'; new ResizeObserver(() => draw()).observe(canvas);
  } catch (error) { $('#save-status').textContent = '載入失敗：' + error.message; canvas.style.pointerEvents = 'none'; }
})();
