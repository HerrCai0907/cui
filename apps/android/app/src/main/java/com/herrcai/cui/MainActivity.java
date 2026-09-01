package com.herrcai.cui;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
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
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

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
    protected void onResume() {
        super.onResume();
        if (sshTunnelBridge != null) {
            sshTunnelBridge.setActivityResumed(true);
        }
    }

    @Override
    protected void onPause() {
        if (sshTunnelBridge != null) {
            sshTunnelBridge.setActivityResumed(false);
        }
        super.onPause();
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
        private static final int SSH_KEEP_ALIVE_INTERVAL_MILLIS = 10_000;
        private static final int SSH_KEEP_ALIVE_COUNT_MAX = 2;
        private static final long HEALTH_CHECK_INTERVAL_MILLIS = 15_000;
        private static final long MAX_RECONNECT_DELAY_MILLIS = 30_000;

        private final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor();
        private final SharedPreferences preferences = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        private final PowerManager powerManager = getSystemService(PowerManager.class);
        private final Object schedulingLock = new Object();
        private final AtomicLong configGeneration = new AtomicLong();
        private final Object sessionLock = new Object();
        private volatile boolean activityResumed;
        private volatile boolean closed;
        private ScheduledFuture<?> maintenanceFuture;
        private int reconnectAttempt;
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
            long generation = configGeneration.incrementAndGet();

            if (!config.enabled) {
                status = new TunnelStatus(false, "SSH tunnel is disabled.");
                cancelMaintenance();
                execute(() -> disconnectIfCurrent(generation));
                return status.toJson();
            }

            status = new TunnelStatus(false, "Connecting to SSH tunnel...");
            reconnectAttempt = 0;
            disconnect();
            scheduleMaintenance(0);
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
                status = new TunnelStatus(false, "Waiting to connect to SSH tunnel...");
                scheduleMaintenance(0);
            }
        }

        void setActivityResumed(boolean resumed) {
            activityResumed = resumed;

            if (resumed) {
                scheduleMaintenance(0);
            } else {
                cancelMaintenance();
            }
        }

        void close() {
            closed = true;
            configGeneration.incrementAndGet();
            cancelMaintenance();
            disconnect();
            executor.shutdownNow();
        }

        private void maintainTunnel() {
            if (!isAppInUse()) {
                return;
            }

            TunnelConfig config = loadCurrentConfig();

            if (!config.isReady()) {
                disconnect();
                status = config.enabled
                        ? new TunnelStatus(false, "Complete the SSH tunnel configuration first.")
                        : new TunnelStatus(false, "SSH tunnel is disabled.");
                return;
            }

            long generation = configGeneration.get();

            if (isSessionConnected()) {
                try {
                    verifyApiHealth(config.localPort);
                    if (generation != configGeneration.get()) {
                        return;
                    }
                    reconnectAttempt = 0;
                    scheduleMaintenance(HEALTH_CHECK_INTERVAL_MILLIS);
                    return;
                } catch (IOException reason) {
                    if (generation != configGeneration.get()) {
                        return;
                    }
                    Log.w(LOG_TAG, "SSH tunnel health check failed; reconnecting", reason);
                    disconnect();
                    status = new TunnelStatus(
                            false,
                            "SSH tunnel connection was lost. Reconnecting..."
                    );
                }
            }

            connect(config, generation);
        }

        private void connect(TunnelConfig config, long generation) {
            disconnect();

            if (!config.isReady()) {
                status = new TunnelStatus(false, "Complete the SSH tunnel configuration first.");
                return;
            }

            Session nextSession = null;

            try {
                Log.i(LOG_TAG, "Starting SSH tunnel connection.");
                JSch jsch = new JSch();
                nextSession = jsch.getSession(config.username, config.host, config.port);
                nextSession.setPassword(config.password);
                Properties sessionConfig = new Properties();
                sessionConfig.put("StrictHostKeyChecking", "no");
                sessionConfig.put("PreferredAuthentications", "password,keyboard-interactive,publickey");
                nextSession.setConfig(sessionConfig);
                nextSession.setServerAliveInterval(SSH_KEEP_ALIVE_INTERVAL_MILLIS);
                nextSession.setServerAliveCountMax(SSH_KEEP_ALIVE_COUNT_MAX);
                nextSession.connect(15_000);
                nextSession.setPortForwardingL(
                        "localhost",
                        config.localPort,
                        config.remoteHost,
                        config.remotePort
                );
                verifyApiHealth(config.localPort);

                if (!isAppInUse() || generation != configGeneration.get()) {
                    nextSession.disconnect();
                    return;
                }

                synchronized (sessionLock) {
                    session = nextSession;
                }
                nextSession = null;
                reconnectAttempt = 0;
                status = new TunnelStatus(
                        true,
                        "SSH tunnel and API health check passed: localhost:" + config.localPort
                                + " -> " + config.host + " -> " + config.remoteHost + ":" + config.remotePort
                );
                Log.i(LOG_TAG, "SSH tunnel connected and API health check passed.");
                webView.post(webView::reload);
                scheduleMaintenance(HEALTH_CHECK_INTERVAL_MILLIS);
            } catch (IOException reason) {
                Log.w(LOG_TAG, "SSH tunnel API validation failed", reason);
                scheduleReconnectIfCurrent(
                        generation,
                        "SSH tunnel API validation failed: " + reason.getMessage()
                );
            } catch (JSchException | LinkageError | RuntimeException reason) {
                Log.w(LOG_TAG, "SSH tunnel failed", reason);
                scheduleReconnectIfCurrent(
                        generation,
                        "SSH tunnel failed: " + reason.getMessage()
                );
            } finally {
                if (nextSession != null) {
                    nextSession.disconnect();
                }
            }
        }

        private void scheduleReconnect(String failureMessage) {
            disconnect();

            if (!isAppInUse()) {
                status = new TunnelStatus(false, failureMessage);
                return;
            }

            long delayMillis = Math.min(
                    1_000L << Math.min(reconnectAttempt, 5),
                    MAX_RECONNECT_DELAY_MILLIS
            );
            reconnectAttempt += 1;
            status = new TunnelStatus(
                    false,
                    failureMessage + " Retrying in " + (delayMillis / 1_000) + "s."
            );
            scheduleMaintenance(delayMillis);
        }

        private void scheduleReconnectIfCurrent(long generation, String failureMessage) {
            if (generation == configGeneration.get()) {
                scheduleReconnect(failureMessage);
            }
        }

        private void scheduleMaintenance(long delayMillis) {
            synchronized (schedulingLock) {
                if (!isAppInUse()) {
                    return;
                }

                if (maintenanceFuture != null) {
                    maintenanceFuture.cancel(false);
                }

                try {
                    maintenanceFuture = executor.schedule(
                            this::maintainTunnel,
                            delayMillis,
                            TimeUnit.MILLISECONDS
                    );
                } catch (RejectedExecutionException ignored) {
                    // The activity is already being destroyed.
                }
            }
        }

        private void cancelMaintenance() {
            synchronized (schedulingLock) {
                if (maintenanceFuture != null) {
                    maintenanceFuture.cancel(false);
                    maintenanceFuture = null;
                }
            }
        }

        private void execute(Runnable task) {
            try {
                executor.execute(task);
            } catch (RejectedExecutionException ignored) {
                // The activity is already being destroyed.
            }
        }

        private boolean isAppInUse() {
            return !closed
                    && activityResumed
                    && powerManager != null
                    && powerManager.isInteractive();
        }

        private TunnelConfig loadCurrentConfig() {
            try {
                return TunnelConfig.fromStoredJson(loadSshTunnelConfig());
            } catch (JSONException ignored) {
                return defaultConfig();
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
            synchronized (sessionLock) {
                if (session != null) {
                    session.disconnect();
                    session = null;
                }
            }
        }

        private void disconnectIfCurrent(long generation) {
            if (generation == configGeneration.get()) {
                disconnect();
            }
        }

        private boolean isSessionConnected() {
            synchronized (sessionLock) {
                return session != null && session.isConnected();
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
