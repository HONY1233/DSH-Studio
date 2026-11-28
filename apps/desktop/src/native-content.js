const status = document.querySelector('#status')
const capabilities = document.querySelector('#capabilities')
const buttons = [...document.querySelectorAll('[data-command]')]

function renderCapabilities() {
  capabilities.textContent = JSON.stringify({
    bridge: 'dshNativeContent',
    methods: ['onReady', 'minimize', 'maximize', 'restore', 'close'],
    hasFullStudioBridge: typeof window.dsh === 'object',
    hasRuntimeBridge: typeof window.dshStudio === 'object',
    hasTerminalBridge: typeof window.ompStudioTerminal === 'object',
    hasNode: typeof window.process === 'object' || typeof window.require === 'function',
  }, null, 2)
}

renderCapabilities()

window.dshNativeContent.onReady((event) => {
  if (event.error) {
    status.dataset.error = 'true'
    status.textContent = `窗口票据验证失败：${event.error}`
    return
  }
  status.textContent = `已验证原生窗口 ${event.windowId}`
  for (const button of buttons) {
    button.disabled = false
    button.addEventListener('click', async () => {
      button.disabled = true
      try {
        await window.dshNativeContent[button.dataset.command]()
      } catch (error) {
        status.dataset.error = 'true'
        status.textContent = error.message
        button.disabled = false
      }
    })
  }
})
