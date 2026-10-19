package com.herrcai.cui.ssh

import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.net.Socket
import java.util.Base64
import java.util.UUID

internal class ApiHealthChecker {
    @Throws(IOException::class)
    fun verify(localPort: Int) {
        Socket("127.0.0.1", localPort).use { socket ->
            socket.soTimeout = REQUEST_TIMEOUT_MILLIS
            socket.getOutputStream().write(createHandshakeRequest().toByteArray(Charsets.US_ASCII))
            socket.getOutputStream().flush()

            val statusLine = BufferedReader(
                InputStreamReader(socket.getInputStream(), Charsets.US_ASCII),
            ).readLine()

            if (statusLine?.contains(" 101 ") == true) {
                return
            }

            throw IOException(
                "API WebSocket health check failed: " + (statusLine ?: "no response"),
            )
        }
    }

    private fun createHandshakeRequest(): String {
        val key = Base64.getEncoder().encodeToString(UUID.randomUUID().toString().toByteArray())

        return buildString {
            append("GET ")
            append(RPC_PATH)
            append(" HTTP/1.1\r\n")
            append("Host: 127.0.0.1\r\n")
            append("Upgrade: websocket\r\n")
            append("Connection: Upgrade\r\n")
            append("Sec-WebSocket-Version: 13\r\n")
            append("Sec-WebSocket-Key: ")
            append(key)
            append("\r\n\r\n")
        }
    }

    private companion object {
        const val RPC_PATH = "/api/v1/rpc"
        const val REQUEST_TIMEOUT_MILLIS = 5_000
    }
}
