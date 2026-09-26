package expo.modules.kagibackground

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Keeps Kagi alive in the background: a foreground service with an ongoing notification, running
 * one headless JS task that never ends on its own. While that task runs, React Native keeps its
 * timers going, so the app keeps talking to the stick over Bluetooth and watching Sepolia.
 */
class KagiBackgroundService : HeadlessJsTaskService() {
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Kagi is running"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Watching for requests from your agents"
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0
    ServiceCompat.startForeground(this, ONGOING_ID, ongoing(this, title, text), type)
    running = true
    // Only the first start runs the task; later starts just refresh the notification.
    return if (taskStarted) START_REDELIVER_INTENT else super.onStartCommand(intent, flags, startId).also { taskStarted = true }
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    // No timeout, and allowed while the app is in front: the task lives as long as the service.
    HeadlessJsTaskConfig(TASK, Arguments.createMap(), 0, true)

  override fun onDestroy() {
    running = false
    taskStarted = false
    super.onDestroy()
  }

  companion object {
    const val TASK = "KagiBackground"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val ONGOING_ID = 4201
    private const val ONGOING_CHANNEL = "kagi-running"
    private const val ALERT_CHANNEL = "kagi-requests"
    @Volatile var running = false
    @Volatile private var taskStarted = false

    private fun channels(ctx: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val nm = ctx.getSystemService(NotificationManager::class.java)
      nm.createNotificationChannel(
        NotificationChannel(ONGOING_CHANNEL, "Running in the background", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Shown while Kagi keeps your stick connected and watches for requests."
          setShowBadge(false)
        },
      )
      nm.createNotificationChannel(
        NotificationChannel(ALERT_CHANNEL, "Requests from agents", NotificationManager.IMPORTANCE_HIGH).apply {
          description = "An agent asks for a higher limit and needs your approval."
          enableVibration(true)
        },
      )
    }

    private fun open(ctx: Context, uri: String?, code: Int): PendingIntent {
      val i = if (uri != null) {
        Intent(Intent.ACTION_VIEW, android.net.Uri.parse(uri)).setPackage(ctx.packageName)
      } else {
        ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: Intent()
      }
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      return PendingIntent.getActivity(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun icon(ctx: Context): Int {
      val id = ctx.resources.getIdentifier("notification_icon", "drawable", ctx.packageName)
      return if (id != 0) id else ctx.applicationInfo.icon
    }

    fun ongoing(ctx: Context, title: String, text: String): Notification {
      channels(ctx)
      return NotificationCompat.Builder(ctx, ONGOING_CHANNEL)
        .setSmallIcon(icon(ctx))
        .setContentTitle(title)
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .setContentIntent(open(ctx, null, 0))
        .build()
    }

    fun alert(ctx: Context, id: Int, title: String, text: String, uri: String) {
      channels(ctx)
      val n = NotificationCompat.Builder(ctx, ALERT_CHANNEL)
        .setSmallIcon(icon(ctx))
        .setContentTitle(title)
        .setContentText(text)
        .setStyle(NotificationCompat.BigTextStyle().bigText(text))
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setAutoCancel(true)
        .setDefaults(NotificationCompat.DEFAULT_ALL)
        .setContentIntent(open(ctx, uri, id))
        .build()
      ctx.getSystemService(NotificationManager::class.java).notify(id, n)
    }

    fun clear(ctx: Context, id: Int) {
      ctx.getSystemService(NotificationManager::class.java).cancel(id)
    }
  }
}
