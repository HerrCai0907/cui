package com.herrcai.cui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import com.herrcai.cui.notifications.SessionCompletionNotifier
import com.herrcai.cui.ssh.SshTunnelBridge
import com.herrcai.cui.web.CuiWebViewController

class MainActivity : ComponentActivity() {
    private lateinit var webViewController: CuiWebViewController
    private lateinit var sshTunnelBridge: SshTunnelBridge
    private lateinit var sessionCompletionNotifier: SessionCompletionNotifier
    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) {
        // The notifier checks permission again before posting; no extra state is needed here.
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        sessionCompletionNotifier = SessionCompletionNotifier(this)
        sessionCompletionNotifier.createNotificationChannel()
        requestNotificationPermissionIfNeeded()
        sshTunnelBridge = SshTunnelBridge(
            this,
            { webViewController.reload() },
            sessionCompletionNotifier,
        )
        webViewController = CuiWebViewController(this, sshTunnelBridge)
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    webViewController.handleBack {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                        isEnabled = true
                    }
                }
            },
        )
        setContentView(webViewController.contentView)
        sshTunnelBridge.startIfEnabled()
        webViewController.restoreOrLoad(savedInstanceState)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webViewController.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onResume() {
        super.onResume()
        sessionCompletionNotifier.onActivityResumed()
        sshTunnelBridge.onActivityResumed()
    }

    override fun onPause() {
        sshTunnelBridge.onActivityPaused()
        sessionCompletionNotifier.onActivityPaused()
        super.onPause()
    }

    override fun onDestroy() {
        sshTunnelBridge.close()
        webViewController.destroy()
        super.onDestroy()
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return
        }

        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            return
        }

        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
}
