package com.visionsofparadise.dump_txt

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    val content = findViewById<View>(android.R.id.content)
    val insetTypes = WindowInsetsCompat.Type.systemBars() or
      WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()

    ViewCompat.setOnApplyWindowInsetsListener(content) { view, windowInsets ->
      val safeArea = windowInsets.getInsets(insetTypes)

      view.setPadding(safeArea.left, safeArea.top, safeArea.right, safeArea.bottom)

      WindowInsetsCompat.Builder(windowInsets)
        .setInsets(insetTypes, Insets.NONE)
        .build()
    }
    ViewCompat.requestApplyInsets(content)
  }
}
