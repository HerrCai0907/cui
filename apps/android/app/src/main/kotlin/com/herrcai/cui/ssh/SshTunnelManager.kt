package com.herrcai.cui.ssh

import android.os.PowerManager
import android.util.Log
import com.jcraft.jsch.JSch
import com.jcraft.jsch.JSchException
import com.jcraft.jsch.Session
import java.io.IOException
import java.util.Properties
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

internal class SshTunnelManager(
    private val powerManager: PowerManager?,
    private val configProvider: () -> TunnelConfig,
    private val onConnected: () -> Unit,
    private val healthChecker: ApiHealthChecker = ApiHealthChecker(),
) {
    private val executor: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()
    private val schedulingLock = Any()
    private val sessionLock = Any()
    private val configGeneration = AtomicLong()

    @Volatile
    private var activityResumed = false

    @Volatile
    private var closed = false

    @Volatile
    var status = TunnelStatus(false, "SSH tunnel is not connected.")
        private set

    private var maintenanceFuture: ScheduledFuture<*>? = null
    private var reconnectAttempt = 0
    private var session: Session? = null

    fun startIfEnabled(config: TunnelConfig) {
        if (config.isReady) {
            status = TunnelStatus(false, "Waiting to connect to SSH tunnel...")
            scheduleMaintenance(0)
        }
    }

    fun applyConfig(config: TunnelConfig) {
        val generation = configGeneration.incrementAndGet()

        if (!config.enabled) {
            status = TunnelStatus(false, "SSH tunnel is disabled.")
            cancelMaintenance()
            execute { disconnectIfCurrent(generation) }
            return
        }

        status = TunnelStatus(false, "Connecting to SSH tunnel...")
        reconnectAttempt = 0
        disconnect()
        scheduleMaintenance(0)
    }

    fun reportInvalidConfig(): TunnelStatus {
        return TunnelStatus(false, "Invalid SSH tunnel configuration.").also { status = it }
    }

    fun setActivityResumed(resumed: Boolean) {
        activityResumed = resumed
        if (resumed) {
            scheduleMaintenance(0)
        } else {
            cancelMaintenance()
        }
    }

    fun close() {
        closed = true
        configGeneration.incrementAndGet()
        cancelMaintenance()
        disconnect()
        executor.shutdownNow()
    }

    private fun maintainTunnel() {
        if (!isAppInUse()) {
            return
        }

        val config = configProvider()
        if (!config.isReady) {
            disconnect()
            status = if (config.enabled) {
                TunnelStatus(false, "Complete the SSH tunnel configuration first.")
            } else {
                TunnelStatus(false, "SSH tunnel is disabled.")
            }
            return
        }

        val generation = configGeneration.get()
        if (isSessionConnected()) {
            try {
                healthChecker.verify(config.localPort)
                if (generation != configGeneration.get()) {
                    return
                }
                reconnectAttempt = 0
                scheduleMaintenance(HEALTH_CHECK_INTERVAL_MILLIS)
                return
            } catch (reason: IOException) {
                if (generation != configGeneration.get()) {
                    return
                }
                Log.w(LOG_TAG, "SSH tunnel health check failed; reconnecting", reason)
                disconnect()
                status = TunnelStatus(false, "SSH tunnel connection was lost. Reconnecting...")
            }
        }

        connect(config, generation)
    }

    private fun connect(config: TunnelConfig, generation: Long) {
        disconnect()
        if (!config.isReady) {
            status = TunnelStatus(false, "Complete the SSH tunnel configuration first.")
            return
        }

        var pendingSession: Session? = null
        try {
            Log.i(LOG_TAG, "Starting SSH tunnel connection.")
            val nextSession = JSch().getSession(config.username, config.host, config.port)
            pendingSession = nextSession
            nextSession.setPassword(config.password)
            nextSession.setConfig(
                Properties().apply {
                    put("StrictHostKeyChecking", "no")
                    put("PreferredAuthentications", "password,keyboard-interactive,publickey")
                },
            )
            nextSession.setServerAliveInterval(SSH_KEEP_ALIVE_INTERVAL_MILLIS)
            nextSession.setServerAliveCountMax(SSH_KEEP_ALIVE_COUNT_MAX)
            nextSession.connect(CONNECT_TIMEOUT_MILLIS)
            nextSession.setPortForwardingL(
                "localhost",
                config.localPort,
                config.remoteHost,
                config.remotePort,
            )
            healthChecker.verify(config.localPort)

            if (!isAppInUse() || generation != configGeneration.get()) {
                return
            }

            synchronized(sessionLock) { session = nextSession }
            pendingSession = null
            reconnectAttempt = 0
            status = TunnelStatus(
                true,
                "SSH tunnel and API health check passed: localhost:${config.localPort} -> " +
                    "${config.host} -> ${config.remoteHost}:${config.remotePort}",
            )
            Log.i(LOG_TAG, "SSH tunnel connected and API health check passed.")
            onConnected()
            scheduleMaintenance(HEALTH_CHECK_INTERVAL_MILLIS)
        } catch (reason: IOException) {
            Log.w(LOG_TAG, "SSH tunnel API validation failed", reason)
            scheduleReconnectIfCurrent(
                generation,
                "SSH tunnel API validation failed: ${reason.message}",
            )
        } catch (reason: JSchException) {
            handleConnectionFailure(generation, reason)
        } catch (reason: LinkageError) {
            handleConnectionFailure(generation, reason)
        } catch (reason: RuntimeException) {
            handleConnectionFailure(generation, reason)
        } finally {
            pendingSession?.disconnect()
        }
    }

    private fun handleConnectionFailure(generation: Long, reason: Throwable) {
        Log.w(LOG_TAG, "SSH tunnel failed", reason)
        scheduleReconnectIfCurrent(generation, "SSH tunnel failed: ${reason.message}")
    }

    private fun scheduleReconnectIfCurrent(generation: Long, failureMessage: String) {
        if (generation == configGeneration.get()) {
            scheduleReconnect(failureMessage)
        }
    }

    private fun scheduleReconnect(failureMessage: String) {
        disconnect()
        if (!isAppInUse()) {
            status = TunnelStatus(false, failureMessage)
            return
        }

        val delayMillis = minOf(
            1_000L shl minOf(reconnectAttempt, 5),
            MAX_RECONNECT_DELAY_MILLIS,
        )
        reconnectAttempt += 1
        status = TunnelStatus(
            false,
            "$failureMessage Retrying in ${delayMillis / 1_000}s.",
        )
        scheduleMaintenance(delayMillis)
    }

    private fun scheduleMaintenance(delayMillis: Long) {
        synchronized(schedulingLock) {
            if (!isAppInUse()) {
                return
            }

            maintenanceFuture?.cancel(false)
            try {
                maintenanceFuture = executor.schedule(
                    ::maintainTunnel,
                    delayMillis,
                    TimeUnit.MILLISECONDS,
                )
            } catch (_: RejectedExecutionException) {
                // The activity is already being destroyed.
            }
        }
    }

    private fun cancelMaintenance() {
        synchronized(schedulingLock) {
            maintenanceFuture?.cancel(false)
            maintenanceFuture = null
        }
    }

    private fun execute(task: () -> Unit) {
        try {
            executor.execute(task)
        } catch (_: RejectedExecutionException) {
            // The activity is already being destroyed.
        }
    }

    private fun isAppInUse(): Boolean =
        !closed && activityResumed && powerManager?.isInteractive == true

    private fun disconnect() {
        synchronized(sessionLock) {
            session?.disconnect()
            session = null
        }
    }

    private fun disconnectIfCurrent(generation: Long) {
        if (generation == configGeneration.get()) {
            disconnect()
        }
    }

    private fun isSessionConnected(): Boolean = synchronized(sessionLock) {
        session?.isConnected == true
    }

    private companion object {
        const val LOG_TAG = "CuiAndroid"
        const val CONNECT_TIMEOUT_MILLIS = 15_000
        const val SSH_KEEP_ALIVE_INTERVAL_MILLIS = 10_000
        const val SSH_KEEP_ALIVE_COUNT_MAX = 2
        const val HEALTH_CHECK_INTERVAL_MILLIS = 15_000L
        const val MAX_RECONNECT_DELAY_MILLIS = 30_000L
    }
}
