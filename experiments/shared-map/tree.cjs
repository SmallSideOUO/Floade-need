(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./hierarchy.cjs') : root.mapHierarchy);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.mapTree = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function (hierarchy) {
  'use strict';
  const {layout, canParent} = hierarchy;
  function validate(graph) {
    const nodes = new Map(graph.nodes.map(node => [node.id, node]));
    if (nodes.size !== graph.nodes.length) throw new Error('節點 id 不可重複');
    if (!nodes.size) {
      if (graph.edges.length || graph.rootId) throw new Error('空樹不能包含連線或根節點');
      return;
    }
    if (!nodes.has(graph.rootId)) throw new Error('樹狀圖必須有一個根節點');
    const incoming = new Map(), edgeIds = new Set();
    for (const edge of graph.edges) {
      if (edgeIds.has(edge.id)) throw new Error('連線 id 不可重複');
      edgeIds.add(edge.id);
      if (!nodes.has(edge.from) || !nodes.has(edge.to) || edge.from === edge.to) throw new Error('上層與子節點必須存在且不能相同');
      if (incoming.has(edge.to)) throw new Error('每個子節點只能有一個上層');
      incoming.set(edge.to, edge.from);
    }
    if (incoming.has(graph.rootId) || nodes.get(graph.rootId).parentId) throw new Error('根節點不能有上層');
    for (const node of graph.nodes) {
      if (node.id === graph.rootId) continue;
      if (!node.parentId || incoming.get(node.id) !== node.parentId) throw new Error('每個子節點必須連接到唯一上層');
      const seen = new Set(); let id = node.id;
      while (id !== graph.rootId) {
        if (seen.has(id)) throw new Error('上下關係不能形成循環');
        seen.add(id); id = nodes.get(id)?.parentId;
        if (!nodes.has(id)) throw new Error('所有節點都必須連到同一個根節點');
      }
    }
    if (graph.edges.length !== graph.nodes.length - 1) throw new Error('樹狀圖只能包含上層與子節點的連線');
  }
  function arrange(graph) {
    if (!graph.treeMode) return graph;
    validate(graph);
    const ordered = graph.nodes.map((node, index) => ({node, index})).sort((a, b) => (a.node.order ?? a.index) - (b.node.order ?? b.index)).map(item => item.node);
    const positions = new Map(layout(ordered, {primaryId: graph.rootId, gapX: 60, gapY: 110}).map(point => [point.id, point]));
    for (const node of graph.nodes) Object.assign(node, positions.get(node.id));
    return graph;
  }
  function enable(graph) {
    if (graph.treeMode) return arrange(graph);
    const nodes = new Map(graph.nodes.map(node => [node.id, node]));
    const root = nodes.get('world') || graph.nodes.find(node => !nodes.has(node.parentId)) || graph.nodes[0];
    graph.treeMode = true; graph.rootId = root?.id || null;
    if (root) root.parentId = null;
    const preferred = new Map(graph.nodes.filter(node => node.parentId && nodes.has(node.parentId) && canParent(graph.nodes,node.id,node.parentId)).map(node => [node.id,node.parentId]));
    const originalEdges = graph.edges, chosen = [], visited = new Set(), edgeIds = new Set(originalEdges.map(edge => edge.id));
    const adjacency = new Map(graph.nodes.map(node => [node.id, []]));
    for (const edge of originalEdges) if (nodes.has(edge.from) && nodes.has(edge.to) && edge.from !== edge.to) {
      adjacency.get(edge.from).push({node: nodes.get(edge.to), edge});
      adjacency.get(edge.to).push({node: nodes.get(edge.from), edge});
    }
    // Existing parent relationships are considered even if their line was missing.
    for (const node of graph.nodes) if (nodes.has(node.parentId) && node.parentId !== node.id && !adjacency.get(node.id).some(item => item.node.id === node.parentId)) {
      const parent = nodes.get(node.parentId);
      adjacency.get(parent.id).push({node, edge: null}); adjacency.get(node.id).push({node: parent, edge: null});
    }
    function attach(parent, child, edge) {
      child.parentId = parent.id;
      let id = edge?.id || 'tree:' + child.id;
      if (!edge) { while (edgeIds.has(id)) id += ':1'; edgeIds.add(id); }
      chosen.push({...edge, id, from: parent.id, to: child.id, label: edge?.label || ''});
    }
    function walk(start) {
      const queue = [start]; visited.add(start.id);
      for (let i = 0; i < queue.length; i++) {
        const parent = queue[i], candidates = adjacency.get(parent.id).slice();
        const priority = item => preferred.get(item.node.id) === parent.id ? 0 : item.edge?.from === parent.id ? 1 : 2;
        candidates.sort((a, b) => priority(a) - priority(b));
        for (const {node, edge} of candidates) if (!visited.has(node.id) && (!preferred.has(node.id) || preferred.get(node.id) === parent.id)) { visited.add(node.id); attach(parent, node, edge); queue.push(node); }
      }
    }
    if (root) {
      root.parentId = null; walk(root);
      for (const node of graph.nodes.filter(node => !preferred.has(node.id)).concat(graph.nodes)) if (!visited.has(node.id)) { attach(root, node, null); walk(node); }
    }
    // The encrypted before/after audit keeps the original graph, including cross-links.
    graph.edges = chosen; graph.layoutRevision = 'strict-tree-v1';
    return arrange(graph);
  }
  function reparent(graph, id, parentId, edgeId) {
    const node = graph.nodes.find(item => item.id === id);
    if (!node) throw new Error('找不到要修改的節點');
    if (id === graph.rootId) throw new Error('根節點不能改上層');
    if (!parentId || !graph.nodes.some(item => item.id === parentId)) throw new Error('請選擇一個上層');
    if (!canParent(graph.nodes, id, parentId)) throw new Error('不能將自己或子孫設為上層');
    if (node.parentId === parentId) return;
    const edge = graph.edges.find(item => item.to === id);
    node.parentId = parentId;
    if (edge) { edge.from = parentId; edge.label = ''; }
    else graph.edges.push({id: edgeId || 'tree:' + id, from: parentId, to: id, label: ''});
  }
  function remove(graph, id) {
    const node = graph.nodes.find(item => item.id === id); if (!node) return;
    const children = graph.nodes.filter(item => item.parentId === id);
    if (id === graph.rootId && children.length) throw new Error('根節點仍有子節點，請先處理子節點');
    for (const child of children) reparent(graph, child.id, node.parentId);
    graph.nodes = graph.nodes.filter(item => item.id !== id);
    graph.edges = graph.edges.filter(edge => edge.from !== id && edge.to !== id);
    if (id === graph.rootId) graph.rootId = null;
    if (graph.current === id) graph.current = null;
  }
  function reorder(graph, id, beforeId = null) {
    const node = graph.nodes.find(item => item.id === id);
    if (!node || id === graph.rootId) throw new Error('根節點不能調整同層順序');
    const siblings = graph.nodes.filter(item => item.parentId === node.parentId).sort((a,b) => (a.order ?? graph.nodes.indexOf(a)) - (b.order ?? graph.nodes.indexOf(b)));
    if (beforeId === id) return;
    if (beforeId !== null && !siblings.some(item => item.id === beforeId)) throw new Error('只能調整同一上層的節點順序');
    const ordered = siblings.filter(item => item.id !== id);
    ordered.splice(beforeId === null ? ordered.length : ordered.findIndex(item => item.id === beforeId), 0, node);
    ordered.forEach((item,index) => { item.order = index; });
  }
  return {enable, validate, arrange, reparent, remove, reorder};
});
