package com.herrcai.cui.ssh

import org.json.JSONObject

internal data class TunnelStatus(
    val connected: Boolean,
    val message: String,
) {
    fun toJson(): String = runCatching {
        JSONObject()
            .put("connected", connected)
            .put("message", message)
            .toString()
    }.getOrDefault(ERROR_STATUS_JSON)

    private companion object {
        const val ERROR_STATUS_JSON =
            "{\"connected\":false,\"message\":\"Unable to encode SSH tunnel status.\"}"
    }
}
