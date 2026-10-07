import path from 'node:path'

const samePath = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b)

// Never stash, reset, change branches, rewrite remotes or merge divergent history.
export async function pullFolderFromRepository(folderPath, repo, command, shouldContinue = () => true) {
  const git = args => command('git', args, folderPath)
  const root = (await git(['rev-parse', '--show-toplevel'])).stdout.trim()
  if (!samePath(root, folderPath)) return { status: 'wrongRoot' }
  const branch = (await git(['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout.trim()
  if (branch !== 'main') return { status: 'wrongBranch' }
  const origin = (await git(['remote', 'get-url', 'origin'])).stdout.trim()
  const allowed = [`https://github.com/${repo}`, `https://github.com/${repo}.git`, `git@github.com:${repo}.git`, `ssh://git@github.com/${repo}.git`]
  if (!allowed.some(url => url.toLowerCase() === origin.toLowerCase())) return { status: 'wrongRemote' }
  if ((await git(['status', '--porcelain', '--untracked-files=normal'])).stdout.trim()) return { status: 'localChanges' }
  const before = (await git(['rev-parse', 'HEAD'])).stdout.trim()
  await git(['fetch', '--no-tags', 'origin', 'main'])
  if (!shouldContinue()) return { status: 'busy' }
  if ((await git(['branch', '--show-current'])).stdout.trim() !== 'main') return { status: 'wrongBranch' }
  const remote = (await git(['rev-parse', 'FETCH_HEAD'])).stdout.trim()
  if (before === remote) return { status: 'current', head: before }
  try { await git(['merge-base', '--is-ancestor', before, remote]) } catch (error) {
    if (error.code === 1) {
      try { await git(['merge-base', '--is-ancestor', remote, before]); return { status: 'localAhead' } } catch (other) { if (other.code !== 1) throw other }
      return { status: 'diverged' }
    }
    throw error
  }
  // Recheck after network IO. Git also refuses checkout when it would overwrite changes.
  if ((await git(['status', '--porcelain', '--untracked-files=normal'])).stdout.trim()) return { status: 'localChanges' }
  if ((await git(['rev-parse', 'HEAD'])).stdout.trim() !== before) return { status: 'busy' }
  await git(['merge', '--ff-only', remote])
  return { status: 'updated', head: remote }
}

export function createAutoPull({ getFolders, enabled, busy, hasOpenDocument, pulling, command, changed, interval = 60000 }) {
  const states = new Map()
  let disposed = false
  let running = false
  let timer
  async function pull(folder) {
    if (disposed || !folder.repo) return { status: 'unlinked' }
    if (busy(folder.path) || pulling.has(folder.path)) return { status: 'busy' }
    if (hasOpenDocument(folder.path)) {
      const state = { status: 'openDocument' }; states.set(folder.path, state); changed(); return state
    }
    pulling.add(folder.path)
    states.set(folder.path, { status: 'checking' }); changed()
    try {
      const result = await pullFolderFromRepository(folder.path, folder.repo, command, () => !disposed && getFolders().some(candidate => candidate.path === folder.path && candidate.repo === folder.repo))
      states.set(folder.path, { ...result, checkedAt: Date.now() })
      return result
    } catch (error) {
      const result = { status: 'error', message: error.stderr?.trim() || error.message, checkedAt: Date.now() }
      states.set(folder.path, result); return result
    } finally { pulling.delete(folder.path); if (!disposed) changed() }
  }
  async function run() {
    if (disposed || running || !enabled()) return
    running = true
    try { for (const folder of [...getFolders()]) { if (disposed || !enabled()) break; if (folder.repo) await pull(folder) } } finally { running = false }
  }
  return {
    pull, run, states,
    start() { timer = setInterval(() => void run(), interval); timer.unref?.(); void run() },
    dispose() { disposed = true; clearInterval(timer) }
  }
}
