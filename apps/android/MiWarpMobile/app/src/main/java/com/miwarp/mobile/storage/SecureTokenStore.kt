package com.miwarp.mobile.storage

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class SecureTokenStore(context: Context) {

    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "miwarp_secure_tokens",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun saveToken(connectionId: String, token: String) {
        prefs.edit().putString(connectionId, token).apply()
    }

    fun getToken(connectionId: String): String? {
        return prefs.getString(connectionId, null)
    }

    fun deleteToken(connectionId: String) {
        prefs.edit().remove(connectionId).apply()
    }

    fun clearAll() {
        prefs.edit().clear().apply()
    }
}
