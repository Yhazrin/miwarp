package com.miwarp.mobile.storage

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.miwarp.mobile.model.MiWarpConnection
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private val Context.connectionDataStore: DataStore<Preferences> by preferencesDataStore(name = "miwarp_connections")

class ConnectionStore(private val context: Context) {
    private val json = Json { ignoreUnknownKeys = true }

    companion object {
        private val CONNECTIONS_KEY = stringPreferencesKey("connections")
        private val ACTIVE_CONNECTION_ID_KEY = stringPreferencesKey("active_connection_id")
        private val LAST_SYNC_KEY = longPreferencesKey("last_sync")
    }

    val connections: Flow<List<MiWarpConnection>> = context.connectionDataStore.data.map { prefs ->
        val raw = prefs[CONNECTIONS_KEY] ?: return@map emptyList()
        try {
            json.decodeFromString<List<MiWarpConnection>>(raw)
        } catch (_: Exception) {
            emptyList()
        }
    }

    val activeConnectionId: Flow<String?> = context.connectionDataStore.data.map { prefs ->
        prefs[ACTIVE_CONNECTION_ID_KEY]
    }

    val activeConnection: Flow<MiWarpConnection?> = context.connectionDataStore.data.map { prefs ->
        val connList = prefs[CONNECTIONS_KEY]?.let {
            try { json.decodeFromString<List<MiWarpConnection>>(it) } catch (_: Exception) { null }
        } ?: return@map null
        val activeId = prefs[ACTIVE_CONNECTION_ID_KEY]
        connList.find { it.id == activeId }
    }

    suspend fun saveConnection(connection: MiWarpConnection) {
        context.connectionDataStore.edit { prefs ->
            val current = prefs[CONNECTIONS_KEY]?.let {
                try { json.decodeFromString<MutableList<MiWarpConnection>>(it) } catch (_: Exception) { mutableListOf() }
            } ?: mutableListOf()
            val index = current.indexOfFirst { it.id == connection.id }
            if (index >= 0) {
                current[index] = connection
            } else {
                current.add(connection)
            }
            prefs[CONNECTIONS_KEY] = json.encodeToString(current)
        }
    }

    suspend fun removeConnection(id: String) {
        context.connectionDataStore.edit { prefs ->
            val current = prefs[CONNECTIONS_KEY]?.let {
                try { json.decodeFromString<MutableList<MiWarpConnection>>(it) } catch (_: Exception) { mutableListOf() }
            } ?: mutableListOf()
            current.removeAll { it.id == id }
            prefs[CONNECTIONS_KEY] = json.encodeToString(current)
            if (prefs[ACTIVE_CONNECTION_ID_KEY] == id) {
                prefs.remove(ACTIVE_CONNECTION_ID_KEY)
            }
        }
    }

    suspend fun setActiveConnection(id: String) {
        context.connectionDataStore.edit { prefs ->
            prefs[ACTIVE_CONNECTION_ID_KEY] = id
            // Update lastConnectedAt
            val current = prefs[CONNECTIONS_KEY]?.let {
                try { json.decodeFromString<MutableList<MiWarpConnection>>(it) } catch (_: Exception) { mutableListOf() }
            } ?: mutableListOf()
            val index = current.indexOfFirst { it.id == id }
            if (index >= 0) {
                current[index] = current[index].copy(lastConnectedAt = System.currentTimeMillis())
                prefs[CONNECTIONS_KEY] = json.encodeToString(current)
            }
        }
    }

    suspend fun getConnections(): List<MiWarpConnection> {
        return connections.first()
    }

    suspend fun clearAll() {
        context.connectionDataStore.edit { it.clear() }
    }
}
