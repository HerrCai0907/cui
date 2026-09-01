import org.gradle.api.tasks.Sync
import java.util.Properties

val localTunnelProperties = Properties().apply {
    val configFile = rootProject.file("gdb.env")

    if (configFile.isFile) {
        configFile.inputStream().use(::load)
    }
}

fun localTunnelValue(environmentName: String, propertyName: String, fallback: String = ""): String {
    return System.getenv(environmentName)
        ?.trim()
        ?.takeIf(String::isNotEmpty)
        ?: localTunnelProperties.getProperty(propertyName, fallback).trim()
}

fun parseTunnelPort(value: String, fallback: Int): Int {
    return value.toIntOrNull()?.takeIf { it in 1..65535 } ?: fallback
}

fun String.asBuildConfigString(): String {
    return "\"${replace("\\", "\\\\").replace("\"", "\\\"")}\""
}

val defaultSshHost = localTunnelValue("CUI_SSH_HOST", "ip")
val defaultSshPort = parseTunnelPort(localTunnelValue("CUI_SSH_PORT", "ssh-port", "22"), 22)
val defaultSshUsername = localTunnelValue("CUI_SSH_USERNAME", "user")
val defaultSshPassword = localTunnelValue("CUI_SSH_PASSWORD", "password")
val defaultApiPort = parseTunnelPort(localTunnelValue("CUI_API_PORT", "api-port"), 0)
val defaultLocalPort = parseTunnelPort(
    localTunnelValue("CUI_LOCAL_PORT", "local-port", defaultApiPort.toString()),
    defaultApiPort,
)
val defaultRemoteHost = localTunnelValue("CUI_REMOTE_HOST", "remote-host", "127.0.0.1")
val defaultRemotePort = parseTunnelPort(
    localTunnelValue("CUI_REMOTE_PORT", "remote-port", defaultApiPort.toString()),
    defaultApiPort,
)
val hasDefaultTunnelConfig = defaultSshHost.isNotEmpty()
    && defaultSshUsername.isNotEmpty()
    && defaultSshPassword.isNotEmpty()
    && defaultLocalPort > 0
    && defaultRemotePort > 0

plugins {
    id("com.android.application")
}

android {
    namespace = "com.herrcai.cui"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.herrcai.cui"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"

        buildConfigField("boolean", "DEFAULT_SSH_TUNNEL_ENABLED", hasDefaultTunnelConfig.toString())
        buildConfigField("String", "DEFAULT_SSH_HOST", defaultSshHost.asBuildConfigString())
        buildConfigField("int", "DEFAULT_SSH_PORT", defaultSshPort.toString())
        buildConfigField("String", "DEFAULT_SSH_USERNAME", defaultSshUsername.asBuildConfigString())
        buildConfigField("String", "DEFAULT_SSH_PASSWORD", defaultSshPassword.asBuildConfigString())
        buildConfigField("int", "DEFAULT_LOCAL_PORT", defaultLocalPort.toString())
        buildConfigField("String", "DEFAULT_REMOTE_HOST", defaultRemoteHost.asBuildConfigString())
        buildConfigField("int", "DEFAULT_REMOTE_PORT", defaultRemotePort.toString())
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.activity:activity:1.13.0")
    implementation("com.github.mwiede:jsch:0.2.25")
}

val repositoryRoot = rootProject.layout.projectDirectory.dir("../..")
val webApp = repositoryRoot.dir("apps/web")
val bundledWebAssets = layout.projectDirectory.dir("src/main/assets/www")

val buildEmbeddedWeb by tasks.registering(Exec::class) {
    group = "build"
    description = "Builds the shared web UI for the Android WebView."
    workingDir(repositoryRoot)
    environment("CUI_EMBEDDED_BUILD", "1")
    commandLine("npm", "run", "build", "-w", "@cui/web")
    inputs.dir(webApp.dir("src"))
    inputs.dir(webApp.dir("public"))
    inputs.file(webApp.file("index.html"))
    inputs.file(webApp.file("package.json"))
    inputs.file(webApp.file("vite.config.ts"))
    outputs.dir(webApp.dir("dist"))
}

val syncEmbeddedWeb by tasks.registering(Sync::class) {
    group = "build"
    description = "Copies the embedded web build into Android assets."
    dependsOn(buildEmbeddedWeb)
    from(webApp.dir("dist"))
    into(bundledWebAssets)
}

tasks.named("preBuild").configure {
    dependsOn(syncEmbeddedWeb)
}
