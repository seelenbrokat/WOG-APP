package com.example.wogapp

import java.io.OutputStream
import java.net.Socket

class PrinterService(private val printerIp: String, private val printerPort: Int = 9100) {

    fun printLabel(labelData: String) {
        try {
            val socket = Socket(printerIp, printerPort)
            val outputStream: OutputStream = socket.getOutputStream()
            outputStream.write(labelData.toByteArray())
            outputStream.flush()
            outputStream.close()
            socket.close()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
}
