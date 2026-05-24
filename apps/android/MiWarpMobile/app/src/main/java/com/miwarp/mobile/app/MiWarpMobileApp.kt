package com.miwarp.mobile.app

import android.app.Application
import com.miwarp.mobile.rpc.MiWarpRpcClient
import com.miwarp.mobile.storage.ConnectionStore
import com.miwarp.mobile.storage.SecureTokenStore
import com.miwarp.mobile.util.Logger

class MiWarpMobileApp : Application() {

    lateinit var connectionStore: ConnectionStore
        private set

    lateinit var secureTokenStore: SecureTokenStore
        private set

    lateinit var rpcClient: MiWarpRpcClient
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this

        Logger.i("MiWarpMobileApp initializing")

        connectionStore = ConnectionStore(applicationContext)
        secureTokenStore = SecureTokenStore(applicationContext)
        rpcClient = MiWarpRpcClient()
    }

    companion object {
        lateinit var instance: MiWarpMobileApp
            private set
    }
}
