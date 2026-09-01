package com.herrcai.cui.ssh

import com.herrcai.cui.BuildConfig
import org.json.JSONObject

internal data class TunnelConfig(
    val enabled: Boolean,
    val host: String,
    val port: Int,
    val username: String,
    val password: String,
    val localPort: Int,
    val remoteHost: String,
    val remotePort: Int,
) {
    val isReady: Boolean
        get() = enabled &&
            host.isNotEmpty() &&
            port > 0 &&
            username.isNotEmpty() &&
            localPort > 0 &&
            remoteHost.isNotEmpty() &&
            remotePort > 0

    fun toJson(): String = runCatching {
        JSONObject()
            .put("version", CONFIG_VERSION)
            .put("enabled", enabled)
            .put("host", host)
            .put("port", port)
            .put("username", username)
            .put("password", password)
            .put("localPort", localPort)
            .put("remoteHost", remoteHost)
            .put("remotePort", remotePort)
            .toString()
    }.getOrDefault("{}")

    companion object {
        const val CONFIG_VERSION = 2

        fun fromJson(rawConfig: String): TunnelConfig = fromJsonObject(JSONObject(rawConfig))

        fun fromStoredJson(rawConfig: String): TunnelConfig {
            val config = JSONObject(rawConfig)
            return if (config.optInt("version", 1) == CONFIG_VERSION) {
                fromJsonObject(config)
            } else {
                disabled()
            }
        }

        fun buildDefaults() = TunnelConfig(
            enabled = BuildConfig.DEFAULT_SSH_TUNNEL_ENABLED,
            host = BuildConfig.DEFAULT_SSH_HOST,
            port = BuildConfig.DEFAULT_SSH_PORT,
            username = BuildConfig.DEFAULT_SSH_USERNAME,
            password = BuildConfig.DEFAULT_SSH_PASSWORD,
            localPort = BuildConfig.DEFAULT_LOCAL_PORT,
            remoteHost = BuildConfig.DEFAULT_REMOTE_HOST,
            remotePort = BuildConfig.DEFAULT_REMOTE_PORT,
        )

        private fun disabled() = TunnelConfig(false, "", 0, "", "", 0, "", 0)

        private fun fromJsonObject(config: JSONObject) = TunnelConfig(
            enabled = config.optBoolean("enabled", false),
            host = config.optString("host", "").trim(),
            port = config.parsePort("port"),
            username = config.optString("username", "").trim(),
            password = config.optString("password", ""),
            localPort = config.parsePort("localPort"),
            remoteHost = config.optString("remoteHost", "").trim(),
            remotePort = config.parsePort("remotePort"),
        )

        private fun JSONObject.parsePort(key: String): Int = optInt(key, 0).takeIf {
            it in 1..65535
        } ?: 0
    }
}
