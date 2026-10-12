const api = window.floadeRemote
const $ = id => document.getElementById(id)
const english = new URLSearchParams(location.search).get('lang') === 'en'
const text = (zh, en) => english ? en : zh
if (english) { document.documentElement.lang = 'en'; for (const el of document.querySelectorAll('[data-en]')) el.textContent = el.dataset.en }
const toggles = { acceptConnections: ['允許遠端連線','Allow incoming connections'], keyboard: ['允許鍵盤與滑鼠','Allow keyboard and mouse'], clipboard: ['分享剪貼簿','Share clipboard'], fileTransfer: ['允許檔案傳輸','Allow file transfer'], gpu: ['GPU 解碼與顯示','GPU decoding and presentation'], hardwareCodec: ['硬體編解碼','Hardware encoding and decoding'], forceRelay: ['強制中繼連線','Force relay connection'] }
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
  $('devices').replaceChildren()
  if (!result.devices.length) $('devices').textContent = text('尚未連線至任何裝置。','No recent devices.')
  for (const device of result.devices) {
    const row = document.createElement('div'); row.className = 'device'
    const name = document.createElement('div'); name.className = 'name'; name.textContent = device.alias || device.deviceId
    const detail = document.createElement('small'); detail.textContent = device.deviceId + (device.hasPassword ? text(' · 已記住密碼',' · Password saved') : ''); name.append(detail)
    const connect = document.createElement('button'); connect.textContent = text('連線','Connect'); connect.addEventListener('click', () => { $('peer-id').value = device.deviceId; $('peer-alias').value = device.alias; $('peer-password').value = ''; $('remember').checked = device.hasPassword; void action(() => connectPeer()) })
    const forget = document.createElement('button'); forget.textContent = text('移除','Forget'); forget.addEventListener('click', () => void action(async () => { await request('remote.devices.forget', { deviceId: device.deviceId }); await refreshSettings() }))
    row.append(name, connect, forget); $('devices').append(row)
  }
}
async function refreshStatus() {
  const result = await request('remote.status')
  $('device-id').textContent = result.deviceId || '—'
  $('engine-status').textContent = result.running ? (result.connection?.status_num > 0 ? text('可接受連線','Ready for connections') : text('引擎已啟動，正在連線至 ID 伺服器','Engine running; contacting ID server')) : text('遠端引擎尚未啟動','Remote engine stopped')
}
async function connectPeer(mode = 'desktop') {
  const button = $('connect-form').querySelector('[type=submit]'); button.disabled = true
  try {
    const result = await request('remote.connect', { deviceId: $('peer-id').value.replace(/\s/g, ''), password: $('peer-password').value || undefined, remember: $('remember').checked, alias: $('peer-alias').value, mode })
    $('peer-password').value = ''; message(text('正在連線，請在遠端視窗查看登入結果。','Connecting; authentication appears in the remote window.')); await refreshSettings(); return result
  } finally { button.disabled = false }
}
$('connect-form').addEventListener('submit', event => { event.preventDefault(); void action(() => connectPeer()) })
$('files').addEventListener('click', () => void action(() => connectPeer('files')))
$('copy-id').addEventListener('click', () => void action(async () => { await navigator.clipboard.writeText($('device-id').textContent); message(text('代碼已複製。','Code copied.')) }))
$('temporary').addEventListener('click', () => void action(async () => { const result = await request('remote.password.temporary'); $('temporary-password').textContent = result.password; setTimeout(() => { $('temporary-password').textContent = '' }, 30000) }))
$('settings-form').addEventListener('submit', event => { event.preventDefault(); void action(async () => {
  const settings = {}; for (const key of Object.keys(toggles)) settings[key] = $(key).checked
  for (const key of ['fps','quality']) settings[key] = Number($(key).value)
  for (const key of ['codec','server','relayServer','serverKey','approval','verification']) settings[key] = $(key).value.trim()
  await request('remote.settings.update', { settings }); message(text('設定已儲存；畫面設定套用至新連線。','Saved; display preferences apply to new connections.'))
}) })
$('password-form').addEventListener('submit', event => { event.preventDefault(); void action(async () => { await request('remote.password.set', { password: $('host-password').value }); $('host-password').value = ''; message(text('固定密碼已更新。','Permanent password updated.')) }) })
$('advanced').addEventListener('click', () => void action(() => request('remote.advanced.open')))
void action(async () => { await refreshSettings(); await request('remote.start'); await refreshStatus(); setInterval(() => void action(refreshStatus), 5000) })
