'use strict';
const {aiMap} = require('./privacy.cjs');
const {canParent} = require('./hierarchy.cjs');

// A local, one-time plan updates only content the user currently permits AI to read.
// This runs inside the app; callers never receive decrypted private storage.
function applyOrganization(state, plan) {
  if (!plan?.revision || !Array.isArray(plan.nodes)) throw new Error('整理資料格式無效');
  if (state.graph.organizationRevision === plan.revision) return false;
  const readable = new Set(aiMap(state).graph.nodes.filter(node => !node.textWithheld).map(node => node.id));
  for (const patch of plan.nodes) {
    if (!readable.has(patch.id)) continue;
    const node = state.graph.nodes.find(item => item.id === patch.id);
    for (const key of ['title', 'note', 'mark']) if (typeof patch[key] === 'string') node[key] = patch[key];
    if (Object.hasOwn(patch, 'parentId') && (!patch.parentId || readable.has(patch.parentId)) &&
      canParent(state.graph.nodes, node.id, patch.parentId)) node.parentId = patch.parentId || null;
  }
  state.graph.organizationRevision = plan.revision;
  return true;
}
module.exports = {applyOrganization};
