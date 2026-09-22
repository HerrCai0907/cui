package com.herrcai.cui.notifications

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.herrcai.cui.MainActivity
import com.herrcai.cui.R

class SessionCompletionNotifier(private val context: Context) {
    private val notificationManager = context.getSystemService(NotificationManager::class.java)
    private var activityResumed = false
    private var notificationShownForBackground = false
    private var nextNotificationId = INITIAL_NOTIFICATION_ID

    fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Session updates",
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = "Notifies when a CUI session finishes in the background."
        }

        notificationManager.createNotificationChannel(channel)
    }

    @Synchronized
    fun onActivityResumed() {
        activityResumed = true
        notificationShownForBackground = false
    }

    @Synchronized
    fun onActivityPaused() {
        activityResumed = false
    }

    @Synchronized
    fun notifySessionCompleted(sessionId: String, sessionTitle: String) {
        if (activityResumed || notificationShownForBackground || !canPostNotifications()) {
            return
        }

        notificationShownForBackground = true
        notificationManager.notify(
            NOTIFICATION_TAG,
            nextNotificationId++,
            createNotification(sessionId, sessionTitle),
        )
    }

    private fun createNotification(sessionId: String, sessionTitle: String): Notification {
        val launchIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_SESSION_ID, sessionId)
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val contentText = createContentText(sessionTitle)

        return Notification.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Session completed")
            .setContentText(contentText)
            .setStyle(Notification.BigTextStyle().bigText(contentText))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setShowWhen(true)
            .setCategory(Notification.CATEGORY_STATUS)
            .build()
    }

    private fun createContentText(sessionTitle: String): String {
        val title = sessionTitle.trim().replace(Regex("\\s+"), " ")

        if (title.isEmpty()) {
            return "A CUI session finished while the app was in the background."
        }

        return "${title.take(MAX_SESSION_TITLE_LENGTH)} finished while the app was in the background."
    }

    private fun canPostNotifications(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
    }

    private companion object {
        const val CHANNEL_ID = "cui_session_updates"
        const val NOTIFICATION_TAG = "session_completion"
        const val INITIAL_NOTIFICATION_ID = 1
        const val EXTRA_SESSION_ID = "com.herrcai.cui.extra.SESSION_ID"
        const val MAX_SESSION_TITLE_LENGTH = 80
    }
}
