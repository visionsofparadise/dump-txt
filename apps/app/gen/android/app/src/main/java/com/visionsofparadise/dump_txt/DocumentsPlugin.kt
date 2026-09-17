package com.visionsofparadise.dump_txt

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.io.FileNotFoundException

@InvokeArg
class DocumentOptions {
    var title: String? = null
    var fileName: String? = null
    var extensions: Array<String> = emptyArray()
    var writable: Boolean = true
}

@InvokeArg
class ResolveDocumentOptions {
    lateinit var path: String
    var writable: Boolean = true
}

@TauriPlugin
class DocumentsPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun openDocument(invoke: Invoke) {
        launch(invoke, false)
    }

    @Command
    fun createDocument(invoke: Invoke) {
        launch(invoke, true)
    }

    private fun launch(invoke: Invoke, save: Boolean) {
        try {
            val options = invoke.parseArgs(DocumentOptions::class.java)
            val intent = Intent(if (save) Intent.ACTION_CREATE_DOCUMENT else Intent.ACTION_OPEN_DOCUMENT)
            val mimeTypes = options.extensions.mapNotNull {
                MimeTypeMap.getSingleton().getMimeTypeFromExtension(it.lowercase())
            }.distinct()

            intent.addCategory(Intent.CATEGORY_OPENABLE)
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)

            if (options.writable || save) {
                intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            }

            intent.type = if (mimeTypes.size == 1 && !options.extensions.contains("*")) mimeTypes.first() else "*/*"

            if (mimeTypes.size > 1 && !options.extensions.contains("*")) {
                intent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes.toTypedArray())
            }

            if (save) {
                intent.putExtra(Intent.EXTRA_TITLE, options.fileName ?: "page.txt")
            }

            startActivityForResult(invoke, intent, "documentResult")
        } catch (exception: Exception) {
            invoke.reject(exception.message ?: "The document picker could not open.", "io")
        }
    }

    @ActivityCallback
    fun documentResult(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode == Activity.RESULT_CANCELED) {
            invoke.resolve(response(null))
            return
        }

        try {
            if (result.resultCode != Activity.RESULT_OK) {
                throw IllegalStateException("The document picker did not return a selection.")
            }

            val data = result.data ?: throw IllegalStateException("The document picker returned no data.")
            val uri = data.data ?: throw IllegalStateException("The document picker returned no URI.")
            val options = invoke.parseArgs(DocumentOptions::class.java)
            val flags = data.flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)

            if (flags and Intent.FLAG_GRANT_READ_URI_PERMISSION == 0 ||
                options.writable && flags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION == 0) {
                throw SecurityException("The selected document does not allow the required read/write access.")
            }

            activity.contentResolver.takePersistableUriPermission(uri, flags)
            invoke.resolve(response(documentOf(uri, options.fileName)))
        } catch (exception: SecurityException) {
            invoke.reject(exception.message ?: "The document permission could not be retained.", "permission")
        } catch (exception: Exception) {
            invoke.reject(exception.message ?: "The selected document could not be opened.", "io")
        }
    }

    @Command
    fun resolveDocument(invoke: Invoke) {
        try {
            val options = invoke.parseArgs(ResolveDocumentOptions::class.java)
            val uri = Uri.parse(options.path)
            val grant = activity.contentResolver.persistedUriPermissions.find {
                it.uri == uri && it.isReadPermission && (!options.writable || it.isWritePermission)
            }

            if (uri.scheme != "content" || grant == null) {
                invoke.resolve(response(null))
                return
            }

            activity.contentResolver.openFileDescriptor(uri, "r")?.use { }
                ?: throw FileNotFoundException("The saved document is unavailable.")

            invoke.resolve(response(documentOf(uri, null)))
        } catch (_: SecurityException) {
            invoke.resolve(response(null))
        } catch (_: FileNotFoundException) {
            invoke.resolve(response(null))
        } catch (exception: Exception) {
            invoke.reject(exception.message ?: "The saved document could not be resolved.", "io")
        }
    }

    private fun documentOf(uri: Uri, suggestedName: String?): JSObject {
        val resolver = activity.contentResolver
        val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        }
        val document = JSObject()

        document.put("path", uri.toString())
        document.put("name", name?.takeIf { it.isNotBlank() } ?: suggestedName ?: "dump.txt")

        return document
    }

    private fun response(document: JSObject?): JSObject {
        val response = JSObject()

        response.put("document", document ?: JSONObject.NULL)

        return response
    }
}
