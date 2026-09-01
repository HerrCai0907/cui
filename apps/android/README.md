# CUI Android

The Android application packages the shared CUI React interface in a small native WebView shell.
The Gradle build automatically rebuilds `apps/web` in embedded mode and copies it into the APK.

## Build

Open `apps/android` in Android Studio, or run from this directory:

```sh
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
./gradlew assembleDebug
```

The debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`.

## Connect to the API server through SSH

For a local build, create an ignored `gdb.env` next to this README. The build embeds these defaults
in the APK, and the app automatically starts the SSH local port forward on its first launch:

```properties
ip=ssh.example.com
api-port=15173
user=deploy
password=secret
```

`ssh-port`, `local-port`, `remote-host`, and `remote-port` are optional. They default to `22`, the
API port, `127.0.0.1`, and the API port respectively. The same values can be supplied with
`CUI_SSH_HOST`, `CUI_SSH_PORT`, `CUI_SSH_USERNAME`, `CUI_SSH_PASSWORD`, `CUI_API_PORT`,
`CUI_LOCAL_PORT`, `CUI_REMOTE_HOST`, and `CUI_REMOTE_PORT` when building.

Open **Session menu -> Config -> SSH Tunnel** to inspect or override the embedded defaults. An
override is stored on the device and is automatically reconnected on later launches.

Required tunnel settings:

- SSH host and SSH port: the server that accepts SSH connections.
- Username and password: credentials for that SSH server.
- Local port: the Android-device loopback port the WebView should call.
- Remote host and remote port: the address reachable from the SSH server.

Enter the fields, then tap **Apply**. When the tunnel is connected, all CUI REST and SSE requests
go to `http://localhost:<local-port>` on the Android device and are forwarded over SSH to
`<remote-host>:<remote-port>` from the SSH server.

While the app is in the foreground and the screen is on, it checks the tunnel periodically and
automatically reconnects a dropped SSH session with a retry delay capped at 30 seconds. Tunnel
checks and reconnect attempts pause when the app is not in use and resume immediately when the app
returns to the foreground.
