package com.android.everytalk.util

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityManager
import android.widget.Toast
import androidx.annotation.StringRes
import com.android.everytalk.util.locale.localizeUiMessage

/**
 * 所有瞬时提示共用系统文字 Toast：在图片 Dialog、键盘上方也可见，不持有 Activity。
 * 主线程串行替换旧提示；相同提示在可见期间去重，避免连续点击延长遮挡。
 * 系统负责圆角、字体和无障碍朗读，不使用已废弃的自定义 Toast View。
 */
object AppToast {
    internal const val SHORT_TIMEOUT_MS = 1_500L
    internal const val LONG_TIMEOUT_MS = 3_000L
    private val handler by lazy { Handler(Looper.getMainLooper()) }
    private var currentToast: Toast? = null
    private var currentText: String? = null
    private var dismissTask: Runnable? = null

    fun show(context: Context, @StringRes messageRes: Int) = show(context, context.getString(messageRes))

    fun show(context: Context, message: String) {
        val text = context.localizeUiMessage(message).trim()
        if (text.isEmpty()) return
        val application = context.applicationContext
        if (Looper.myLooper() != Looper.getMainLooper()) {
            handler.post { show(application, text) }
            return
        }
        if (currentText == text) return
        dismiss()
        val baseTimeout = if (text.length > 40 || '\n' in text) LONG_TIMEOUT_MS else SHORT_TIMEOUT_MS
        val accessibility = application.getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager
        val timeout = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            accessibility?.getRecommendedTimeoutMillis(baseTimeout.toInt(), AccessibilityManager.FLAG_CONTENT_TEXT)
                ?.toLong()?.coerceAtLeast(baseTimeout) ?: baseTimeout
        } else {
            // 旧 Android 无建议时长 API；读屏开启时交还系统控制，不能强行缩短朗读。
            if (accessibility?.isTouchExplorationEnabled == true) null else baseTimeout
        }
        val toast = Toast.makeText(application, text,
            if (timeout == null || timeout > SHORT_TIMEOUT_MS) Toast.LENGTH_LONG else Toast.LENGTH_SHORT)
        currentToast = toast
        currentText = text
        toast.show()
        // 按实例清理，旧提示的到期任务绝不能关闭刚替换的新提示。
        val cleanup = Runnable {
            if (currentToast === toast) {
                if (timeout != null) toast.cancel()
                currentToast = null
                currentText = null
                dismissTask = null
            }
        }
        dismissTask = cleanup
        handler.postDelayed(cleanup, timeout ?: LONG_TIMEOUT_MS)
    }

    /** 页面退出和测试收尾均可清理；不遗留旧提示及到期回调。 */
    fun dismiss() {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            handler.post { dismiss() }
            return
        }
        dismissTask?.let(handler::removeCallbacks)
        dismissTask = null
        currentToast?.cancel()
        currentToast = null
        currentText = null
    }
}
