package com.example.wogapp

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

class WebAPIService(private val context: Context) {

    fun getShipmentData(sscc: String): JSONObject? {
        val jsonString = loadJSONFromAsset() ?: return null
        val jsonArray = JSONArray(jsonString)

        for (i in 0 until jsonArray.length()) {
            val shipment = jsonArray.getJSONObject(i)
            if (shipment.getString("sscc") == sscc) {
                return shipment
            }
        }
        return null
    }

    private fun loadJSONFromAsset(): String? {
        return try {
            val inputStream = context.assets.open("mockdata/sendungen.json")
            val size = inputStream.available()
            val buffer = ByteArray(size)
            inputStream.read(buffer)
            inputStream.close()
            String(buffer, Charsets.UTF_8)
        } catch (ex: IOException) {
            ex.printStackTrace()
            null
        }
    }
}
