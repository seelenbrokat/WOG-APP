package com.example.wogapp

import android.os.Bundle
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class SettingsActivity : AppCompatActivity() {

    private lateinit var printerIpEditText: EditText
    private lateinit var webApiUrlEditText: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        printerIpEditText = findViewById(R.id.printerIpEditText)
        webApiUrlEditText = findViewById(R.id.webApiUrlEditText)

        // Load saved settings
        loadSettings()
    }

    private fun loadSettings() {
        // Load settings from SharedPreferences or another storage
        Toast.makeText(this, "Settings loaded", Toast.LENGTH_SHORT).show()
    }

    private fun saveSettings() {
        // Save settings to SharedPreferences or another storage
        Toast.makeText(this, "Settings saved", Toast.LENGTH_SHORT).show()
    }
}
