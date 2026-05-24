package com.miwarp.mobile.util

import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList

object Logger {
    private const val TAG = "MiWarp"
    private const val MAX_BUFFER_SIZE = 500

    var isDebug: Boolean = true

    private val buffer = CopyOnWriteArrayList<LogEntry>()

    data class LogEntry(
        val timestamp: Long = System.currentTimeMillis(),
        val level: Level,
        val category: Category,
        val message: String,
    ) {
        enum class Level { DEBUG, INFO, WARNING, ERROR }
        enum class Category { GENERAL, WEBSOCKET, RPC, EVENTS }
    }

    // Token redaction — replace any token-like strings in log output
    private fun redact(message: String): String {
        // Match token query param: token=<value>
        return message.replace(Regex("(token=)[^&\\s]+"), "${1}[REDACTED]")
            // Match bearer-style tokens
            .replace(Regex("(Bearer\\s+)\\S+"), "${1}[REDACTED]")
    }

    private fun appendToBuffer(level: LogEntry.Level, category: LogEntry.Category, message: String) {
        buffer.add(LogEntry(level = level, category = category, message = message))
        if (buffer.size > MAX_BUFFER_SIZE) {
            val toRemove = buffer.size - MAX_BUFFER_SIZE
            repeat(toRemove) { buffer.removeFirstOrNull() }
        }
    }

    // ── General ──────────────────────────────────────────────────────────────

    fun d(message: String, tag: String = TAG) {
        if (isDebug) {
            val safe = redact(message)
            Log.d(tag, safe)
            appendToBuffer(LogEntry.Level.DEBUG, LogEntry.Category.GENERAL, safe)
        }
    }

    fun i(message: String, tag: String = TAG) {
        val safe = redact(message)
        Log.i(tag, safe)
        appendToBuffer(LogEntry.Level.INFO, LogEntry.Category.GENERAL, safe)
    }

    fun w(message: String, throwable: Throwable? = null, tag: String = TAG) {
        val safe = redact(message)
        if (throwable != null) Log.w(tag, safe, throwable) else Log.w(tag, safe)
        appendToBuffer(LogEntry.Level.WARNING, LogEntry.Category.GENERAL, safe)
    }

    fun e(message: String, throwable: Throwable? = null, tag: String = TAG) {
        val safe = redact(message)
        if (throwable != null) Log.e(tag, safe, throwable) else Log.e(tag, safe)
        appendToBuffer(LogEntry.Level.ERROR, LogEntry.Category.GENERAL, safe)
    }

    // ── WebSocket ────────────────────────────────────────────────────────────

    fun wsDebug(message: String) {
        if (isDebug) {
            val safe = redact(message)
            Log.d("$TAG:WS", safe)
            appendToBuffer(LogEntry.Level.DEBUG, LogEntry.Category.WEBSOCKET, safe)
        }
    }

    fun wsInfo(message: String) {
        val safe = redact(message)
        Log.i("$TAG:WS", safe)
        appendToBuffer(LogEntry.Level.INFO, LogEntry.Category.WEBSOCKET, safe)
    }

    fun wsError(message: String, throwable: Throwable? = null) {
        val safe = redact(message)
        if (throwable != null) Log.e("$TAG:WS", safe, throwable) else Log.e("$TAG:WS", safe)
        appendToBuffer(LogEntry.Level.ERROR, LogEntry.Category.WEBSOCKET, safe)
    }

    // ── RPC ──────────────────────────────────────────────────────────────────

    fun rpcDebug(message: String) {
        if (isDebug) {
            val safe = redact(message)
            Log.d("$TAG:RPC", safe)
            appendToBuffer(LogEntry.Level.DEBUG, LogEntry.Category.RPC, safe)
        }
    }

    fun rpcInfo(message: String) {
        val safe = redact(message)
        Log.i("$TAG:RPC", safe)
        appendToBuffer(LogEntry.Level.INFO, LogEntry.Category.RPC, safe)
    }

    fun rpcError(message: String, throwable: Throwable? = null) {
        val safe = redact(message)
        if (throwable != null) Log.e("$TAG:RPC", safe, throwable) else Log.e("$TAG:RPC", safe)
        appendToBuffer(LogEntry.Level.ERROR, LogEntry.Category.RPC, safe)
    }

    // ── Events ───────────────────────────────────────────────────────────────

    fun eventDebug(message: String) {
        if (isDebug) {
            val safe = redact(message)
            Log.d("$TAG:EVT", safe)
            appendToBuffer(LogEntry.Level.DEBUG, LogEntry.Category.EVENTS, safe)
        }
    }

    fun eventInfo(message: String) {
        val safe = redact(message)
        Log.i("$TAG:EVT", safe)
        appendToBuffer(LogEntry.Level.INFO, LogEntry.Category.EVENTS, safe)
    }

    // ── Buffer access ────────────────────────────────────────────────────────

    fun recentLogs(): List<LogEntry> = buffer.toList()

    fun clearLogs() {
        buffer.clear()
    }
}
