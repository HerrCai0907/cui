package com.herrcai.cui;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import com.jcraft.jsch.JSch;
import com.jcraft.jsch.JSchException;
import com.jcraft.jsch.Session;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Properties;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String APP_URL = "file:///android_asset/www/index.html";
    private static final String LOG_TAG = "CuiAndroid";

    private WebView webView;
    private SshTunnelBridge sshTunnelBridge;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureSystemBars();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);
        applySystemBarInsets(root);

        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        sshTunnelBridge = new SshTunnelBridge();
        configureWebView(webView);
        root.addView(webView);
        setContentView(root);
        sshTunnelBridge.startIfEnabled();

        if (savedInstanceState == null) {
            webView.loadUrl(APP_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    private void configureSystemBars() {
        getWindow().setStatusBarColor(getColor(R.color.cui_system_bar));
        getWindow().setNavigationBarColor(getColor(R.color.cui_system_bar));
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        );
    }

    private void applySystemBarInsets(FrameLayout root) {
        root.setOnApplyWindowInsetsListener((view, windowInsets) -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets insets = windowInsets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()
                );
                view.setPadding(insets.left, insets.top, insets.right, insets.bottom);
            } else {
                view.setPadding(
                        windowInsets.getSystemWindowInsetLeft(),
                        windowInsets.getSystemWindowInsetTop(),
                        windowInsets.getSystemWindowInsetRight(),
                        windowInsets.getSystemWindowInsetBottom()
                );
            }
            return windowInsets;
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setUserAgentString(settings.getUserAgentString() + " CUI-Android/0.1");

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        view.setBackgroundColor(Color.WHITE);
        view.addJavascriptInterface(sshTunnelBridge, "CuiAndroid");
        view.setWebChromeClient(new WebChromeClient());
        view.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView ignored, WebResourceRequest request) {
                return openExternalUrl(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView ignored, String url) {
                return openExternalUrl(Uri.parse(url));
            }
        });
    }

    private boolean openExternalUrl(Uri uri) {
        String scheme = uri.getScheme();

        if (scheme == null || scheme.equals("file") || scheme.equals("about") || scheme.equals("data")) {
            return false;
        }

        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (RuntimeException ignored) {
            // Keep the app usable when no activity can handle an external link.
        }
        return true;
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        webView.evaluateJavascript(
                "Boolean(window.__cuiHandleBack && window.__cuiHandleBack())",
                handled -> {
                    if ("true".equals(handled)) {
                        return;
                    }

                    if (webView.canGoBack()) {
                        webView.goBack();
                    } else {
                        MainActivity.super.onBackPressed();
                    }
                }
        );
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
        }
        if (sshTunnelBridge != null) {
            sshTunnelBridge.close();
        }
        super.onDestroy();
    }

    private final class SshTunnelBridge {
        private static final String PREFS_NAME = "cui_ssh_tunnel";
        private static final String CONFIG_KEY = "config";
        private static final int CONFIG_VERSION = 2;

        private final ExecutorService executor = Executors.newSingleThreadExecutor();
        private final SharedPreferences preferences = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        private Session session;
        private volatile TunnelStatus status = new TunnelStatus(false, "SSH tunnel is not connected.");

        @android.webkit.JavascriptInterface
        public String loadSshTunnelConfig() {
            String rawConfig = preferences.getString(CONFIG_KEY, null);

            if (rawConfig == null) {
                return defaultConfig().toJson();
            }

            try {
                return TunnelConfig.fromStoredJson(rawConfig).toJson();
            } catch (JSONException ignored) {
                preferences.edit().remove(CONFIG_KEY).apply();
                return defaultConfig().toJson();
            }
        }

        @android.webkit.JavascriptInterface
        public String saveSshTunnelConfig(String rawConfig) {
            TunnelConfig config;

            try {
                config = TunnelConfig.fromJson(rawConfig);
            } catch (JSONException reason) {
                status = new TunnelStatus(false, "Invalid SSH tunnel configuration.");
                return status.toJson();
            }

            preferences.edit().putString(CONFIG_KEY, config.toJson()).apply();

            if (!config.enabled) {
                disconnect();
                status = new TunnelStatus(false, "SSH tunnel is disabled.");
                return status.toJson();
            }

            status = new TunnelStatus(false, "Connecting to SSH tunnel...");
            executor.execute(() -> connect(config));
            return status.toJson();
        }

        @android.webkit.JavascriptInterface
        public String getSshTunnelStatus() {
            return status.toJson();
        }

        @android.webkit.JavascriptInterface
        public String getApiBaseUrl() {
            TunnelConfig config;

            try {
                config = TunnelConfig.fromJson(loadSshTunnelConfig());
            } catch (JSONException ignored) {
                return "";
            }

            if (!config.isReady()) {
                return "";
            }

            return "http://localhost:" + config.localPort;
        }

        void startIfEnabled() {
            TunnelConfig config;

            try {
                config = TunnelConfig.fromStoredJson(loadSshTunnelConfig());
            } catch (JSONException ignored) {
                config = defaultConfig();
            }

            if (config.isReady()) {
                final TunnelConfig startConfig = config;
                executor.execute(() -> connect(startConfig));
            }
        }

        void close() {
            disconnect();
            executor.shutdownNow();
        }

        private void connect(TunnelConfig config) {
            disconnect();

            if (!config.isReady()) {
                status = new TunnelStatus(false, "Complete the SSH tunnel configuration first.");
                return;
            }

            try {
                Log.i(LOG_TAG, "Starting SSH tunnel connection.");
                JSch jsch = new JSch();
                Session nextSession = jsch.getSession(config.username, config.host, config.port);
                nextSession.setPassword(config.password);
                Properties sessionConfig = new Properties();
                sessionConfig.put("StrictHostKeyChecking", "no");
                sessionConfig.put("PreferredAuthentications", "password,keyboard-interactive,publickey");
                nextSession.setConfig(sessionConfig);
                nextSession.connect(15_000);
                nextSession.setPortForwardingL(
                        "localhost",
                        config.localPort,
                        config.remoteHost,
                        config.remotePort
                );
                session = nextSession;
                verifyApiHealth(config.localPort);
                status = new TunnelStatus(
                        true,
                        "SSH tunnel and API health check passed: localhost:" + config.localPort
                                + " -> " + config.host + " -> " + config.remoteHost + ":" + config.remotePort
                );
                Log.i(LOG_TAG, "SSH tunnel connected and API health check passed.");
                webView.post(webView::reload);
            } catch (IOException reason) {
                disconnect();
                Log.w(LOG_TAG, "SSH tunnel API validation failed", reason);
                status = new TunnelStatus(false, "SSH tunnel API validation failed: " + reason.getMessage());
            } catch (JSchException | LinkageError | RuntimeException reason) {
                disconnect();
                Log.w(LOG_TAG, "SSH tunnel failed", reason);
                status = new TunnelStatus(false, "SSH tunnel failed: " + reason.getMessage());
            }
        }

        private void verifyApiHealth(int localPort) throws IOException {
            int currentStatus = requestHealthStatus(localPort, "/api/v1/health");

            if (currentStatus >= 200 && currentStatus < 300) {
                return;
            }

            if (currentStatus == HttpURLConnection.HTTP_NOT_FOUND) {
                int legacyStatus = requestHealthStatus(localPort, "/api/health");

                if (legacyStatus >= 200 && legacyStatus < 300) {
                    throw new IOException(
                            "Tunnel is reachable, but the server API is incompatible: "
                                    + "/api/v1/health returned HTTP 404 while legacy /api/health is available."
                    );
                }
            }

            throw new IOException("API health check failed with HTTP " + currentStatus + ".");
        }

        private int requestHealthStatus(int localPort, String path) throws IOException {
            HttpURLConnection connection = (HttpURLConnection) new URL(
                    "http://127.0.0.1:" + localPort + path
            ).openConnection();

            try {
                connection.setConnectTimeout(5_000);
                connection.setReadTimeout(5_000);
                connection.setRequestMethod("GET");
                connection.setUseCaches(false);
                return connection.getResponseCode();
            } finally {
                connection.disconnect();
            }
        }

        private void disconnect() {
            if (session != null) {
                session.disconnect();
                session = null;
            }
        }

        private TunnelConfig defaultConfig() {
            return new TunnelConfig(
                    BuildConfig.DEFAULT_SSH_TUNNEL_ENABLED,
                    BuildConfig.DEFAULT_SSH_HOST,
                    BuildConfig.DEFAULT_SSH_PORT,
                    BuildConfig.DEFAULT_SSH_USERNAME,
                    BuildConfig.DEFAULT_SSH_PASSWORD,
                    BuildConfig.DEFAULT_LOCAL_PORT,
                    BuildConfig.DEFAULT_REMOTE_HOST,
                    BuildConfig.DEFAULT_REMOTE_PORT
            );
        }
    }

    private static final class TunnelConfig {
        final boolean enabled;
        final String host;
        final int port;
        final String username;
        final String password;
        final int localPort;
        final String remoteHost;
        final int remotePort;

        TunnelConfig(
                boolean enabled,
                String host,
                int port,
                String username,
                String password,
                int localPort,
                String remoteHost,
                int remotePort
        ) {
            this.enabled = enabled;
            this.host = host;
            this.port = port;
            this.username = username;
            this.password = password;
            this.localPort = localPort;
            this.remoteHost = remoteHost;
            this.remotePort = remotePort;
        }

        static TunnelConfig fromStoredJson(String rawConfig) throws JSONException {
            JSONObject config = new JSONObject(rawConfig);

            if (config.optInt("version", 1) != SshTunnelBridge.CONFIG_VERSION) {
                return new TunnelConfig(false, "", 0, "", "", 0, "", 0);
            }

            return fromJson(config);
        }

        static TunnelConfig fromJson(String rawConfig) throws JSONException {
            return fromJson(new JSONObject(rawConfig));
        }

        private static TunnelConfig fromJson(JSONObject config) {
            return new TunnelConfig(
                    config.optBoolean("enabled", false),
                    config.optString("host", "").trim(),
                    parsePort(config, "port"),
                    config.optString("username", "").trim(),
                    config.optString("password", ""),
                    parsePort(config, "localPort"),
                    config.optString("remoteHost", "").trim(),
                    parsePort(config, "remotePort")
            );
        }

        String toJson() {
            JSONObject config = new JSONObject();

            try {
                config.put("version", SshTunnelBridge.CONFIG_VERSION);
                config.put("enabled", enabled);
                config.put("host", host);
                config.put("port", port);
                config.put("username", username);
                config.put("password", password);
                config.put("localPort", localPort);
                config.put("remoteHost", remoteHost);
                config.put("remotePort", remotePort);
            } catch (JSONException ignored) {
                return "{}";
            }

            return config.toString();
        }

        boolean isReady() {
            return enabled
                    && !host.isEmpty()
                    && port > 0
                    && !username.isEmpty()
                    && localPort > 0
                    && !remoteHost.isEmpty()
                    && remotePort > 0;
        }

        private static int parsePort(JSONObject config, String key) {
            int value = config.optInt(key, 0);

            return value >= 1 && value <= 65535 ? value : 0;
        }
    }

    private static final class TunnelStatus {
        final boolean connected;
        final String message;

        TunnelStatus(boolean connected, String message) {
            this.connected = connected;
            this.message = message;
        }

        String toJson() {
            JSONObject result = new JSONObject();

            try {
                result.put("connected", connected);
                result.put("message", message);
            } catch (JSONException ignored) {
                return "{\"connected\":false,\"message\":\"Unable to encode SSH tunnel status.\"}";
            }

            return result.toString();
        }
    }
}
