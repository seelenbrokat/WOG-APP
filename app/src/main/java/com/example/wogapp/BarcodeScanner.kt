package com.example.wogapp

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Bundle
import android.widget.Button
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class BarcodeScanner : AppCompatActivity() {

    private lateinit var scanButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        scanButton = findViewById(R.id.scanButton)
        scanButton.setOnClickListener {
            // Trigger barcode scanning
            Toast.makeText(this, "Scan initiated", Toast.LENGTH_SHORT).show()
        }

        // Register the broadcast receiver for DataWedge
        val filter = IntentFilter()
        filter.addAction("com.symbol.datawedge.api.RESULT_ACTION")
        registerReceiver(barcodeReceiver, filter)
    }

    private val barcodeReceiver: BroadcastReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val barcodeData = intent?.getStringExtra("com.symbol.datawedge.data_string")
            Toast.makeText(context, "Scanned: $barcodeData", Toast.LENGTH_LONG).show()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        unregisterReceiver(barcodeReceiver)
    }
}
