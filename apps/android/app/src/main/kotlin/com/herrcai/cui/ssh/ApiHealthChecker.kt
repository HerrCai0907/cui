package com.herrcai.cui.ssh

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

internal class ApiHealthChecker {
    @Throws(IOException::class)
    fun verify(localPort: Int) {
        val currentStatus = requestStatus(localPort, CURRENT_HEALTH_PATH)
        if (currentStatus in 200..299) {
            return
        }

        if (currentStatus == HttpURLConnection.HTTP_NOT_FOUND) {
            val legacyStatus = requestStatus(localPort, LEGACY_HEALTH_PATH)
            if (legacyStatus in 200..299) {
                throw IOException(
                    "Tunnel is reachable, but the server API is incompatible: " +
                        "/api/v1/health returned HTTP 404 while legacy /api/health is available.",
                )
            }
        }

        throw IOException("API health check failed with HTTP $currentStatus.")
    }

    @Throws(IOException::class)
    private fun requestStatus(localPort: Int, path: String): Int {
        val connection = URL("http://127.0.0.1:$localPort$path").openConnection() as HttpURLConnection
        return try {
            connection.connectTimeout = REQUEST_TIMEOUT_MILLIS
            connection.readTimeout = REQUEST_TIMEOUT_MILLIS
            connection.requestMethod = "GET"
            connection.useCaches = false
            connection.responseCode
        } finally {
            connection.disconnect()
        }
    }

    private companion object {
        const val CURRENT_HEALTH_PATH = "/api/v1/health"
        const val LEGACY_HEALTH_PATH = "/api/health"
        const val REQUEST_TIMEOUT_MILLIS = 5_000
    }
}
