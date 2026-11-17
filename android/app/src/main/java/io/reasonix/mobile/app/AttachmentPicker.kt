package io.reasonix.mobile.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.MediaStore
import android.webkit.WebChromeClient
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Where a photo comes from, when the page asks for an attachment.
 *
 * A WebView answers an `<input type="file">` with one system picker, which on
 * Android opens the document browser and nothing else — the camera is not among
 * its sources and the gallery is a level down. The three entries a phone
 * composer actually offers (拍照 / 相册 / 文件) are therefore a choice this shell
 * makes before any picker starts, which is what this class is.
 *
 * Every branch ends in the same place: `content://` URIs handed back to the
 * WebView's own callback. A capture goes through `FileProvider` because a camera
 * app cannot write into this app's storage by itself; a gallery pick is
 * read-only, so the grant stays one file.
 */
internal class AttachmentPicker(
    private val activity: AppCompatActivity,
    private val onChosen: (List<Uri>) -> Unit,
    private val onCancelled: () -> Unit,
    /** Ask for the camera permission, answer whether it is now held. Set by the
     *  activity, which owns the request; a plain check would leave a first-time
     *  person with a menu entry that silently cancels. */
    private val ensureCamera: () -> Boolean = {
        ContextCompat.checkSelfPermission(activity, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
    },
) {

    /** The file a capture is written into, held between "take a photo" and the
     *  camera app answering. */
    private var captureTarget: File? = null

    /** The request the page made, carried into the file branch. */
    private var pageIntent: Intent? = null
    private var allowMultiple = false

    private val capture: ActivityResultLauncher<Intent> = activity.registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val file = captureTarget
        captureTarget = null
        // A camera app that wrote nothing still answers RESULT_OK on some
        // devices, and an empty file attached to a turn is worse than no
        // attachment: the model reads a blank image and says it sees nothing.
        if (result.resultCode != Activity.RESULT_OK || file == null || !file.isFile || file.length() == 0L) {
            file?.delete()
            onCancelled()
            return@registerForActivityResult
        }
        onChosen(listOf(Uri.fromFile(file)))
    }

    private val gallery: ActivityResultLauncher<Intent> = activity.registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode != Activity.RESULT_OK) {
            onCancelled()
            return@registerForActivityResult
        }
        onChosen(readableUris(result.data))
    }

    private val documents: ActivityResultLauncher<Intent> = activity.registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode != Activity.RESULT_OK) {
            onCancelled()
            return@registerForActivityResult
        }
        onChosen(readableUris(result.data))
    }

    /**
     * The URIs a picker answered with, from the clip data first.
     *
     * `FileChooserParams.parseResult` is deliberately not used: its WebView
     * implementation answers null whenever the result carries no
     * `Intent.getData()`, which is exactly how a multi-selection arrives.
     */
    private fun readableUris(data: Intent?): List<Uri> {
        if (data == null) return emptyList()
        val picked = LinkedHashSet<Uri>()
        data.clipData?.let { clip ->
            for (index in 0 until clip.itemCount) clip.getItemAt(index)?.uri?.let(picked::add)
        }
        data.data?.let(picked::add)
        return picked.toList()
    }

    /**
     * Ask where the attachment comes from, then start that source.
     *
     * `params` is the WebView's own request: its `accept` types and `multiple`
     * flag are carried into the two branches that can honour them, so a page
     * asking for images is not offered a PDF browser.
     */
    fun ask(params: WebChromeClient.FileChooserParams) {
        pageIntent = params.createIntent()
        allowMultiple = params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE
        val options = arrayOf(
            activity.getString(R.string.attach_camera),
            activity.getString(R.string.attach_gallery),
            activity.getString(R.string.attach_file),
        )
        AlertDialog.Builder(activity)
            .setTitle(R.string.attach_title)
            .setItems(options) { _, which ->
                when (which) {
                    0 -> takePhoto()
                    1 -> openGallery()
                    else -> openDocuments()
                }
            }
            // Backing out is a dismissal, and the page's file input has to hear
            // about it or the attachment button stays mid-request.
            .setOnCancelListener { onCancelled() }
            .show()
    }

    private fun takePhoto() {
        if (!ensureCamera()) {
            onCancelled()
            return
        }
        val dir = File(activity.cacheDir, "captures").apply { mkdirs() }
        val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
        val file = File(dir, "capture-$stamp.jpg")
        captureTarget = file
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.captures", file)
        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            // The camera app reads and writes this one URI and nothing else.
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        }
        if (!starts(capture, intent)) {
            file.delete()
            captureTarget = null
            onCancelled()
        }
    }

    private fun openGallery() {
        val picker = Intent(MediaStore.ACTION_PICK_IMAGES)
        if (!allowMultiple) picker.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, 1)
        if (starts(gallery, picker)) return
        // No photo picker here — an AOSP build without the MediaProvider one, or
        // a vendor ROM that hid it. The generic chooser reaches the same photos
        // through whatever gallery app is installed.
        val fallback = Intent(Intent.ACTION_GET_CONTENT).apply {
            type = "image/*"
            if (allowMultiple) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        if (!starts(gallery, fallback)) onCancelled()
    }

    private fun openDocuments() {
        val intent = pageIntent ?: run {
            onCancelled()
            return
        }
        if (!starts(documents, intent)) onCancelled()
    }

    /** Start an activity result, answering false when no app claims it. */
    private fun starts(slot: ActivityResultLauncher<Intent>, intent: Intent): Boolean =
        runCatching { slot.launch(intent) }.isSuccess
}
