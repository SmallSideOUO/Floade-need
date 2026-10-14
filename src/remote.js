const api = window.floadeRemote
const $ = id => document.getElementById(id)
const english = new URLSearchParams(location.search).get('lang') === 'en'
const text = (zh, en) => english ? en : zh
let savedDevices = []
let connecting = false
if (english) { document.documentElement.lang = 'en'; for (const el of document.querySelectorAll('[data-en]')) el.textContent = el.dataset.en }
const toggles = { acceptConnections: ['允許遠端連線','Allow incoming connections'], keyboard: ['允許鍵盤與滑鼠','Allow keyboard and mouse'], clipboard: ['分享剪貼簿','Share clipboard'], fileTransfer: ['允許檔案傳輸','Allow file transfer'], gpu: ['GPU 解碼與顯示','GPU decoding and presentation'], hardwareCodec: ['硬體編解碼','Hardware encoding and decoding'], forceRelay: ['強制中繼連線','Force relay connection'], tcpPunch: ['TCP 直連','TCP direct connection'], udpPunch: ['UDP 直連','UDP direct connection'], webrtc: ['WebRTC 直連','WebRTC direct connection'] }
for (const [key, label] of Object.entries(toggles)) {
  const row = document.createElement('label'); row.className = 'toggle'
  const input = document.createElement('input'); input.type = 'checkbox'; input.id = key
  const caption = document.createElement('span'); caption.textContent = text(...label)
  row.append(input, caption); $('toggles').append(row)
}
function message(value, error = false) { $('message').textContent = value; $('message').classList.toggle('error', error) }
async function request(method, params) { const result = await api.request(method, params); if (!result.ok) throw new Error(result.error.message); return result.result }
async function action(fn) { try { await fn() } catch (error) { message(error.message, true) } }
function view(name) { $('connect-view').hidden = name !== 'connect'; $('settings-view').hidden = name !== 'settings'; for (const button of document.querySelectorAll('[data-view]')) button.classList.toggle('selected', button.dataset.view === name) }
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => view(button.dataset.view))
api.onView(view); view(new URLSearchParams(location.search).get('view') || 'connect')
$('close').addEventListener('click', () => api.close())
$('legal').addEventListener('click', () => api.legal())
async function refreshSettings() {
  const result = await request('remote.settings.get')
  for (const [key, value] of Object.entries(result.settings)) { const el = $(key); if (el) { if (el.type === 'checkbox') el.checked = value; else el.value = value } }
  const s = result.settings
  $('network-profile').textContent = s.forceRelay ? text('目前設定：強制中繼','Current preference: force relay')
    : !s.tcpPunch && s.udpPunch && s.webrtc ? text('目前設定：手機網路 P2P（UDP／WebRTC）','Current preference: mobile network P2P (UDP / WebRTC)')
    : text('目前設定：自訂／自動直連','Current preference: custom / automatic direct connection')
  savedDevices = result.devices
  for (const [container, favorites] of [[$('favorites'), true], [$('devices'), false]]) {
    container.replaceChildren()
    const devices = result.devices.filter(device => device.favorite === favorites)
    if (!devices.length) container.textContent = favorites ? text('加入家裡電腦，之後從這裡一鍵連線。','Add your home computer for one-click access.') : text('尚無其他最近裝置。','No other recent devices.')
    for (const device of devices) {
      const row = document.createElement('div'); row.className = 'device'
      row.dataset.deviceId = device.deviceId
      const name = document.createElement('div'); name.className = 'name'; name.textContent = device.alias || device.deviceId
      const detail = document.createElement('small'); detail.textContent = device.deviceId + (device.hasPassword ? text(' · 已記住密碼',' · Password saved') : ''); name.append(detail)
      if (!device.hasPassword) detail.textContent += text(' · 連線時需密碼',' · Password needed on connection')
      const connect = document.createElement('button'); connect.textContent = text('連線','Connect'); connect.dataset.action = 'connect'; connect.addEventListener('click', () => void action(() => connectSaved(device)))
      const files = document.createElement('button'); files.textContent = text('檔案','Files'); files.dataset.action = 'files'; files.addEventListener('click', () => void action(() => connectSaved(device, 'files')))
      const edit = document.createElement('button'); edit.textContent = favorites ? text('編輯','Edit') : text('加入常用','Add favorite'); edit.dataset.action = 'edit'; edit.addEventListener('click', () => editDevice(device))
      const forget = document.createElement('button'); forget.textContent = text('移除','Forget'); forget.addEventListener('click', () => void action(async () => { await request('remote.devices.forget', { deviceId: device.deviceId }); await refreshSettings() }))
      row.append(name, connect, files, edit, forget); container.append(row)
    }
  }
}
function editDevice(device) {
  $('peer-id').value = device?.deviceId || ''; $('peer-alias').value = device?.alias || ''; $('peer-password').value = ''
  $('remember').checked = true
  $('device-form-title').textContent = device ? text('編輯常用裝置','Edit favorite device') : text('連線／新增裝置','Connect / add a device')
  $('peer-password').placeholder = device?.hasPassword ? text('留白保留已儲存密碼','Leave blank to keep saved password') : ''
  $('device-form-card').scrollIntoView({ block: 'center', behavior: 'smooth' }); $('peer-id').focus()
}
$('add-device').addEventListener('click', () => editDevice())
$('host-setup').addEventListener('click', () => { view('settings'); $('access-form').scrollIntoView({ block: 'center', behavior: 'smooth' }) })
$('save-device').addEventListener('click', () => void action(async () => {
  if (!$('connect-form').reportValidity()) return
  await request('remote.devices.save', { deviceId: $('peer-id').value.replace(/\s/g, ''), alias: $('peer-alias').value,
    password: $('peer-password').value || undefined, remember: $('remember').checked, favorite: true })
  $('peer-password').value = ''; await refreshSettings()
  message(text('已儲存常用裝置。連線時會使用已記住的密碼；權限由對方電腦決定。','Favorite saved. Connections use the saved password; permissions are set by the receiving computer.'))
}))
async function connectSaved(device, mode = 'desktop') {
  return connectPeer(mode, { deviceId: device.deviceId })
}
async function refreshStatus() {
  const result = await request('remote.status')
  $('device-id').textContent = result.deviceId || '—'
  $('engine-status').textContent = result.running ? (result.connection?.status_num > 0 ? text('可接受連線','Ready for connections') : text('引擎已啟動，正在連線至 ID 伺服器','Engine running; contacting ID server')) : text('遠端引擎尚未啟動','Remote engine stopped')
  if (!result.windows?.length) { $('connection-route').textContent = text('尚無作用中的對外連線。','No active outgoing connection.'); return }
  const metrics = await request('remote.metrics')
  const samples = (metrics.samples || []).filter(sample => sample.fresh).sort((a, b) => b.sample_unix_ms - a.sample_unix_ms)
  $('connection-route').textContent = samples.length ? samples.map(sample => {
    const fps = Object.values(sample.presented_fps || {}).filter(Number.isFinite)
    return (sample.direct === true ? 'P2P' : text('中繼','Relay')) + (fps.length ? ` · ${fps.join(' / ')} FPS` : '')
  }).join(' · ') : text('連線中，等待畫面資料…','Connecting; waiting for video data…')
}
async function setNetworkProfile(tcpPunch) {
  await request('remote.settings.update', { settings: { forceRelay: false, tcpPunch, udpPunch: true, webrtc: true } })
  await refreshSettings()
  message(text('連線路徑已儲存，請重新連線以套用。','Connection preference saved; reconnect to apply.'))
}
$('mobile-p2p').addEventListener('click', () => void action(() => setNetworkProfile(false)))
$('automatic-direct').addEventListener('click', () => void action(() => setNetworkProfile(true)))
async function refreshAccess() {
  const policy = await request('remote.access.get')
  $('access-status').textContent = policy.enabled
    ? (policy.effective ? text('已啟用完整存取清單（仍需密碼）。','Full-access allowlist enabled; password required.') : text('清單與原生設定不一致，請重新授權。','Native settings differ; grant access again.'))
    : text('使用一般遠端權限設定。','Using regular remote permissions.')
  $('access-devices').replaceChildren()
  for (const device of policy.devices) {
    const row = document.createElement('div'); row.className = 'device'
    const name = document.createElement('span'); name.className = 'name'; name.textContent = `${device.alias || device.deviceId} · ${device.deviceId}`
    const revoke = document.createElement('button'); revoke.textContent = text('撤銷','Revoke')
    revoke.addEventListener('click', () => void action(async () => { await request('remote.access.revoke', { deviceId: device.deviceId }); await refreshAccess() }))
    row.append(name, revoke); $('access-devices').append(row)
  }
}
async function refreshService() {
  const status = await request('remote.service.status')
  $('service-status').textContent = status.ready ? text('LocalSystem 服務已啟動，版本符合目前 Floade。','LocalSystem service running and matches this Floade version.')
    : status.installing ? text('等待 Windows 同意或服務安裝完成。','Waiting for Windows consent or installation.')
    : status.installed ? text('服務尚未就緒或版本不同，請安裝／更新。','Service stopped or version differs; install/update it.')
    : text('尚未安裝系統服務。','System service is not installed.')
}
$('access-form').addEventListener('submit', event => { event.preventDefault(); void action(async () => { await request('remote.access.grant', { deviceId: $('access-id').value.replace(/\s/g, ''), alias: $('access-alias').value }); await refreshAccess(); message(text('完整存取已設定，新連線仍需密碼。','Full access granted; new connections still require a password.')) }) })
$('access-disable').addEventListener('click', () => void action(async () => { await request('remote.access.disable'); await refreshAccess() }))
$('service-refresh').addEventListener('click', () => void action(refreshService))
$('service-install').addEventListener('click', () => void action(async () => { await request('remote.service.install'); message(text('請同意 Windows UAC 提示，再檢查服務狀態。','Approve the Windows UAC request, then check service status.')); await refreshService() }))
async function connectPeer(mode = 'desktop', saved) {
  if (connecting) return
  connecting = true
  const buttons = document.querySelectorAll('#connect-form button, [data-action="connect"], [data-action="files"]')
  for (const button of buttons) button.disabled = true
  try {
    const id = $('peer-id').value.replace(/\s/g, '')
    const result = await request('remote.connect', { ...(saved || { deviceId: id, password: $('peer-password').value || undefined, remember: $('remember').checked, favorite: $('remember').checked || savedDevices.find(d => d.deviceId === id)?.favorite || false, alias: $('peer-alias').value }), mode })
    $('peer-password').value = ''; message(text('正在連線，請在遠端視窗查看登入結果。','Connecting; authentication appears in the remote window.')); await refreshSettings(); return result
  } finally { connecting = false; for (const button of buttons) button.disabled = false }
}
$('connect-form').addEventListener('submit', event => { event.preventDefault(); void action(() => connectPeer()) })
$('files').addEventListener('click', () => void action(() => connectPeer('files')))
$('copy-id').addEventListener('click', () => void action(async () => { await navigator.clipboard.writeText($('device-id').textContent); message(text('代碼已複製。','Code copied.')) }))
$('temporary').addEventListener('click', () => void action(async () => { const result = await request('remote.password.temporary'); $('temporary-password').textContent = result.password; setTimeout(() => { $('temporary-password').textContent = '' }, 30000) }))
$('settings-form').addEventListener('submit', event => { event.preventDefault(); void action(async () => {
  const settings = {}; for (const key of Object.keys(toggles)) settings[key] = $(key).checked
  for (const key of ['fps','quality']) settings[key] = Number($(key).value)
  for (const key of ['codec','server','relayServer','serverKey','approval','verification']) settings[key] = $(key).value.trim()
  await request('remote.settings.update', { settings }); await refreshSettings(); message(text('設定已儲存；畫面設定套用至新連線。','Saved; display preferences apply to new connections.'))
}) })
$('password-form').addEventListener('submit', event => { event.preventDefault(); void action(async () => { await request('remote.password.set', { password: $('host-password').value }); $('host-password').value = ''; message(text('固定密碼已更新。','Permanent password updated.')) }) })
$('advanced').addEventListener('click', () => void action(() => request('remote.advanced.open')))
void action(async () => { await refreshSettings(); await request('remote.start'); await refreshStatus(); await refreshAccess(); await refreshService(); setInterval(() => void action(refreshStatus), 5000) })
