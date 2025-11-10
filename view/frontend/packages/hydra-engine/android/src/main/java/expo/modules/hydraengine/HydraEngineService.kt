package expo.modules.hydraengine

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import hydra.Hydra
import java.util.concurrent.Executors

class HydraEngineService : Service() {
  companion object {
    private const val TAG = "HydraEngineService"
    private const val CHANNEL_ID = "hydra_engine_channel"
    private const val NOTIFICATION_ID = 1001
  }

  private val executor = Executors.newSingleThreadExecutor()

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    Log.d(TAG, "Starting")

    val notification = createNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }

    executor.execute {
      try {
        Hydra.startEngine()
        Log.d(TAG, "Engine started")
      } catch (e: Exception) {
        Log.e(TAG, "Failed to start engine", e)
      }
    }

    return START_STICKY
  }

  override fun onDestroy() {
    Log.d(TAG, "Stopping")
    executor.execute {
      try {
        Hydra.stopEngine()
      } catch (e: Exception) {
        Log.e(TAG, "Failed to stop engine", e)
      }
    }
    super.onDestroy()
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    super.onTaskRemoved(rootIntent)
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL_ID, "Hydra Engine", NotificationManager.IMPORTANCE_LOW)
      channel.setShowBadge(false)
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
  }

  private fun createNotification(): Notification {
    val icon = applicationInfo.icon.takeIf { it != 0 } ?: android.R.drawable.ic_dialog_info
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("Hydra Active")
      .setSmallIcon(icon)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .build()
  }
}
