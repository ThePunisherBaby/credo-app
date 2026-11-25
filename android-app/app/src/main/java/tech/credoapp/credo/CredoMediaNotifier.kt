package tech.credoapp.credo

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * CredoMediaNotifier — Universal Native OS Media Player Notification + MediaSession
 * Supports Live Radios, Santo Rosario, Prayer Music, TTS Human Voice, and Video playback.
 */
class CredoMediaNotifier(
    private val context: Context,
    private val onAction: (String) -> Unit
) {
    companion object {
        private const val CHANNEL_ID = "credo_media_playback"
        private const val NOTIF_ID = 4109
        private const val ACTION_TOGGLE = "tech.credoapp.credo.MEDIA_TOGGLE"
        private const val ACTION_STOP = "tech.credoapp.credo.MEDIA_STOP"
    }

    private val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    private val executor = Executors.newSingleThreadExecutor()
    private val mediaSession = MediaSession(context, "CredoMediaSession")
    private var receiverRegistered = false
    private var cachedCoverUrl = ""
    private var cachedBitmap: Bitmap? = null
    private var lastTitle = "Credo"
    private var lastArtist = "Radio y Oración"
    private var lastAlbum = "Credo Católica"
    private var lastPlaying = false

    private val actionReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context?, intent: Intent?) {
            when (intent?.action) {
                ACTION_TOGGLE -> onAction("toggle")
                ACTION_STOP -> {
                    clear()
                    onAction("stop")
                }
            }
        }
    }

    init {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                CHANNEL_ID,
                "Reproducción en Credo",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Controles de reproducción para Radios, Santo Rosario, Oración y Videos"
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            nm.createNotificationChannel(ch)
        }

        mediaSession.setCallback(object : MediaSession.Callback() {
            override fun onPlay() = onAction("play")
            override fun onPause() = onAction("pause")
            override fun onStop() {
                clear()
                onAction("stop")
            }
        })

        val filter = IntentFilter().apply {
            addAction(ACTION_TOGGLE)
            addAction(ACTION_STOP)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(actionReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            context.registerReceiver(actionReceiver, filter)
        }
        receiverRegistered = true
    }

    fun updateFromJson(rawJson: String) {
        try {
            val obj = JSONObject(rawJson)
            val shouldClear = obj.optBoolean("clear", false)
            if (shouldClear) {
                clear()
                return
            }
            val title = obj.optString("title", "").ifBlank { "Credo" }
            val artist = obj.optString("artist", "").ifBlank { "Credo Católica" }
            val album = obj.optString("album", "").ifBlank { "Credo" }
            val coverUrl = obj.optString("coverUrl", "")
            val isPlaying = obj.optBoolean("playing", false)

            lastTitle = title
            lastArtist = artist
            lastAlbum = album
            lastPlaying = isPlaying

            val normalizedCover = when {
                coverUrl.startsWith("/") -> "${BuildConfig.CREDO_URL}$coverUrl"
                else -> coverUrl
            }

            postNotification(title, artist, album, isPlaying, cachedBitmapIfSame(normalizedCover))

            if (normalizedCover.isNotBlank() && normalizedCover != cachedCoverUrl) {
                executor.execute {
                    val bmp = downloadBitmap(normalizedCover)
                    if (bmp != null) {
                        cachedCoverUrl = normalizedCover
                        cachedBitmap = bmp
                        postNotification(lastTitle, lastArtist, lastAlbum, lastPlaying, bmp)
                    }
                }
            }
        } catch (_: Exception) {}
    }

    private fun cachedBitmapIfSame(url: String): Bitmap? {
        if (url.isNotBlank() && url == cachedCoverUrl && cachedBitmap != null) return cachedBitmap
        return try {
            BitmapFactory.decodeResource(context.resources, R.mipmap.ic_launcher)
        } catch (_: Exception) {
            null
        }
    }

    private fun downloadBitmap(urlStr: String): Bitmap? {
        return try {
            val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
                connectTimeout = 4000
                readTimeout = 4000
                instanceFollowRedirects = true
            }
            if (conn.responseCode in 200..299) {
                conn.inputStream.use { stream ->
                    val raw = BitmapFactory.decodeStream(stream)
                    raw?.let { Bitmap.createScaledBitmap(it, 256, 256, true) }
                }
            } else null
        } catch (_: Exception) {
            null
        }
    }

    private fun postNotification(
        title: String,
        artist: String,
        album: String,
        isPlaying: Boolean,
        art: Bitmap?
    ) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
            if (!granted) return
        }

        val stateCode = if (isPlaying) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED
        val playbackState = PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_STOP)
            .setState(stateCode, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
            .build()
        mediaSession.setPlaybackState(playbackState)

        val metaBuilder = MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, album)
        if (art != null) metaBuilder.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, art)
        mediaSession.setMetadata(metaBuilder.build())
        mediaSession.isActive = true

        val openIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentPi = PendingIntent.getActivity(
            context, 100, openIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val togglePi = PendingIntent.getBroadcast(
            context, 101, Intent(ACTION_TOGGLE).setPackage(context.packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val stopPi = PendingIntent.getBroadcast(
            context, 102, Intent(ACTION_STOP).setPackage(context.packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val toggleIcon = if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play
        val toggleLabel = if (isPlaying) "Pausar" else "Reproducir"

        @Suppress("DEPRECATION")
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(context, CHANNEL_ID)
        } else {
            Notification.Builder(context)
        }

        builder
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(artist)
            .setSubText(album)
            .setContentIntent(contentPi)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(isPlaying)
            .setOnlyAlertOnce(true)
            .addAction(Notification.Action.Builder(toggleIcon, toggleLabel, togglePi).build())
            .addAction(Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "Detener", stopPi).build())
            .setStyle(
                Notification.MediaStyle()
                    .setMediaSession(mediaSession.sessionToken)
                    .setShowActionsInCompactView(0, 1)
            )
        if (art != null) builder.setLargeIcon(art)

        try {
            nm.notify(NOTIF_ID, builder.build())
        } catch (_: SecurityException) {}
    }

    fun clear() {
        try {
            lastPlaying = false
            mediaSession.isActive = false
            mediaSession.setPlaybackState(
                PlaybackState.Builder().setState(PlaybackState.STATE_STOPPED, 0L, 0f).build()
            )
            nm.cancel(NOTIF_ID)
        } catch (_: Exception) {}
    }

    fun release() {
        clear()
        try {
            if (receiverRegistered) {
                context.unregisterReceiver(actionReceiver)
                receiverRegistered = false
            }
        } catch (_: Exception) {}
        try { mediaSession.release() } catch (_: Exception) {}
        try { executor.shutdownNow() } catch (_: Exception) {}
    }
}
