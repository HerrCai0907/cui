package com.herrcai.cui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import com.herrcai.cui.ssh.SshTunnelBridge
import com.herrcai.cui.web.CuiWebViewController

class MainActivity : ComponentActivity() {
    private lateinit var webViewController: CuiWebViewController
    private lateinit var sshTunnelBridge: SshTunnelBridge

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        sshTunnelBridge = SshTunnelBridge(this) { webViewController.reload() }
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
        sshTunnelBridge.onActivityResumed()
    }

    override fun onPause() {
        sshTunnelBridge.onActivityPaused()
        super.onPause()
    }

    override fun onDestroy() {
        sshTunnelBridge.close()
        webViewController.destroy()
        super.onDestroy()
    }
}
