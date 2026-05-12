import { ensureRoot, writeFile } from "/scripts/vfs.js"
import { settings } from "/scripts/utility.js"

export class Ozone {
  constructor(config = {}) {
    this.config = {
      defaultApps: ["files", "settings", "text", "media", "menu"],
      sourceURL: "/defaultSource",
      sharedAssets: [
        "google_sans.ttf",
        "icons.woff2",
        "ozone_gui.css",
        "ozone_std_util.js"
      ],
      swKey: "osware_sw_version",
      dbName: "ozoneVFS",
      versionURL: "/versions.json",
      launcher: null,
      ...config
    }
  }

  async fetchJSON(url) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed fetch: ${url}`)
    return res.json()
  }

  async packageAppFromURL(appURL) {
    const manifestURL = `${appURL}/manifest.json`
    const res = await fetch(manifestURL)
    if (!res.ok) return

    const data = await res.json()

    const base = `/system/apps/${data.author}/${data.name}`
    const sources = data.sources || []

    await settings.set(`${data.author}/${data.name}`, base, "TagPathIndex.json")

    if (data.capabilities) {
      const FileBindings = (await settings.get("FileBindings")) ?? {}
      const key = `${data.author}/${data.name}`

      for (const ext of data.capabilities) {
        FileBindings[ext] = [
          ...new Set([...(FileBindings[ext] ?? []), key])
        ]
      }

      await settings.set("FileBindings", FileBindings)
    }

    await Promise.all(
      sources.map(async file => {
        const fileURL = `${appURL}/${file}`
        const r = await fetch(fileURL)
        if (!r.ok) return
        const blob = await r.blob()
        await writeFile(`${base}/${file}`, blob)
      })
    )

    if (data.landing) {
      const landingURL = `${appURL}/${data.landing}`
      const lr = await fetch(landingURL)
      if (lr.ok) {
        const blob = await lr.blob()
        await writeFile(`${base}/index.html`, blob)
      }
    }

    const manifestBlob = new Blob(
      [JSON.stringify(data, null, 2)],
      { type: "application/json" }
    )

    await writeFile(`${base}/manifest.json`, manifestBlob)
  }

  async initializeOzone() {
    for (const app of this.config.defaultApps) {
      const url = `${this.config.sourceURL}/${app}`
      await this.packageAppFromURL(url)
    }

    const shared = this.config.sharedAssets

    for (const file of shared) {
      const url = `${this.config.sourceURL}/sharedAssets/${file}`
      const res = await fetch(url)
      if (!res.ok) continue
      const blob = await res.blob()
      await writeFile(`/system/sharedAssets/${file}`, blob)
    }
    return true;
  }

  async ensureServiceWorker() {
    if (!("serviceWorker" in navigator)) return

    const versions = await this.fetchJSON(this.config.versionURL)
    const v = versions.osware

    const launcher = encodeURIComponent(
      JSON.stringify(this.config.launcher ?? null)
    )

    const swUrl =
      `/sw.js?v=${v}&launcher=${launcher}`

    const existing = await navigator.serviceWorker.getRegistration()

    if (!existing) {
      await navigator.serviceWorker.register(swUrl, {
        type: "module"
      })

      localStorage.setItem(this.config.swKey, swUrl)

      return
    }

    const current = localStorage.getItem(this.config.swKey)

    if (current !== swUrl) {
      await existing.unregister()

      await navigator.serviceWorker.register(swUrl, {
        type: "module"
      })

      localStorage.setItem(this.config.swKey, swUrl)
    }
  }

  async install() {
    try {

      await ensureRoot()
      await this.initializeOzone()
      await this.ensureServiceWorker()

      return true;
    } catch {
      return false;
    }
  }

  async update() {
    try {

      await ensureRoot()
      await this.initializeOzone()
      await this.ensureServiceWorker()

      return true;
    } catch {
      return false;
    }
  }

  async reset() {
    try {


      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map(r => r.unregister()))

      await new Promise(resolve => {
        const req = indexedDB.deleteDatabase(this.config.dbName)
        req.onsuccess = resolve
        req.onerror = resolve
        req.onblocked = resolve
      })

      localStorage.removeItem(this.config.swKey)

      return true;

    } catch {
      return false;
    }
  }

  async info() {
    const versions = await this.fetchJSON(this.config.versionURL).catch(() => null)
    const reg = await navigator.serviceWorker.getRegistration().catch(() => null)
    const swVersion = localStorage.getItem(this.config.swKey)

    return {
      versions,
      serviceWorker: {
        registered: !!reg,
        version: swVersion || null
      },
      config: this.config
    }
  }
}