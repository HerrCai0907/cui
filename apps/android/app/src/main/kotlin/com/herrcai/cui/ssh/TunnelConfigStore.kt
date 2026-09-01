package com.herrcai.cui.ssh

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONException

internal class TunnelConfigStore(context: Context) {
    private val preferences: SharedPreferences =
        context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    fun load(): TunnelConfig {
        val rawConfig = preferences.getString(CONFIG_KEY, null) ?: return TunnelConfig.buildDefaults()

        return try {
            TunnelConfig.fromStoredJson(rawConfig)
        } catch (_: JSONException) {
            preferences.edit().remove(CONFIG_KEY).apply()
            TunnelConfig.buildDefaults()
        }
    }

    fun save(config: TunnelConfig) {
        preferences.edit().putString(CONFIG_KEY, config.toJson()).apply()
    }

    private companion object {
        const val PREFERENCES_NAME = "cui_ssh_tunnel"
        const val CONFIG_KEY = "config"
    }
}
