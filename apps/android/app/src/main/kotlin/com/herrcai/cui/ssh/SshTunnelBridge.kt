package com.herrcai.cui.ssh

import android.content.Context
import android.os.PowerManager
import android.webkit.JavascriptInterface
import org.json.JSONException

class SshTunnelBridge(
    context: Context,
    onConnected: () -> Unit,
) : AutoCloseable {
    private val configStore = TunnelConfigStore(context)
    private val tunnelManager = SshTunnelManager(
        powerManager = context.getSystemService(PowerManager::class.java),
        configProvider = configStore::load,
        onConnected = onConnected,
    )

    @JavascriptInterface
    fun loadSshTunnelConfig(): String = configStore.load().toJson()

    @JavascriptInterface
    fun saveSshTunnelConfig(rawConfig: String): String {
        val config = try {
            TunnelConfig.fromJson(rawConfig)
        } catch (_: JSONException) {
            return tunnelManager.reportInvalidConfig().toJson()
        }

        configStore.save(config)
        tunnelManager.applyConfig(config)
        return tunnelManager.status.toJson()
    }

    @JavascriptInterface
    fun getSshTunnelStatus(): String = tunnelManager.status.toJson()

    @JavascriptInterface
    fun getApiBaseUrl(): String {
        val config = configStore.load()
        return if (config.isReady) "http://localhost:${config.localPort}" else ""
    }

    fun startIfEnabled() {
        tunnelManager.startIfEnabled(configStore.load())
    }

    fun onActivityResumed() {
        tunnelManager.setActivityResumed(true)
    }

    fun onActivityPaused() {
        tunnelManager.setActivityResumed(false)
    }

    override fun close() {
        tunnelManager.close()
    }
}
