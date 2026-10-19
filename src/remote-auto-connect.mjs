const profiles = [
  ['udp-webrtc', false, true, true], ['all-direct', true, true, true],
  ['tcp', true, false, false], ['udp', false, true, false],
  ['webrtc', false, false, true], ['tcp-udp', true, true, false],
  ['tcp-webrtc', true, false, true]
].map(([id, tcpPunch, udpPunch, webrtc]) => ({ id, tcpPunch, udpPunch, webrtc }))

export function createAutoConnector({ call, settings, remember, recover }) {
  let job
  let timer
  let busy = false
  const snapshot = () => job ? {
    deviceId: job.deviceId, windowId: job.windowId, state: job.state,
    profile: job.profile?.id, attempt: profiles.length - job.remaining.length, total: profiles.length,
    attempts: job.attempts.map(attempt => ({ ...attempt })), reason: job.reason, nextRetryAt: job.nextRetryAt
  } : null
  const terminal = state => ['cancelled', 'exhausted', 'user-action', 'engine-error'].includes(state)
  function cancel() {
    clearTimeout(timer)
    if (job) { job.state = 'cancelled'; job.password = undefined }
  }
  function schedule(current) {
    if (job !== current || terminal(current.state)) return
    timer = setTimeout(() => void poll(current), 1500)
    timer.unref?.()
  }
  function retry(current, state, reason) {
    current.failures = (current.failures || 0) + 1
    current.state = state
    current.reason = reason
    current.stableAt = undefined
    current.nextRetryAt = Date.now() + [15000, 30000, 60000][Math.min(current.failures - 1, 2)]
  }
  async function prepare(current) {
    if (!recover) return
    const native = await recover()
    if (job !== current || terminal(current.state)) return
    if (!native.autoConnectStatus) throw Object.assign(Error('Update the native engine and Windows service for automatic connections.'), { apiCode: 'REMOTE_ENGINE_UPDATE_REQUIRED' })
    if (native.windows?.length && !native.windows.includes(current.windowId)) throw Object.assign(Error('Close existing remote windows before starting automatic connections.'), { apiCode: 'REMOTE_BUSY' })
    return native
  }
  async function attempt(current) {
    const profile = current.remaining.shift()
    if (!profile) {
      retry(current, 'waiting', 'NO_DIRECT_ROUTE')
      return
    }
    current.profile = profile
    current.state = 'connecting'; current.reason = undefined; current.nextRetryAt = undefined
    current.startedAt = Date.now(); current.stableAt = undefined; current.authAt = undefined
    current.attempts.push({ profile: profile.id, state: 'connecting' })
    current.attempts = current.attempts.slice(-21)
    // Transport switches are engine-local and are read at session creation.
    const options = { ...settings(), ...profile, forceRelay: false, relayServer: '' }
    delete options.id
    await call('apply', { settings: options })
    if (job !== current || terminal(current.state)) return
    const result = await call('connect', { deviceId: current.deviceId, password: current.password, mode: current.mode, settings: options })
    current.windowId = result.windowId
    if (job !== current || terminal(current.state)) {
      if (Number.isInteger(result.windowId)) await call('disconnect', { windowId: result.windowId })
      return
    }
    if (!Number.isInteger(result.windowId) || result.windowId <= 0) throw Error('ENGINE_SESSION_UNAVAILABLE')
    return result
  }
  async function poll(current) {
    if (job !== current || terminal(current.state)) return
    busy = true
    try {
      if (current.state === 'recovering-engine') {
        if (Date.now() < current.nextRetryAt) return
        const native = await prepare(current)
        if (job !== current || terminal(current.state)) return
        if (!native?.windows?.includes(current.windowId)) {
          if (current.windowId && current.enginePid && native?.pid === current.enginePid) { cancel(); return }
          current.enginePid = native?.pid
          current.windowId = undefined
          if (current.profile) current.remaining = [current.profile, ...current.remaining.filter(profile => profile.id !== current.profile.id)]
          await attempt(current)
          return
        }
        current.enginePid = native?.pid
        current.state = 'connecting'
      }
      if (current.state === 'waiting') {
        if (current.windowId) {
          const status = await call('sessionStatus', { windowId: current.windowId, deviceId: current.deviceId })
          if (job !== current || terminal(current.state)) return
          if (status.state === 'closed') { cancel(); return }
          if (['connected', 'authenticating', 'user-action'].includes(status.state)) { current.state = 'connecting'; current.nextRetryAt = undefined; current.startedAt = Date.now() }
        }
        if (current.state === 'waiting') {
        if (Date.now() < current.nextRetryAt) return
        if (current.windowId) await call('disconnect', { windowId: current.windowId })
        if (job !== current || terminal(current.state)) return
        current.windowId = undefined
        current.remaining = [current.profile || profiles[0], ...profiles.filter(profile => profile.id !== (current.profile || profiles[0]).id)]
        await attempt(current)
        return
        }
      }
      const observed = await call('sessionStatus', { windowId: current.windowId, deviceId: current.deviceId })
      if (job !== current || terminal(current.state)) return
      if (observed.state === 'closed') { cancel(); return }
      if (observed.state === 'network-unavailable') { retry(current, 'waiting', 'NETWORK_UNAVAILABLE'); return }
      if (observed.state === 'user-action') {
        current.state = 'user-action'; current.reason = 'CHECK_AUTHENTICATION_OR_PERMISSION'; current.password = undefined
        return
      }
      const ready = observed.state === 'connected' && observed.direct === true && (current.mode === 'files' || observed.video === true)
      if (ready) {
        current.stableAt ??= Date.now()
        if (Date.now() - current.stableAt >= 15000 && current.state !== 'connected') {
          await remember(current.deviceId, current.profile.id)
          current.state = 'connected'
          current.failures = 0
          current.attempts.at(-1).state = 'connected'
          // Each later outage gets one bounded sweep, excluding the route that just failed.
          current.remaining = profiles.filter(profile => profile.id !== current.profile.id)
        }
      } else {
        current.stableAt = undefined
        if (observed.state === 'authenticating') {
          // A password/approval dialog belongs to the user, never to network retries.
          current.authAt ??= Date.now()
          if (Date.now() - current.authAt >= 45000) {
            current.state = 'user-action'; current.reason = 'CHECK_AUTHENTICATION_OR_PERMISSION'; current.password = undefined
            return
          }
        } else current.authAt = undefined
        const failed = observed.state === 'network-error' || observed.direct === false ||
          (observed.state !== 'authenticating' && Date.now() - current.startedAt >= 45000 && current.state !== 'connected')
        if (failed) {
          current.attempts.at(-1).state = 'failed'
          current.attempts.at(-1).reason = observed.direct === false ? 'DIRECT_REQUIRED' : 'NETWORK_OR_TIMEOUT'
          await call('disconnect', { windowId: current.windowId })
          current.windowId = undefined
          if (job !== current || terminal(current.state)) return
          current.authAt = undefined
          await attempt(current)
        }
      }
    } catch (error) {
      if (job === current && !terminal(current.state)) {
        if (recover && !['REMOTE_ENGINE_UPDATE_REQUIRED', 'REMOTE_BUSY'].includes(error.apiCode)) retry(current, 'recovering-engine', 'REMOTE_ENGINE_UNAVAILABLE')
        else { current.state = 'engine-error'; current.reason = 'REMOTE_ENGINE_UNAVAILABLE'; current.password = undefined }
      }
    } finally {
      busy = false
      schedule(current)
    }
  }
  return {
    snapshot, cancel,
    get active() { return busy || (job && !terminal(job.state)) },
    async connect({ deviceId, password, mode, preferred }) {
      if (busy || (job && !terminal(job.state))) throw Object.assign(Error('An automatic connection is already active; stop it before opening another session.'), { apiCode: 'REMOTE_BUSY' })
      busy = true
      const remaining = [...profiles].sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred))
      const current = { deviceId, password, mode, remaining, attempts: [], state: 'connecting' }
      job = current
      try {
        const native = await prepare(current)
        current.enginePid = native?.pid
        if (job !== current || terminal(current.state)) return { automatic: snapshot() }
        const result = await attempt(current)
        schedule(current)
        return { ...result, automatic: snapshot() }
      } catch (error) {
        if (recover && ['REMOTE_NOT_RUNNING', 'REMOTE_START_FAILED'].includes(error.apiCode) && job === current && !terminal(current.state)) {
          retry(current, 'recovering-engine', 'REMOTE_ENGINE_UNAVAILABLE')
          schedule(current)
          return { automatic: snapshot() }
        }
        cancel()
        throw error
      } finally { busy = false }
    }
  }
}
