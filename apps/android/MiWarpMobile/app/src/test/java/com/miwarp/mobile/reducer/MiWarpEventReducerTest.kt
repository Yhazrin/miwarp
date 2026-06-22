package com.miwarp.mobile.reducer

import com.miwarp.mobile.model.BusEvent
import com.miwarp.mobile.model.RunStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class MiWarpEventReducerTest {

    private lateinit var reducer: MiWarpEventReducer

    @Before
    fun setUp() {
        reducer = MiWarpEventReducer()
    }

    @Test
    fun sessionRecovering_setsRecoveringBanner() {
        reducer.reduce(
            BusEvent.SessionRecovering(
                seq = 1,
                runId = "run-1",
                reason = "internal_hard_timeout",
                deadlineMs = 5000,
                fromInternal = true,
            ),
        )

        val recovery = reducer.getProtocolRecovery()
        assertTrue(recovery.isRecovering)
        assertFalse(recovery.showReloadAction)
        assertNotNull(recovery.notice)
    }

    @Test
    fun sessionRecovered_ok_clearsBanner() {
        reducer.reduce(
            BusEvent.SessionRecovering(
                seq = 1,
                runId = "run-1",
                reason = "user_hard_timeout",
                deadlineMs = 5000,
                fromInternal = false,
            ),
        )
        reducer.reduce(BusEvent.SessionRecovered(seq = 2, runId = "run-1", ok = true))

        val recovery = reducer.getProtocolRecovery()
        assertFalse(recovery.isRecovering)
        assertNull(recovery.notice)
    }

    @Test
    fun sessionRecovered_failure_offersReload() {
        reducer.reduce(BusEvent.SessionRecovered(seq = 1, runId = "run-1", ok = false))

        val recovery = reducer.getProtocolRecovery()
        assertTrue(recovery.showReloadAction)
        assertEquals(RunStatus.Failed, reducer.getCurrentStatus())
    }

    @Test
    fun protocolDesync_offersReloadAndFailsRun() {
        reducer.reduce(
            BusEvent.ProtocolDesync(
                seq = 1,
                runId = "run-1",
                failCount = 5,
                sample = "{bad json",
            ),
        )

        val recovery = reducer.getProtocolRecovery()
        assertTrue(recovery.showReloadAction)
        assertEquals(RunStatus.Failed, reducer.getCurrentStatus())
    }
}
