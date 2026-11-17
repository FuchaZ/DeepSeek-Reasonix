package io.reasonix.mobile.app

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * What the page can ask the phone for.
 *
 * This is the whole surface, and it is deliberately tiny. Android's
 * `@JavascriptInterface` is a bridge into the app's process from a WebView whose
 * content is a web page: every method here is reachable by anything that can run
 * script in that page, so each one is written as a verb with no address
 * parameter it does not need.
 *
 * It is deliberately *not* the Electron preload bridge. That one exposes window
 * management, a filesystem walker, an editor launcher and a browser view host —
 * all of which are meaningless on a phone. What a phone can honestly add is the
 * three answers a page cannot give itself: leaving the app for a real browser, a
 * folder picker, and putting a file where the person chose.
 */
class NativeBridge(
    private val onOpen: (String) -> Unit,
) {

    /**
     * Whether the document calling may use this bridge.
     *
     * `addJavascriptInterface` makes the object reachable from whatever page the
     * WebView holds, so a page that navigated this window elsewhere would
     * otherwise get `hostCall` and the picker. The activity answers by comparing
     * the main frame's origin against the kernel's own.
     */
    var trusted: () -> Boolean = { false }

    /**
     * Open a URL in the device's browser.
     *
     * The page asks for this when a link points somewhere outside the kernel —
     * a provider's console, a documentation page — and loading it in place would
     * strand the person in a window with no address bar and no way back.
     */
    @JavascriptInterface
    fun openExternal(url: String) {
        if (!trusted()) return
        // Only what a browser can open. A `file://` or `content://` here would
        // be the page reaching into the device through a method named for
        // leaving it.
        if (!url.startsWith("http://") && !url.startsWith("https://")) return
        onOpen(url)
    }

    /** How the activity handles an async host call. Set by the activity. */
    var onHostCall: ((id: String, method: String, args: String) -> Unit)? = null

    /**
     * Entry point for the page's `window.reasonixHost` Promise methods.
     *
     * `id` is a unique call identifier the JS side generated; `method` is the
     * method name (for example "pickFolder"); `args` is the JSON-encoded
     * argument array. The activity answers through
     * `window.__reasonixHostReply(id, resultJson)`.
     */
    @JavascriptInterface
    fun hostCall(id: String, method: String, args: String) {
        if (!trusted()) return
        onHostCall?.invoke(id, method, args)
    }

    /** The main thread, because starting an Activity result must happen there. */
    private val main = Handler(Looper.getMainLooper())

    /**
     * How to put bytes where the person picks. Set by the activity, which owns
     * the Activity Result API; it answers whether the ask was dispatched, and
     * the chosen place arrives through `deliverSave`.
     */
    var askForSave: (name: String, bytes: ByteArray) -> Boolean = { _, _ -> false }

    private val saveTarget = AtomicReference<Uri?>(null)
    private val saveLatch = AtomicReference<CountDownLatch?>(null)

    /**
     * Write bytes where the person picks, and answer with the place they chose.
     *
     * The page's own route to a file — a blob URL on an `<a download>` — reaches
     * nothing here: a WebView has no downloads shelf, and its `DownloadListener`
     * fires only for a real navigation, not for a blob the page just built. So
     * the bytes cross the bridge and the shell opens the system's document
     * picker, which is also the only way to reach a folder the person can find
     * again afterwards.
     *
     * "" is a dismissal, and the page reads it the way it reads a dismissed
     * folder picker. Called from a worker thread, never the page's script
     * thread: this waits for a person.
     */
    fun saveFile(name: String, bytes: ByteArray): String? {
        val safeName = sanitise(name)
        if (safeName.isEmpty()) return null

        val gate = CountDownLatch(1)
        saveLatch.set(gate)
        saveTarget.set(null)

        val posted = CountDownLatch(1)
        var dispatched = false
        main.post {
            dispatched = runCatching { askForSave(safeName, bytes) }.getOrDefault(false)
            posted.countDown()
        }
        val ready = runCatching { posted.await(PICK_TIMEOUT_SECONDS, TimeUnit.SECONDS) }.getOrDefault(false)
        if (!ready || !dispatched) {
            saveLatch.set(null)
            return null
        }
        return try {
            if (!gate.await(PICK_TIMEOUT_SECONDS, TimeUnit.SECONDS)) null
            else saveTarget.get()?.toString()
        } catch (_: InterruptedException) {
            null
        } finally {
            saveLatch.set(null)
        }
    }

    /** Called by the activity once the bytes are written. A null uri is a dismissal. */
    fun deliverSave(uri: Uri?) {
        saveTarget.set(uri)
        saveLatch.get()?.countDown()
    }

    private fun sanitise(name: String): String {
        // A name from the page is used as a filename, so it is reduced to one:
        // no separators, no traversal, and nothing a filesystem treats as
        // special. The default is the name the field it came from suggests.
        val trimmed = name.trim().substringAfterLast('/').substringAfterLast('\\')
        if (trimmed.isEmpty() || trimmed == "." || trimmed == "..") return ""
        return trimmed.filter { it.isLetterOrDigit() || it in "._-" }.take(64)
    }

    companion object {
        private const val PICK_TIMEOUT_SECONDS = 5L * 60
    }
}
