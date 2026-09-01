package com.herrcai.cui.web

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import com.herrcai.cui.BuildConfig
import com.herrcai.cui.R
import com.herrcai.cui.ssh.SshTunnelBridge

internal class CuiWebViewController(
    private val activity: Activity,
    sshTunnelBridge: SshTunnelBridge,
) {
    private val webView = WebView(activity)

    val contentView: View = FrameLayout(activity).apply {
        setBackgroundColor(Color.WHITE)
        applySystemBarInsets(this)
        addView(
            webView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
    }

    init {
        configureSystemBars()
        configureWebView(sshTunnelBridge)
    }

    fun restoreOrLoad(savedInstanceState: Bundle?) {
        if (savedInstanceState == null) {
            webView.loadUrl(APP_URL)
        } else {
            webView.restoreState(savedInstanceState)
        }
    }

    fun saveState(outState: Bundle) {
        webView.saveState(outState)
    }

    fun reload() {
        webView.post(webView::reload)
    }

    fun handleBack(onUnhandled: () -> Unit) {
        webView.evaluateJavascript(
            "Boolean(window.__cuiHandleBack && window.__cuiHandleBack())",
        ) { handled ->
            when {
                handled == "true" -> Unit
                webView.canGoBack() -> webView.goBack()
                else -> onUnhandled()
            }
        }
    }

    fun destroy() {
        webView.stopLoading()
        webView.webChromeClient = null
        webView.webViewClient = WebViewClient()
        webView.destroy()
    }

    @Suppress("DEPRECATION")
    private fun configureSystemBars() {
        activity.window.statusBarColor = activity.getColor(R.color.cui_system_bar)
        activity.window.navigationBarColor = activity.getColor(R.color.cui_system_bar)
        activity.window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
    }

    private fun applySystemBarInsets(root: FrameLayout) {
        root.setOnApplyWindowInsetsListener { view, windowInsets ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val insets = windowInsets.getInsets(
                    WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout(),
                )
                view.setPadding(insets.left, insets.top, insets.right, insets.bottom)
            } else {
                @Suppress("DEPRECATION")
                view.setPadding(
                    windowInsets.systemWindowInsetLeft,
                    windowInsets.systemWindowInsetTop,
                    windowInsets.systemWindowInsetRight,
                    windowInsets.systemWindowInsetBottom,
                )
            }
            windowInsets
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Suppress("DEPRECATION")
    private fun configureWebView(sshTunnelBridge: SshTunnelBridge) {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = false
            allowFileAccessFromFileURLs = true
            allowUniversalAccessFromFileURLs = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            mediaPlaybackRequiresUserGesture = true
            userAgentString = "$userAgentString CUI-Android/0.1"
        }

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        webView.setBackgroundColor(Color.WHITE)
        webView.addJavascriptInterface(sshTunnelBridge, JS_BRIDGE_NAME)
        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean = openExternalUrl(request.url)

            @Suppress("DEPRECATION")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
                openExternalUrl(Uri.parse(url))
        }
    }

    private fun openExternalUrl(uri: Uri): Boolean {
        if (uri.scheme == null || uri.scheme in INTERNAL_SCHEMES) {
            return false
        }

        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: RuntimeException) {
            // Keep the app usable when no activity can handle an external link.
        }
        return true
    }

    private companion object {
        const val APP_URL = "file:///android_asset/www/index.html"
        const val JS_BRIDGE_NAME = "CuiAndroid"
        val INTERNAL_SCHEMES = setOf("file", "about", "data")
    }
}
