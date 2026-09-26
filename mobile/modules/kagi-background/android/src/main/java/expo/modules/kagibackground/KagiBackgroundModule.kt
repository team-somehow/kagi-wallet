package expo.modules.kagibackground

import android.content.Context
import android.content.Intent
import android.app.NotificationManager
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class KagiBackgroundModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("KagiBackground")

    /** Start the foreground service, or refresh its notification if it already runs. */
    Function("start") { title: String, text: String ->
      val i = Intent(context, KagiBackgroundService::class.java)
        .putExtra(KagiBackgroundService.EXTRA_TITLE, title)
        .putExtra(KagiBackgroundService.EXTRA_TEXT, text)
      ContextCompat.startForegroundService(context, i)
    }

    /** Change what the ongoing notification says, without restarting anything. */
    Function("update") { title: String, text: String ->
      if (KagiBackgroundService.running) {
        context.getSystemService(NotificationManager::class.java)
          .notify(KagiBackgroundService.ONGOING_ID, KagiBackgroundService.ongoing(context, title, text))
      }
    }

    Function("stop") {
      context.stopService(Intent(context, KagiBackgroundService::class.java))
    }

    Function("isRunning") { KagiBackgroundService.running }

    /** A heads-up notification that opens the app at uri when tapped. */
    Function("alert") { id: Int, title: String, text: String, uri: String ->
      KagiBackgroundService.alert(context, id, title, text, uri)
    }

    Function("clearAlert") { id: Int ->
      KagiBackgroundService.clear(context, id)
    }
  }
}
