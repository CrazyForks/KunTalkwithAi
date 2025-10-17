package com.example.everytalk.statecontroller

import android.util.Log
import kotlinx.coroutines.*

/**
 * StreamingBuffer - Throttled content accumulator for smooth streaming display
 * 
 * This class implements a buffering mechanism that accumulates streaming content chunks
 * and triggers UI updates at controlled intervals to prevent excessive recomposition.
 * 
 * Key Features:
 * - Throttles updates to maximum once per 300ms
 * - Batches content until 30 characters accumulated
 * - Provides immediate flush for stream completion
 * - Coroutine-based delayed flush mechanism
 * 
 * Requirements addressed: 1.4, 3.2, 3.3, 3.4
 * 
 * @param messageId Unique identifier for the message being streamed
 * @param updateInterval Minimum time between UI updates in milliseconds (default: 300ms)
 * @param batchThreshold Minimum characters to accumulate before triggering update (default: 30)
 * @param onUpdate Callback invoked when buffer content should be committed to UI
 * @param coroutineScope Scope for managing delayed flush coroutines
 */
class StreamingBuffer(
    private val messageId: String,
    private val updateInterval: Long = 300L,
    private val batchThreshold: Int = 30,
    private val onUpdate: (String) -> Unit,
    private val coroutineScope: CoroutineScope
) {
    private val TAG = "StreamingBuffer"
    
    /**
     * Internal buffer for accumulating content chunks
     */
    private val buffer = StringBuilder()
    
    /**
     * Timestamp of the last UI update
     */
    private var lastUpdateTime = 0L
    
    /**
     * Job for pending delayed flush operation
     */
    private var pendingFlushJob: Job? = null
    
    /**
     * Total number of characters processed through this buffer
     */
    private var totalCharsProcessed = 0
    
    /**
     * Number of flush operations performed
     */
    private var flushCount = 0
    
    /**
     * Append content chunk to the buffer
     * 
     * This method accumulates content and triggers UI updates based on:
     * 1. Time threshold: 300ms since last update
     * 2. Size threshold: 30 characters accumulated
     * 
     * If neither threshold is met, schedules a delayed flush to ensure
     * content is eventually displayed even if stream slows down.
     * 
     * @param chunk Text content to append
     */
    fun append(chunk: String) {
        if (chunk.isEmpty()) return
        
        synchronized(buffer) {
            buffer.append(chunk)
            totalCharsProcessed += chunk.length
            
            val currentTime = System.currentTimeMillis()
            val timeSinceLastUpdate = currentTime - lastUpdateTime
            val currentBufferSize = buffer.length
            
            // Check if we should trigger immediate update
            val shouldUpdateByTime = timeSinceLastUpdate >= updateInterval
            val shouldUpdateBySize = currentBufferSize >= batchThreshold
            
            if (shouldUpdateByTime || shouldUpdateBySize) {
                // Cancel any pending delayed flush since we're flushing now
                pendingFlushJob?.cancel()
                pendingFlushJob = null
                
                performFlush(currentTime)
                
                Log.d(TAG, "[$messageId] Immediate flush: time=$shouldUpdateByTime, size=$shouldUpdateBySize, " +
                        "bufferSize=$currentBufferSize, timeSince=${timeSinceLastUpdate}ms")
            } else {
                // Schedule delayed flush if not already scheduled
                if (pendingFlushJob == null || pendingFlushJob?.isActive == false) {
                    scheduleDelayedFlush()
                }
            }
        }
    }
    
    /**
     * Schedule a delayed flush operation
     * 
     * This ensures content is eventually displayed even if the stream
     * slows down and thresholds are not met. The delay is calculated
     * to trigger at the next update interval boundary.
     */
    private fun scheduleDelayedFlush() {
        val currentTime = System.currentTimeMillis()
        val timeSinceLastUpdate = currentTime - lastUpdateTime
        val delayUntilNextUpdate = (updateInterval - timeSinceLastUpdate).coerceAtLeast(0)
        
        pendingFlushJob = coroutineScope.launch {
            delay(delayUntilNextUpdate)
            synchronized(buffer) {
                if (buffer.isNotEmpty()) {
                    performFlush(System.currentTimeMillis())
                    Log.d(TAG, "[$messageId] Delayed flush executed")
                }
            }
        }
    }
    
    /**
     * Perform the actual flush operation
     * 
     * Must be called within synchronized(buffer) block
     * 
     * @param currentTime Current timestamp for tracking
     */
    private fun performFlush(currentTime: Long) {
        if (buffer.isEmpty()) return
        
        val content = buffer.toString()
        val contentLength = content.length
        buffer.clear()
        lastUpdateTime = currentTime
        flushCount++
        
        // 🎯 Task 11: Add logging for buffer flush frequency
        // Log every 5th flush to track performance without overwhelming logs
        // Requirements: 1.4, 3.4
        if (flushCount % 5 == 0) {
            val avgCharsPerFlush = if (flushCount > 0) totalCharsProcessed / flushCount else 0
            Log.d(TAG, "[$messageId] Buffer flush #$flushCount: " +
                    "contentLen=$contentLength, " +
                    "totalChars=$totalCharsProcessed, " +
                    "avgPerFlush=$avgCharsPerFlush, " +
                    "timeSinceLastFlush=${currentTime - lastUpdateTime}ms")
        }
        
        // Invoke callback outside synchronized block to prevent deadlock
        try {
            onUpdate(content)
        } catch (e: Exception) {
            Log.e(TAG, "[$messageId] Error in onUpdate callback", e)
        }
    }
    
    /**
     * Immediately flush all buffered content to UI
     * 
     * This method should be called when:
     * - Stream completes successfully
     * - Stream encounters an error
     * - User cancels the stream
     * 
     * Cancels any pending delayed flush operations.
     */
    fun flush() {
        synchronized(buffer) {
            // Cancel pending delayed flush
            pendingFlushJob?.cancel()
            pendingFlushJob = null
            
            if (buffer.isNotEmpty()) {
                performFlush(System.currentTimeMillis())
                Log.d(TAG, "[$messageId] Manual flush: ${buffer.length} chars")
            }
        }
    }
    
    /**
     * Get current buffered content without flushing
     * 
     * @return Current content in buffer
     */
    fun getCurrentContent(): String {
        synchronized(buffer) {
            return buffer.toString()
        }
    }
    
    /**
     * Get total accumulated content length
     * 
     * @return Number of characters currently in buffer
     */
    fun getCurrentLength(): Int {
        synchronized(buffer) {
            return buffer.length
        }
    }
    
    /**
     * Clear buffer and reset state
     * 
     * This method should be called when:
     * - Starting a new stream for the same message
     * - Cleaning up after stream completion
     * - Handling errors or cancellation
     * 
     * Cancels any pending delayed flush operations.
     */
    fun clear() {
        synchronized(buffer) {
            // Cancel pending delayed flush
            pendingFlushJob?.cancel()
            pendingFlushJob = null
            
            buffer.clear()
            lastUpdateTime = 0L
            
            // 🎯 Task 11: Add performance metrics to debug logs
            // Log final statistics when buffer is cleared
            // Requirements: 1.4, 3.4
            val avgCharsPerFlush = if (flushCount > 0) totalCharsProcessed / flushCount else 0
            val avgFlushInterval = if (flushCount > 1) {
                (System.currentTimeMillis() - lastUpdateTime) / flushCount
            } else 0L
            
            Log.d(TAG, "[$messageId] Buffer cleared. Performance stats: " +
                    "totalChars=$totalCharsProcessed, " +
                    "flushes=$flushCount, " +
                    "avgCharsPerFlush=$avgCharsPerFlush, " +
                    "avgFlushInterval=${avgFlushInterval}ms")
        }
    }
    
    /**
     * Get buffer statistics for debugging and monitoring
     * 
     * @return Map containing buffer statistics
     */
    fun getStats(): Map<String, Any> {
        synchronized(buffer) {
            return mapOf(
                "messageId" to messageId,
                "currentBufferSize" to buffer.length,
                "totalCharsProcessed" to totalCharsProcessed,
                "flushCount" to flushCount,
                "hasPendingFlush" to (pendingFlushJob?.isActive == true),
                "timeSinceLastUpdate" to (System.currentTimeMillis() - lastUpdateTime)
            )
        }
    }
    
    /**
     * Check if buffer has pending content
     * 
     * @return true if buffer contains unflushed content
     */
    fun hasPendingContent(): Boolean {
        synchronized(buffer) {
            return buffer.isNotEmpty()
        }
    }
}
