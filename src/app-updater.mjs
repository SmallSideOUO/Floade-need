// Keep the update lifecycle independent of Electron so failures and races can be tested.
export function createAppUpdater({ updater, currentVersion, enabled = () => true, changed = () => {}, ready = () => {}, interval = 6 * 60 * 60 * 1000, initialDelay = 30000 }) {
  let state = { supported: Boolean(updater), currentVersion, status: updater ? 'idle' : 'unsupported', availableVersion: null, percent: 0, lastChecked: null }
  let disposed = false
  let pending
  let initialTimer
  let repeatTimer
  const listeners = []
  const update = values => { if (!disposed) { state = { ...state, ...values }; changed({ ...state }) } }
  if (updater) {
    updater.autoDownload = true
    // Only an explicit restart installs; normal quits and Windows shutdown do not.
    updater.autoInstallOnAppQuit = false
    updater.allowPrerelease = false
    updater.allowDowngrade = false
    updater.disableWebInstaller = true
    const on = (event, callback) => { updater.on(event, callback); listeners.push([event, callback]) }
    on('checking-for-update', () => update({ status: 'checking', percent: 0 }))
    on('update-available', info => update({ status: 'downloading', availableVersion: info.version, percent: 0 }))
    on('download-progress', progress => update({ status: 'downloading', percent: Math.min(100, Math.max(0, Number(progress.percent) || 0)) }))
    on('update-not-available', () => update({ status: 'current', availableVersion: null, lastChecked: Date.now() }))
    on('update-downloaded', info => {
      const notify = state.status !== 'ready' || state.availableVersion !== info.version
      update({ status: 'ready', availableVersion: info.version, percent: 100, lastChecked: Date.now() })
      if (!disposed && notify) ready({ ...state })
    })
    on('error', () => update({ status: 'error', lastChecked: Date.now() }))
  }
  async function check() {
    if (disposed || !updater) return { ...state }
    if (pending) return pending
    if (['downloading', 'ready', 'installing'].includes(state.status)) return { ...state }
    update({ status: 'checking' })
    pending = (async () => {
      try {
        const result = await Promise.resolve().then(() => updater.checkForUpdates())
        if (result?.downloadPromise) await result.downloadPromise
      } catch { update({ status: 'error', lastChecked: Date.now() }) }
      finally { pending = undefined }
      return { ...state }
    })()
    return pending
  }
  return {
    state: () => ({ ...state }),
    check,
    start() {
      if (disposed || !updater || repeatTimer) return
      const run = () => { if (!disposed && enabled()) void check() }
      initialTimer = setTimeout(run, initialDelay)
      repeatTimer = setInterval(run, interval)
      initialTimer.unref?.(); repeatTimer.unref?.()
    },
    install() {
      if (disposed || !updater || state.status !== 'ready') return false
      update({ status: 'installing' })
      try { updater.quitAndInstall(true, true); return true }
      catch { update({ status: 'error' }); return false }
    },
    dispose() {
      disposed = true
      clearTimeout(initialTimer); clearInterval(repeatTimer)
      for (const [event, callback] of listeners) updater.removeListener(event, callback)
    }
  }
}

export async function createInstalledAppUpdater(options) {
  const { default: electronUpdater } = await import('electron-updater')
  return createAppUpdater({ ...options, updater: electronUpdater.autoUpdater })
}
