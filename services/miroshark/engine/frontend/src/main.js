import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { i18nPlugin } from './i18n'

const app = createApp(App)

app.use(router)
app.use(i18nPlugin)

// Wait for the first route (Home is eager, lazy routes resolve their chunk)
// before tearing down the boot splash, so we never flash an empty frame.
const dismissBootLoader = () => {
  const boot = document.getElementById('boot-loader')
  if (!boot) return
  boot.classList.add('boot-done')
  setTimeout(() => boot.remove(), 600)
}

app.mount('#app')
router.isReady().then(dismissBootLoader)
// Safety net: never let the splash linger if the router stalls.
setTimeout(dismissBootLoader, 4000)

// Register service worker for browser push notifications
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((err) => {
    console.warn('[MiroShark] Service worker registration failed:', err)
  })
}
