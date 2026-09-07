package com.android.everytalk.util

import android.app.Application
import android.content.Context
import android.os.Looper
import android.view.accessibility.AccessibilityManager
import android.widget.Toast
import androidx.test.core.app.ApplicationProvider
import java.time.Duration
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import org.robolectric.shadows.ShadowToast

/** 用虚拟主线程时钟验证提示时长和替换，不依赖真实等待或系统动画。 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
@LooperMode(LooperMode.Mode.PAUSED)
class AppToastTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext<Application>()
    private fun advance(millis: Long) = shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(millis))

    @Before
    fun setUp() {
        AppToast.dismiss()
        ShadowToast.reset()
    }

    @After
    fun tearDown() = AppToast.dismiss()

    @Test
    fun `普通通知1500毫秒关闭`() {
        AppToast.show(context, "任务已停止")
        val toast = ShadowToast.getLatestToast()
        assertEquals(Toast.LENGTH_SHORT, toast.duration)
        advance(1499)
        assertFalse(shadowOf(toast).isCancelled)
        advance(1)
        assertTrue(shadowOf(toast).isCancelled)
    }

    @Test
    fun `新通知立即取消旧通知且旧计时器不影响新通知`() {
        AppToast.show(context, "first")
        val first = ShadowToast.getLatestToast()
        advance(500)
        AppToast.show(context, "second")
        val second = ShadowToast.getLatestToast()
        assertTrue(shadowOf(first).isCancelled)
        advance(1000)
        assertFalse(shadowOf(second).isCancelled)
        advance(500)
        assertTrue(shadowOf(second).isCancelled)
    }

    @Test
    fun `相同通知不重复显示也不延长到期时间`() {
        AppToast.show(context, "same")
        advance(1000)
        AppToast.show(context, "same")
        assertEquals(1, ShadowToast.shownToastCount())
        advance(500)
        assertTrue(shadowOf(ShadowToast.getLatestToast()).isCancelled)
        AppToast.show(context, "same")
        assertEquals(2, ShadowToast.shownToastCount())
    }

    @Test
    fun `长通知保留阅读时间空通知不打断现有通知`() {
        AppToast.show(context, "long message ".repeat(5))
        val toast = ShadowToast.getLatestToast()
        AppToast.show(context, "  ")
        assertEquals(1, ShadowToast.shownToastCount())
        assertEquals(Toast.LENGTH_LONG, toast.duration)
        advance(1500)
        assertFalse(shadowOf(toast).isCancelled)
        advance(1500)
        assertTrue(shadowOf(toast).isCancelled)
    }

    @Test
    fun `后台线程也通过主线程显示`() {
        Thread { AppToast.show(context, "worker") }.apply { start(); join() }
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals("worker", ShadowToast.getTextOfLatestToast())
    }

    @Test
    fun `无障碍建议时长不会被短提示提前取消`() {
        val manager = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
        shadowOf(manager).setNonInteractiveUiTimeout(6000)
        AppToast.show(context, "accessible")
        val toast = ShadowToast.getLatestToast()
        advance(1500)
        assertFalse(shadowOf(toast).isCancelled)
        advance(4500)
        assertTrue(shadowOf(toast).isCancelled)
    }

    @Test
    @Config(sdk = [28])
    fun `旧系统读屏开启时不主动截断系统Toast`() {
        val manager = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
        shadowOf(manager).setTouchExplorationEnabled(true)
        AppToast.show(context, "accessible legacy")
        val toast = ShadowToast.getLatestToast()
        advance(3000)
        assertFalse(shadowOf(toast).isCancelled)
    }

    @Test
    fun `取消后可以立即重显相同通知`() {
        AppToast.show(context, "repeat")
        val toast = ShadowToast.getLatestToast()
        AppToast.dismiss()
        assertTrue(shadowOf(toast).isCancelled)
        AppToast.show(context, "repeat")
        assertEquals(2, ShadowToast.shownToastCount())
    }
}
