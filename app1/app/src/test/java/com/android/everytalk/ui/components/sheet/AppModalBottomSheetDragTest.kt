package com.android.everytalk.ui.components.sheet

import android.app.Application
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipe
import androidx.compose.ui.unit.dp
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** 注入真实触摸事件，验证把手留白和正文滚动区拥有不同的收起规则。 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
@OptIn(ExperimentalMaterial3Api::class)
class AppModalBottomSheetDragTest {
    @get:Rule val rule = createComposeRule()
    private lateinit var scroll: ScrollState

    private fun open(longContent: Boolean = true) {
        rule.setContent {
            var visible by remember { mutableStateOf(true) }
            scroll = rememberScrollState()
            MaterialTheme {
                if (visible) AppModalBottomSheet(
                    onDismissRequest = { visible = false },
                    scrollState = scroll,
                    sheetContentModifier = Modifier.testTag("sheet"),
                    dragHandleModifier = Modifier.testTag("handle"),
                    scrollModifier = Modifier.testTag("body"),
                    header = {},
                ) {
                    Box(Modifier.fillMaxWidth().height(if (longContent) 3000.dp else 80.dp))
                }
            }
        }
        rule.waitForIdle()
    }

    @Test
    fun `正文在中间时拖动把手留白可以完全关闭`() {
        open()
        rule.runOnIdle { scroll.dispatchRawDelta(600f); assertTrue(scroll.value > 0) }
        val previousScroll = scroll.value
        rule.onNodeWithTag("handle", useUnmergedTree = true).performTouchInput {
            val start = center.copy(x = left + 16f)
            swipe(start, start.copy(y = start.y + 1200f), durationMillis = 500L)
        }
        rule.waitForIdle()
        assertTrue(rule.onAllNodesWithTag("sheet").fetchSemanticsNodes().isEmpty())
        assertEquals("把手拖动不能先把正文滚回顶部", previousScroll, scroll.value)
    }

    @Test
    fun `把手手势结束后正文下拉仍然只滚动正文`() {
        open()
        rule.runOnIdle { scroll.dispatchRawDelta(600f) }
        rule.onNodeWithTag("handle", useUnmergedTree = true).performTouchInput {
            swipe(center, center.copy(y = center.y - 30f), durationMillis = 500L)
        }
        rule.waitForIdle()
        val before = scroll.value
        val top = rule.onNodeWithTag("sheet").fetchSemanticsNode().boundsInRoot.top
        rule.onNodeWithTag("body").performTouchInput {
            swipe(center, center.copy(y = center.y + 80f), durationMillis = 500L)
        }
        rule.waitForIdle()
        assertTrue(scroll.value in 1 until before)
        assertEquals(top, rule.onNodeWithTag("sheet").fetchSemanticsNode().boundsInRoot.top, 1f)
    }

    @Test
    fun `短内容把手下拉同样彻底关闭`() {
        open(longContent = false)
        rule.onNodeWithTag("handle", useUnmergedTree = true).performTouchInput {
            swipe(center, center.copy(y = center.y + 700f), durationMillis = 500L)
        }
        rule.waitForIdle()
        assertTrue(rule.onAllNodesWithTag("sheet").fetchSemanticsNodes().isEmpty())
    }
}
