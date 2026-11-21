package tech.credoapp.credo

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Motor nativo de actualizaciones OTA basado en GitHub Releases API.
 * Consulta https://api.github.com/repos/<owner>/<repo>/releases/latest,
 * compara SemVer con BuildConfig.VERSION_NAME, descarga el APK con progreso
 * en tiempo real y lanza el instalador seguro vía FileProvider.
 */
class GitHubUpdateEngine(private val activity: Activity) {

    data class ReleaseInfo(
        val version: String,
        val title: String,
        val notes: String,
        val apkUrl: String,
        val apkName: String,
        val sizeBytes: Long
    )

    private val executor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var pendingApkFile: File? = null

    fun checkForUpdate(silent: Boolean = true) {
        executor.execute {
            try {
                val apiUrl = "https://api.github.com/repos/${BuildConfig.GITHUB_REPO}/releases/latest"
                val conn = (URL(apiUrl).openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = 8000
                    readTimeout = 8000
                    setRequestProperty("Accept", "application/vnd.github+json")
                    setRequestProperty("User-Agent", "CredoAndroid/${BuildConfig.VERSION_NAME}")
                }

                val code = conn.responseCode
                if (code != 200) {
                    conn.disconnect()
                    if (!silent) {
                        postToast("No se pudo verificar actualizaciones (HTTP $code)")
                    }
                    return@execute
                }

                val body = conn.inputStream.bufferedReader().use { it.readText() }
                conn.disconnect()

                val json = JSONObject(body)
                val tagName = json.optString("tag_name", "").trim()
                val remoteVersion = tagName.removePrefix("v").removePrefix("V")
                val releaseTitle = json.optString("name", "Credo $tagName").ifBlank { "Credo $tagName" }
                val releaseNotes = json.optString("body", "Mejoras de rendimiento y estabilidad.")
                val assets = json.optJSONArray("assets")

                var apkUrl = ""
                var apkName = "Credo-$tagName.apk"
                var apkSize = 0L

                if (assets != null) {
                    for (i in 0 until assets.length()) {
                        val a = assets.getJSONObject(i)
                        val name = a.optString("name", "")
                        if (name.endsWith(".apk", ignoreCase = true)) {
                            apkUrl = a.optString("browser_download_url", "")
                            apkName = name
                            apkSize = a.optLong("size", 0L)
                            break
                        }
                    }
                }

                if (remoteVersion.isBlank() || apkUrl.isBlank()) {
                    if (!silent) postToast("Ya tienes la última versión (v${BuildConfig.VERSION_NAME})")
                    return@execute
                }

                if (compareSemVer(remoteVersion, BuildConfig.VERSION_NAME) > 0) {
                    val info = ReleaseInfo(
                        version = remoteVersion,
                        title = releaseTitle,
                        notes = releaseNotes,
                        apkUrl = apkUrl,
                        apkName = apkName,
                        sizeBytes = apkSize
                    )
                    mainHandler.post { showUpdateDialog(info) }
                } else if (!silent) {
                    postToast("Credo v${BuildConfig.VERSION_NAME} está actualizado")
                }
            } catch (e: Exception) {
                if (!silent) {
                    postToast("Error al buscar actualizaciones: ${e.localizedMessage ?: "sin conexión"}")
                }
            }
        }
    }

    private fun showUpdateDialog(info: ReleaseInfo) {
        if (activity.isFinishing || activity.isDestroyed) return
        val sizeMb = if (info.sizeBytes > 0) String.format("%.1f MB", info.sizeBytes / (1024.0 * 1024.0)) else ""
        val message = buildString {
            append("Nueva versión disponible: v${info.version}\n")
            append("Versión instalada: v${BuildConfig.VERSION_NAME}\n")
            if (sizeMb.isNotBlank()) append("Tamaño: $sizeMb\n")
            append("\n${info.notes.take(600)}")
        }

        AlertDialog.Builder(activity)
            .setTitle("Actualización de Credo")
            .setMessage(message)
            .setCancelable(true)
            .setPositiveButton("Actualizar ahora") { _, _ ->
                downloadAndInstall(info)
            }
            .setNegativeButton("Más tarde", null)
            .show()
    }

    private fun downloadAndInstall(info: ReleaseInfo) {
        if (activity.isFinishing || activity.isDestroyed) return

        val container = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(56, 40, 56, 24)
            gravity = Gravity.CENTER_HORIZONTAL
        }
        val statusText = TextView(activity).apply {
            text = "Conectando con GitHub Releases…"
            textSize = 14f
            setPadding(0, 0, 0, 24)
        }
        val progressBar = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = false
            max = 100
            progress = 0
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }
        container.addView(statusText)
        container.addView(progressBar)

        val progressDialog = AlertDialog.Builder(activity)
            .setTitle("Descargando Credo v${info.version}")
            .setView(container)
            .setCancelable(false)
            .create()
        progressDialog.show()

        executor.execute {
            try {
                val dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: activity.cacheDir
                val outFile = File(dir, "credo-update-${info.version}.apk")
                if (outFile.exists()) outFile.delete()

                val conn = openFollowingRedirects(info.apkUrl)
                val total = if (conn.contentLengthLong > 0) conn.contentLengthLong else info.sizeBytes

                conn.inputStream.use { input ->
                    FileOutputStream(outFile).use { output ->
                        val buf = ByteArray(16 * 1024)
                        var downloaded = 0L
                        var lastPct = -1
                        while (true) {
                            val read = input.read(buf)
                            if (read == -1) break
                            output.write(buf, 0, read)
                            downloaded += read
                            if (total > 0) {
                                val pct = ((downloaded * 100L) / total).toInt().coerceIn(0, 100)
                                if (pct != lastPct) {
                                    lastPct = pct
                                    val mbDone = String.format("%.1f", downloaded / (1024.0 * 1024.0))
                                    val mbTot = String.format("%.1f", total / (1024.0 * 1024.0))
                                    mainHandler.post {
                                        progressBar.progress = pct
                                        statusText.text = "$pct% ($mbDone MB / $mbTot MB)"
                                    }
                                }
                            }
                        }
                        output.flush()
                    }
                }
                conn.disconnect()

                mainHandler.post {
                    progressDialog.dismiss()
                    pendingApkFile = outFile
                    triggerApkInstall(outFile)
                }
            } catch (e: Exception) {
                mainHandler.post {
                    progressDialog.dismiss()
                    Toast.makeText(
                        activity,
                        "Error al descargar actualización: ${e.localizedMessage ?: "reintenta"}",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }
    }

    private fun openFollowingRedirects(startUrl: String): HttpURLConnection {
        var currentUrl = startUrl
        repeat(6) {
            val conn = (URL(currentUrl).openConnection() as HttpURLConnection).apply {
                instanceFollowRedirects = false
                connectTimeout = 15000
                readTimeout = 30000
                setRequestProperty("User-Agent", "CredoAndroid/${BuildConfig.VERSION_NAME}")
            }
            val code = conn.responseCode
            if (code in 301..308) {
                val loc = conn.getHeaderField("Location")
                conn.disconnect()
                if (loc.isNullOrBlank()) throw IllegalStateException("Redirect sin destino")
                currentUrl = loc
            } else if (code == 200) {
                return conn
            } else {
                conn.disconnect()
                throw IllegalStateException("Error HTTP $code descargando APK")
            }
        }
        throw IllegalStateException("Demasiadas redirecciones al descargar APK")
    }

    fun resumePendingInstallIfPermitted() {
        val file = pendingApkFile ?: return
        if (!file.exists()) {
            pendingApkFile = null
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || activity.packageManager.canRequestPackageInstalls()) {
            pendingApkFile = null
            triggerApkInstall(file)
        }
    }

    private fun triggerApkInstall(apkFile: File) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
            AlertDialog.Builder(activity)
                .setTitle("Permiso para instalar actualizaciones")
                .setMessage("Autoriza a Credo a instalar actualizaciones oficiales desde GitHub y regresa a la app.")
                .setPositiveButton("Autorizar") { _, _ ->
                    val intent = Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:${activity.packageName}")
                    )
                    activity.startActivity(intent)
                }
                .setNegativeButton("Cancelar", null)
                .show()
            return
        }

        val uri = FileProvider.getUriForFile(
            activity,
            "${activity.packageName}.fileprovider",
            apkFile
        )
        val installIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        activity.startActivity(installIntent)
    }

    private fun postToast(msg: String) {
        mainHandler.post {
            if (!activity.isFinishing) {
                Toast.makeText(activity, msg, Toast.LENGTH_SHORT).show()
            }
        }
    }

    companion object {
        fun compareSemVer(remote: String, local: String): Int {
            val r = remote.split(".", "-", "+").mapNotNull { it.toIntOrNull() }
            val l = local.split(".", "-", "+").mapNotNull { it.toIntOrNull() }
            val maxLen = maxOf(r.size, l.size, 3)
            for (i in 0 until maxLen) {
                val rv = r.getOrElse(i) { 0 }
                val lv = l.getOrElse(i) { 0 }
                if (rv != lv) return rv.compareTo(lv)
            }
            return 0
        }
    }
}
