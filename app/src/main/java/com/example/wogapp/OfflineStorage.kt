package com.example.wogapp

import android.content.Context
import android.content.SharedPreferences

class OfflineStorage(context: Context) {

    private val sharedPreferences: SharedPreferences = context.getSharedPreferences("OfflineStorage", Context.MODE_PRIVATE)

    fun saveScanData(sscc: String, data: String) {
        sharedPreferences.edit().putString(sscc, data).apply()
    }

    fun getScanData(sscc: String): String? {
        return sharedPreferences.getString(sscc, null)
    }

    fun removeScanData(sscc: String) {
        sharedPreferences.edit().remove(sscc).apply()
    }

    fun getAllScanData(): Map<String, *> {
        return sharedPreferences.all
    }
}
